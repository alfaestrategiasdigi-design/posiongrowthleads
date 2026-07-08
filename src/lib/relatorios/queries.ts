import { supabase } from "@/integrations/supabase/client";
import type { RelatorioFilters, LeadRow, AppointmentRow, InsightRow, SpendRow, SaleRow, GoalRow } from "./types";


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
): Promise<{ leads: LeadRow[]; appointments: AppointmentRow[]; insights: InsightRow[]; spend: SpendRow[]; sales: SaleRow[]; goals: GoalRow[] }> {
  const start = toStartOfDay(filters.from);
  const end = toEndOfDay(filters.to);

  // -------- LEADS --------
  let leadsQ = supabase.from("leads").select(LEAD_FIELDS)
    .gte("created_at", start).lte("created_at", end);
  if (scope === "tenant") {
    if (!currentTenantId) return { leads: [], appointments: [], insights: [], spend: [], sales: [], goals: [] };
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

  // -------- INSIGHTS --------
  let insQ = supabase.from("campaign_insights")
    .select("tenant_id, campaign_id, campaign_name, spend, leads, cost_per_lead, date_start")
    .gte("date_start", filters.from).lte("date_start", filters.to);
  if (scope === "tenant") insQ = insQ.eq("tenant_id", currentTenantId!);
  else if (filters.tenantIds.length > 0) insQ = insQ.in("tenant_id", filters.tenantIds);
  if (filters.campaigns.length > 0) insQ = insQ.in("campaign_name", filters.campaigns);
  const { data: insights } = await insQ.limit(10000);

  // -------- SPEND MANUAL --------
  let spendQ = supabase.from("campaign_spend")
    .select("tenant_id, campaign_id, campaign_name, amount_spent, period_start, period_end")
    .lte("period_start", filters.to)
    .gte("period_end", filters.from);
  if (scope === "tenant") spendQ = spendQ.eq("tenant_id", currentTenantId!);
  else if (filters.tenantIds.length > 0) spendQ = spendQ.in("tenant_id", filters.tenantIds);
  if (filters.campaigns.length > 0) spendQ = spendQ.in("campaign_name", filters.campaigns);
  const { data: spend } = await spendQ.limit(5000);

  // -------- SALES --------
  let salesQ = supabase.from("sales").select(SALE_FIELDS)
    .gte("sale_date", filters.from).lte("sale_date", filters.to);
  if (scope === "tenant") salesQ = salesQ.eq("tenant_id", currentTenantId!);
  else if (filters.tenantIds.length > 0) salesQ = salesQ.in("tenant_id", filters.tenantIds);
  const { data: sales } = await salesQ.limit(10000);

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
