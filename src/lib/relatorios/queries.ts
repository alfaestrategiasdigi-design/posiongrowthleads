import { supabase } from "@/integrations/supabase/client";
import type { RelatorioFilters, LeadRow, AppointmentRow, InsightRow, SpendRow } from "./types";
import { ADMIN_MASTER_TENANT_ID } from "./constants";

const LEAD_FIELDS = `
  id, tenant_id, nome_completo, whatsapp, status, origem, is_organic,
  facebook_campaign, facebook_adset_name, facebook_ad_name, facebook_form_name,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  owner_user_id, valor_proposta, valor_perdido, motivo_perda,
  mql, sql_qualified,
  reuniao_agendada_em, reuniao_realizada_em, proposta_enviada_em, fechado_em,
  created_at
`;

function toEndOfDay(d: string) {
  return `${d}T23:59:59.999Z`;
}
function toStartOfDay(d: string) {
  return `${d}T00:00:00.000Z`;
}

export async function fetchRelatorio(
  filters: RelatorioFilters,
  scope: "admin" | "tenant",
  currentTenantId: string | null,
): Promise<{ leads: LeadRow[]; appointments: AppointmentRow[]; insights: InsightRow[]; spend: SpendRow[] }> {
  const start = toStartOfDay(filters.from);
  const end = toEndOfDay(filters.to);

  // Se o usuário selecionou contas de anúncio, resolvemos os tenants
  // correspondentes (campaign_insights.ad_account_id vem NULL, então usamos
  // o mapeamento em tenant_ad_accounts) e combinamos com o filtro de tenants.
  let effectiveTenantIds = filters.tenantIds;
  if (scope === "admin" && filters.adAccountIds.length > 0) {
    const { data: mapping } = await supabase
      .from("tenant_ad_accounts")
      .select("tenant_id")
      .in("ad_account_id", filters.adAccountIds);
    const adTenants = Array.from(new Set(((mapping ?? []) as any[]).map((r) => r.tenant_id as string).filter(Boolean)));
    effectiveTenantIds = filters.tenantIds.length > 0
      ? filters.tenantIds.filter((t) => adTenants.includes(t))
      : adTenants;
    if (effectiveTenantIds.length === 0) {
      return { leads: [], appointments: [], insights: [], spend: [] };
    }
  }

  // -------- LEADS --------
  let leadsQ = supabase.from("leads").select(LEAD_FIELDS)
    .gte("created_at", start).lte("created_at", end);

  const adminIncludeMaster = effectiveTenantIds.includes(ADMIN_MASTER_TENANT_ID);

  if (scope === "tenant") {
    if (!currentTenantId) return { leads: [], appointments: [], insights: [], spend: [] };
    leadsQ = leadsQ.eq("tenant_id", currentTenantId);
  } else {
    if (effectiveTenantIds.length > 0) leadsQ = leadsQ.in("tenant_id", effectiveTenantIds);
    else leadsQ = leadsQ.neq("tenant_id", ADMIN_MASTER_TENANT_ID);
  }
  if (filters.campaigns.length > 0) leadsQ = leadsQ.in("utm_campaign", filters.campaigns);
  if (filters.forms.length > 0) leadsQ = leadsQ.in("facebook_form_name", filters.forms);
  if (filters.ownerIds.length > 0) leadsQ = leadsQ.in("owner_user_id", filters.ownerIds);
  if (filters.origem === "paid") leadsQ = leadsQ.eq("is_organic", false);
  if (filters.origem === "organic") leadsQ = leadsQ.eq("is_organic", true);

  const { data: leads, error: leadsErr } = await leadsQ.order("created_at", { ascending: false }).limit(5000);
  if (leadsErr) throw leadsErr;
  const leadRows = (leads ?? []) as unknown as LeadRow[];

  // -------- APPOINTMENTS --------
  let apptQ = supabase.from("appointments").select("id, tenant_id, lead_id, date_time, status");
  if (scope === "tenant") apptQ = apptQ.eq("tenant_id", currentTenantId!);
  else {
    if (effectiveTenantIds.length > 0) apptQ = apptQ.in("tenant_id", effectiveTenantIds);
    else apptQ = apptQ.neq("tenant_id", ADMIN_MASTER_TENANT_ID);
  }
  apptQ = apptQ.gte("date_time", start).lte("date_time", end);
  const { data: appts } = await apptQ.limit(5000);

  // -------- INSIGHTS (spend sincronizado da Meta) --------
  let insQ = supabase.from("campaign_insights")
    .select("tenant_id, ad_account_id, campaign_id, campaign_name, spend, leads, cost_per_lead, date_start")
    .gte("date_start", filters.from).lte("date_start", filters.to);
  if (scope === "tenant") insQ = insQ.eq("tenant_id", currentTenantId!);
  else {
    if (effectiveTenantIds.length > 0) insQ = insQ.in("tenant_id", effectiveTenantIds);
    else insQ = insQ.neq("tenant_id", ADMIN_MASTER_TENANT_ID);
  }
  if (filters.campaigns.length > 0) insQ = insQ.in("campaign_name", filters.campaigns);
  const { data: insights } = await insQ.limit(10000);

  // -------- SPEND MANUAL (campaign_spend) --------
  let spendQ = supabase.from("campaign_spend")
    .select("tenant_id, campaign_id, campaign_name, amount_spent, period_start, period_end")
    .lte("period_start", filters.to)
    .gte("period_end", filters.from);
  if (scope === "tenant") spendQ = spendQ.eq("tenant_id", currentTenantId!);
  else {
    if (effectiveTenantIds.length > 0) spendQ = spendQ.in("tenant_id", effectiveTenantIds);
    else spendQ = spendQ.neq("tenant_id", ADMIN_MASTER_TENANT_ID);
  }
  if (filters.campaigns.length > 0) spendQ = spendQ.in("campaign_name", filters.campaigns);
  const { data: spend } = await spendQ.limit(5000);

  void adminIncludeMaster;

  return {
    leads: leadRows,
    appointments: (appts ?? []) as AppointmentRow[],
    insights: (insights ?? []) as InsightRow[],
    spend: (spend ?? []) as SpendRow[],
  };
}

