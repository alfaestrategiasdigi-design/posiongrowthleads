import { supabase } from "@/integrations/supabase/client";
import type { RelatorioFilters, LeadRow, AppointmentRow, InsightRow, SpendRow, SaleRow, GoalRow, AgencyContractRow } from "./types";


const LEAD_FIELDS = `
  id, tenant_id, nome_completo, whatsapp, status, origem, is_organic,
  facebook_campaign, facebook_adset_name, facebook_ad_name, facebook_form_name,
  utm_source, utm_medium, utm_campaign, utm_content, utm_term,
  owner_user_id, valor_proposta, valor_perdido, motivo_perda,
  mql, sql_qualified,
  reuniao_agendada_em, reuniao_realizada_em, proposta_enviada_em, fechado_em,
  created_at
`;

const SALE_FIELDS = `id, tenant_id, seller_name, product, procedure_name, channel, channel_origin, amount, sale_date, first_contact_date, patient_id`;
const AGENCY_CONTRACT_FIELDS = `id, agency_lead_id, tenant_id, cliente_nome, valor_total, data_assinatura, status`;

function toEndOfDay(d: string) { return `${d}T23:59:59.999Z`; }
function toStartOfDay(d: string) { return `${d}T00:00:00.000Z`; }

function monthsInRange(from: string, to: string): { year: number; month: number }[] {
  const start = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  const out: { year: number; month: number }[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const endM = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cur <= endM) {
    out.push({ year: cur.getUTCFullYear(), month: cur.getUTCMonth() + 1 });
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

export async function fetchRelatorio(
  filters: RelatorioFilters,
  scope: "admin" | "tenant",
  currentTenantId: string | null,
): Promise<{ leads: LeadRow[]; appointments: AppointmentRow[]; insights: InsightRow[]; spend: SpendRow[]; sales: SaleRow[]; agencyContracts: AgencyContractRow[]; goals: GoalRow[] }> {
  const start = toStartOfDay(filters.from);
  const end = toEndOfDay(filters.to);
  const isAdminMasterView = scope === "admin" && filters.tenantIds.length === 0;
  let masterSourceIds: string[] = [];

  if (isAdminMasterView) {
    const { data: masterRules } = await (supabase as any)
      .from("lead_routing_rules")
      .select("match_value")
      .eq("match_type", "form_id")
      .eq("is_admin_master", true)
      .eq("active", true);
    const masterFormIds = (masterRules ?? []).map((r: any) => String(r.match_value)).filter(Boolean);
    if (masterFormIds.length === 0) {
      return { leads: [], appointments: [], insights: [], spend: [], sales: [], agencyContracts: [], goals: [] };
    }
    const { data: srcLeads, error: srcErr } = await supabase
      .from("leads")
      .select("id")
      .eq("origem", "facebook_ads")
      .is("tenant_id", null)
      .in("facebook_form_id", masterFormIds)
      .limit(10000);
    if (srcErr) throw srcErr;
    masterSourceIds = (srcLeads ?? []).map((l: any) => l.id).filter(Boolean);
    if (masterSourceIds.length === 0) {
      return { leads: [], appointments: [], insights: [], spend: [], sales: [], agencyContracts: [], goals: [] };
    }
  }

  // -------- LEADS --------
  let leadsQ = supabase.from("leads").select(LEAD_FIELDS);
  if (scope === "tenant") {
    if (!currentTenantId) return { leads: [], appointments: [], insights: [], spend: [], sales: [], agencyContracts: [], goals: [] };
    leadsQ = leadsQ.eq("tenant_id", currentTenantId);
    leadsQ = leadsQ.gte("created_at", start).lte("created_at", end);
  } else if (isAdminMasterView) {
    leadsQ = leadsQ.in("id", masterSourceIds);
  } else {
    if (filters.tenantIds.length > 0) leadsQ = leadsQ.in("tenant_id", filters.tenantIds);
    leadsQ = leadsQ.gte("created_at", start).lte("created_at", end);
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
  else if (isAdminMasterView) apptQ = apptQ.is("tenant_id", null);
  else if (filters.tenantIds.length > 0) apptQ = apptQ.in("tenant_id", filters.tenantIds);
  apptQ = apptQ.gte("date_time", start).lte("date_time", end);
  const { data: appts } = await apptQ.limit(5000);

  // -------- INSIGHTS --------
  let insQ = supabase.from("campaign_insights")
    .select("tenant_id, campaign_id, campaign_name, spend, leads, cost_per_lead, date_start")
    .gte("date_start", filters.from).lte("date_start", filters.to);
  if (scope === "tenant") insQ = insQ.eq("tenant_id", currentTenantId!);
  else if (isAdminMasterView) insQ = insQ.is("tenant_id", null);
  else if (filters.tenantIds.length > 0) insQ = insQ.in("tenant_id", filters.tenantIds);
  if (filters.campaigns.length > 0) insQ = insQ.in("campaign_name", filters.campaigns);
  const { data: insights } = await insQ.limit(10000);

  // -------- SPEND MANUAL --------
  let spendQ = supabase.from("campaign_spend")
    .select("tenant_id, campaign_id, campaign_name, amount_spent, period_start, period_end")
    .lte("period_start", filters.to)
    .gte("period_end", filters.from);
  if (scope === "tenant") spendQ = spendQ.eq("tenant_id", currentTenantId!);
  else if (isAdminMasterView) spendQ = spendQ.is("tenant_id", null);
  else if (filters.tenantIds.length > 0) spendQ = spendQ.in("tenant_id", filters.tenantIds);
  if (filters.campaigns.length > 0) spendQ = spendQ.in("campaign_name", filters.campaigns);
  const { data: spend } = await spendQ.limit(5000);

  // -------- SALES --------
  let salesQ = supabase.from("sales").select(SALE_FIELDS)
    .gte("sale_date", filters.from).lte("sale_date", filters.to);
  if (scope === "tenant") salesQ = salesQ.eq("tenant_id", currentTenantId!);
  else if (isAdminMasterView) salesQ = salesQ.is("tenant_id", null);
  else if (filters.tenantIds.length > 0) salesQ = salesQ.in("tenant_id", filters.tenantIds);
  const { data: sales } = await salesQ.limit(10000);

  // -------- CONTRATOS DA AGÊNCIA (Admin Master) --------
  let agencyContracts: AgencyContractRow[] = [];
  if (isAdminMasterView) {
    const { data: agencyLeadLinks, error: agencyLeadLinksErr } = await (supabase as any)
      .from("agency_leads")
      .select("id, source_lead_id, stage, valor_proposta")
      .in("source_lead_id", masterSourceIds)
      .limit(10000);
    if (agencyLeadLinksErr) throw agencyLeadLinksErr;
    const agencyLeadIds = (agencyLeadLinks ?? []).map((l: any) => l.id).filter(Boolean);
    const { data: ac, error: acErr } = await supabase
      .from("agency_contracts")
      .select(AGENCY_CONTRACT_FIELDS)
      .in("agency_lead_id", agencyLeadIds.length > 0 ? agencyLeadIds : masterSourceIds)
      .gte("data_assinatura", filters.from)
      .lte("data_assinatura", filters.to)
      .order("data_assinatura", { ascending: false })
      .limit(10000);
    if (acErr) throw acErr;
    agencyContracts = (ac ?? []) as AgencyContractRow[];
    const contractedAgencyLeadIds = new Set(agencyContracts.map((c) => c.agency_lead_id).filter(Boolean) as string[]);
    const agencyBySource = new Map<string, any>();
    for (const a of agencyLeadLinks ?? []) {
      if ((a as any).source_lead_id) agencyBySource.set(String((a as any).source_lead_id), a);
    }
    for (const lead of leadRows) {
      const agencyLead = agencyBySource.get(lead.id);
      if (!agencyLead) continue;
      lead.status = contractedAgencyLeadIds.has(String(agencyLead.id)) ? "ganho" : String(agencyLead.stage || lead.status);
      lead.valor_proposta = Number(agencyLead.valor_proposta ?? lead.valor_proposta ?? 0);
    }
  }

  // -------- GOALS (para "Meta") --------
  const months = monthsInRange(filters.from, filters.to);
  let goals: GoalRow[] = [];
  if (months.length > 0) {
    let goalsQ = supabase.from("monthly_goals").select("tenant_id, year, month, goal_1, goal_2, goal_3");
    if (scope === "tenant") goalsQ = goalsQ.eq("tenant_id", currentTenantId!);
    else if (filters.tenantIds.length > 0) goalsQ = goalsQ.in("tenant_id", filters.tenantIds);
    const yearsSet = Array.from(new Set(months.map(m => m.year)));
    goalsQ = goalsQ.in("year", yearsSet);
    const { data: g } = await goalsQ.limit(2000);
    const monthKeys = new Set(months.map(m => `${m.year}-${m.month}`));
    goals = ((g ?? []) as GoalRow[]).filter(r => monthKeys.has(`${r.year}-${r.month}`));
  }

  return {
    leads: leadRows,
    appointments: (appts ?? []) as AppointmentRow[],
    insights: (insights ?? []) as InsightRow[],
    spend: (spend ?? []) as SpendRow[],
    sales: (sales ?? []) as SaleRow[],
    agencyContracts,
    goals,
  };
}

export async function fetchFilterOptions(scope: "admin" | "tenant", _currentTenantId: string | null) {
  const tenants = scope === "admin"
    ? await supabase.from("tenants").select("id, name").order("name")
    : { data: [] as { id: string; name: string }[] };
  return {
    tenants: (tenants.data ?? []) as { id: string; name: string }[],
  };
}
