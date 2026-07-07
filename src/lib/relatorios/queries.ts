import { supabase } from "@/integrations/supabase/client";
import type { RelatorioFilters, LeadRow, AppointmentRow, InsightRow, SpendRow } from "./types";


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

  // -------- LEADS --------
  let leadsQ = supabase.from("leads").select(LEAD_FIELDS)
    .gte("created_at", start).lte("created_at", end);

  // Regra Admin Master:
  //  - se o usuário selecionou explicitamente algum tenant no filtro,
  //    respeitamos essa lista (Admin Master entra se ele marcou);
  //  - se NÃO selecionou nada (agregado padrão), excluímos Admin Master
  //    para não misturar dados internos com o consolidado das clínicas.
  // Admin: por padrão inclui TODAS as contas (inclusive Admin Master) para bater
  // com os números do dashboard consolidado da Posion. Se o usuário selecionar
  // clínicas específicas no filtro, respeitamos essa lista.
  if (scope === "tenant") {
    if (!currentTenantId) return { leads: [], appointments: [], insights: [], spend: [] };
    leadsQ = leadsQ.eq("tenant_id", currentTenantId);
  } else {
    if (filters.tenantIds.length > 0) leadsQ = leadsQ.in("tenant_id", filters.tenantIds);
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
  else if (filters.tenantIds.length > 0) apptQ = apptQ.in("tenant_id", filters.tenantIds);
  apptQ = apptQ.gte("date_time", start).lte("date_time", end);
  const { data: appts } = await apptQ.limit(5000);

  // -------- INSIGHTS (spend sincronizado da Meta) --------
  let insQ = supabase.from("campaign_insights")
    .select("tenant_id, campaign_id, campaign_name, spend, leads, cost_per_lead, date_start")
    .gte("date_start", filters.from).lte("date_start", filters.to);
  if (scope === "tenant") insQ = insQ.eq("tenant_id", currentTenantId!);
  else if (filters.tenantIds.length > 0) insQ = insQ.in("tenant_id", filters.tenantIds);
  if (filters.campaigns.length > 0) insQ = insQ.in("campaign_name", filters.campaigns);
  const { data: insights } = await insQ.limit(10000);

  // -------- SPEND MANUAL (campaign_spend) --------
  // Sobreposição de período: period_start <= to AND period_end >= from
  let spendQ = supabase.from("campaign_spend")
    .select("tenant_id, campaign_id, campaign_name, amount_spent, period_start, period_end")
    .lte("period_start", filters.to)
    .gte("period_end", filters.from);
  if (scope === "tenant") spendQ = spendQ.eq("tenant_id", currentTenantId!);
  else if (filters.tenantIds.length > 0) spendQ = spendQ.in("tenant_id", filters.tenantIds);
  if (filters.campaigns.length > 0) spendQ = spendQ.in("campaign_name", filters.campaigns);
  const { data: spend } = await spendQ.limit(5000);


  return {
    leads: leadRows,
    appointments: (appts ?? []) as AppointmentRow[],
    insights: (insights ?? []) as InsightRow[],
    spend: (spend ?? []) as SpendRow[],
  };
}

export async function fetchFilterOptions(scope: "admin" | "tenant", _currentTenantId: string | null) {
  // Admin: inclui TODOS os tenants (inclusive Admin Master) para poder tirar
  // relatório da conta interna quando selecionado explicitamente.
  const tenants = scope === "admin"
    ? await supabase.from("tenants").select("id, name").order("name")
    : { data: [] as { id: string; name: string }[] };
  return {
    tenants: (tenants.data ?? []) as { id: string; name: string }[],
  };
}