export async function fetchFilterOptions(scope: "admin" | "tenant", currentTenantId: string | null) {
  // Admin: inclui TODOS os tenants (inclusive Admin Master) para poder tirar
  // relatório da conta interna quando selecionado explicitamente.
  const tenantsP = scope === "admin"
    ? supabase.from("tenants").select("id, name").order("name")
    : Promise.resolve({ data: [] as { id: string; name: string }[] });

  // Formulários: pega TODOS os forms já vistos (não limitado pelo período).
  let formsQ = supabase.from("leads")
    .select("facebook_form_name, tenant_id")
    .not("facebook_form_name", "is", null)
    .limit(5000);
  if (scope === "tenant" && currentTenantId) formsQ = formsQ.eq("tenant_id", currentTenantId);

  // Campanhas: idem, pega todas conhecidas por utm_campaign
  let campQ = supabase.from("leads")
    .select("utm_campaign, tenant_id")
    .not("utm_campaign", "is", null)
    .limit(5000);
  if (scope === "tenant" && currentTenantId) campQ = campQ.eq("tenant_id", currentTenantId);

  // Contas de anúncio ativas
  let adQ = supabase.from("tenant_ad_accounts")
    .select("ad_account_id, label, tenant_id")
    .eq("active", true);
  if (scope === "tenant" && currentTenantId) adQ = adQ.eq("tenant_id", currentTenantId);

  const [tenants, formsRes, campRes, adRes] = await Promise.all([tenantsP, formsQ, campQ, adQ]);

  const forms = Array.from(new Set(((formsRes.data ?? []) as any[])
    .map((r) => r.facebook_form_name as string).filter(Boolean))).sort();
  const campaigns = Array.from(new Set(((campRes.data ?? []) as any[])
    .map((r) => r.utm_campaign as string).filter(Boolean))).sort();
  const adAccounts = ((adRes.data ?? []) as any[]).map((r) => ({
    id: r.ad_account_id as string,
    label: (r.label as string) || (r.ad_account_id as string),
  }));

  return {
    tenants: (tenants.data ?? []) as { id: string; name: string }[],
    forms,
    campaigns,
    adAccounts,
  };
}
