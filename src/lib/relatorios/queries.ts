import { supabase } from "@/integrations/supabase/client";
import type { RelatorioFilters, LeadRow, AppointmentRow, SaleRow, InsightRow } from "./types";

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
): Promise<{ leads: LeadRow[]; appointments: AppointmentRow[]; sales: SaleRow[]; insights: InsightRow[] }> {
  const start = toStartOfDay(filters.from);
  const end = toEndOfDay(filters.to);

  // -------- LEADS --------
  let leadsQ = supabase.from("leads").select(LEAD_FIELDS)
    .gte("created_at", start).lte("created_at", end);

  if (scope === "tenant") {
    if (!currentTenantId) return { leads: [], appointments: [], sales: [], insights: [] };
    leadsQ = leadsQ.eq("tenant_id", currentTenantId);
  } else if (filters.tenantIds.length > 0) {
    leadsQ = leadsQ.in("tenant_id", filters.tenantIds);
  }
  if (filters.campaigns.length > 0) leadsQ = leadsQ.in("utm_campaign", filters.campaigns);
  if (filters.forms.length > 0) leadsQ = leadsQ.in("facebook_form_name", filters.forms);
  if (filters.ownerIds.length > 0) leadsQ = leadsQ.in("owner_user_id", filters.ownerIds);
  if (filters.origem === "paid") leadsQ = leadsQ.eq("is_organic", false);
  if (filters.origem === "organic") leadsQ = leadsQ.eq("is_organic", true);

  const { data: leads, error: leadsErr } = await leadsQ.order("created_at", { ascending: false }).limit(5000);
  if (leadsErr) throw leadsErr;
  const leadRows = (leads ?? []) as unknown as LeadRow[];
  const leadIds = leadRows.map(l => l.id);

  // -------- APPOINTMENTS (agendados no período OU vinculados aos leads do período) --------
  let apptQ = supabase.from("appointments").select("id, tenant_id, lead_id, date_time, status");
  if (scope === "tenant") apptQ = apptQ.eq("tenant_id", currentTenantId!);
  else if (filters.tenantIds.length > 0) apptQ = apptQ.in("tenant_id", filters.tenantIds);
  apptQ = apptQ.gte("date_time", start).lte("date_time", end);
  const { data: appts } = await apptQ.limit(5000);

  // -------- SALES (join por lead_id dos leads do período) --------
  let salesRows: SaleRow[] = [];
  if (leadIds.length > 0) {
    let salesQ = supabase.from("sales")
      .select("id, tenant_id, lead_id, amount, amount_paid, amount_pending, sale_date")
      .in("lead_id", leadIds);
    if (scope === "tenant") salesQ = salesQ.eq("tenant_id", currentTenantId!);
    const { data } = await salesQ.limit(5000);
    salesRows = (data ?? []) as SaleRow[];
  }

  // -------- INSIGHTS (spend por período) --------
  let insQ = supabase.from("campaign_insights")
    .select("tenant_id, campaign_id, campaign_name, spend, leads, cost_per_lead, date_start")
    .gte("date_start", filters.from).lte("date_start", filters.to);
  if (scope === "tenant") insQ = insQ.eq("tenant_id", currentTenantId!);
  else if (filters.tenantIds.length > 0) insQ = insQ.in("tenant_id", filters.tenantIds);
  const { data: insights } = await insQ.limit(10000);

  return {
    leads: leadRows,
    appointments: (appts ?? []) as AppointmentRow[],
    sales: salesRows,
    insights: (insights ?? []) as InsightRow[],
  };
}

export async function fetchFilterOptions(scope: "admin" | "tenant", currentTenantId: string | null) {
  const [tenants, users] = await Promise.all([
    scope === "admin"
      ? supabase.from("tenants").select("id, name").eq("active", true).order("name")
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("tenant_users").select("user_id, tenants(name)").eq("active", true).limit(500),
  ]);
  return {
    tenants: (tenants.data ?? []) as { id: string; name: string }[],
  };
}
