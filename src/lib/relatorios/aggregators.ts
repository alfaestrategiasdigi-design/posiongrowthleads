import { format, parseISO, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  LeadRow, AppointmentRow, InsightRow, SpendRow, SaleRow, GoalRow,
  Kpis, FunilStage, RelatorioData, RelatorioFilters, RankingItem,
} from "./types";

const STAGE_LABELS: Record<string, string> = {
  lead: "Lead",
  qualificado: "Qualificado",
  reuniao_agendada: "Reunião Agendada",
  compareceu: "Compareceu",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
  no_show: "Não Comparecimento",
};

const FUNIL_ORDER = ["lead", "qualificado", "reuniao_agendada", "compareceu", "negociacao", "ganho"] as const;

function inRange(dateStr: string | null | undefined, from: string, to: string) {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= from && d <= to;
}

export function buildKpis(
  leads: LeadRow[], appts: AppointmentRow[], insights: InsightRow[], spend: SpendRow[],
  sales: SaleRow[], goals: GoalRow[], from: string, to: string,
): Kpis {
  const total = leads.length;
  const qualificados = leads.filter(l => l.mql || l.sql_qualified || ["qualificado","reuniao_agendada","compareceu","negociacao","ganho"].includes(l.status)).length;
  const agendamentos = appts.length;
  const compareceu = appts.filter(a => (a.status ?? "").toLowerCase() === "realizado" || (a.status ?? "").toLowerCase() === "compareceu").length;
  const noShow = appts.filter(a => (a.status ?? "").toLowerCase() === "no_show" || (a.status ?? "").toLowerCase() === "faltou").length;
  const ganhosLeads = leads.filter(l => l.status === "ganho");
  const ganhos = ganhosLeads.length;
  const valorGanho = ganhosLeads.reduce((s, l) => s + (Number(l.valor_proposta) || 0), 0);
  const valorPerdido = leads.filter(l => l.status === "perdido").reduce((s, l) => s + (Number(l.valor_perdido) || 0), 0);

  const investimentoInsights = insights.reduce((s, i) => s + (Number(i.spend) || 0), 0);
  const latestByCampaign = new Map<string, SpendRow>();
  for (const s of spend) {
    const key = `${s.tenant_id ?? ""}::${s.campaign_id ?? s.campaign_name ?? ""}`;
    const cur = latestByCampaign.get(key);
    if (!cur || (s.period_end ?? "") > (cur.period_end ?? "")) latestByCampaign.set(key, s);
  }
  const investimentoManual = Array.from(latestByCampaign.values())
    .reduce((s, x) => s + (Number(x.amount_spent) || 0), 0);
  const investimento = investimentoInsights + investimentoManual;
  const cpl = total > 0 ? investimento / total : 0;
  const cac = ganhos > 0 ? investimento / ganhos : 0;

  // ---- Novos KPIs ----
  const vendasTotal = sales.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const vendasQtd = sales.length;
  const novaVenda = sales
    .filter(r => inRange(r.first_contact_date, from, to))
    .reduce((s, r) => s + (Number(r.amount) || 0), 0);

  // Monetização: vendas cujo patient_id já teve venda anterior a esta (fora ou dentro do período)
  // Aproximação com base apenas nos dados no período: se um patient_id tem >1 venda, todas menos a primeira são monetização.
  const salesByPatient = new Map<string, SaleRow[]>();
  for (const r of sales) {
    if (!r.patient_id) continue;
    const arr = salesByPatient.get(r.patient_id) ?? [];
    arr.push(r);
    salesByPatient.set(r.patient_id, arr);
  }
  let monetizacao = 0;
  for (const arr of salesByPatient.values()) {
    if (arr.length < 2) continue;
    const sorted = arr.slice().sort((a, b) => (a.sale_date > b.sale_date ? 1 : -1));
    for (let i = 1; i < sorted.length; i++) monetizacao += Number(sorted[i].amount) || 0;
  }

  const meta = goals.reduce((s, g) => s + (Number(g.goal_3) || Number(g.goal_2) || Number(g.goal_1) || 0), 0);
  const naoRealizado = Math.max(meta - vendasTotal, 0);
  const ticketMedio = vendasQtd > 0 ? vendasTotal / vendasQtd : 0;
  const cpa = vendasQtd > 0 ? investimento / vendasQtd : 0;
  const mqlQtd = leads.filter(l => l.mql).length;
  const sqlQtd = leads.filter(l => l.sql_qualified).length;
  const cpmql = mqlQtd > 0 ? investimento / mqlQtd : 0;
  const cpsql = sqlQtd > 0 ? investimento / sqlQtd : 0;

  return {
    totalLeads: total,
    qualificados,
    taxaQualificacao: total > 0 ? qualificados / total : 0,
    agendamentos,
    compareceu,
    noShow,
    taxaComparecimento: (compareceu + noShow) > 0 ? compareceu / (compareceu + noShow) : 0,
    ganhos,
    taxaConversao: total > 0 ? ganhos / total : 0,
    valorGanho,
    valorPerdido,
    investimento,
    cpl,
    cac,
    vendasTotal, vendasQtd, novaVenda, monetizacao, meta, naoRealizado,
    ticketMedio, cpa, cpmql, cpsql,
  };
}

export function buildFunil(leads: LeadRow[]): FunilStage[] {
  const total = leads.length;
  const counts: Record<string, number> = {};
  const RANK: Record<string, number> = { lead: 0, qualificado: 1, reuniao_agendada: 2, compareceu: 3, negociacao: 4, ganho: 5, perdido: -1, no_show: -1 };
  for (const stage of FUNIL_ORDER) {
    const rank = RANK[stage];
    counts[stage] = leads.filter(l => {
      const r = RANK[l.status] ?? 0;
      return r >= rank && r >= 0;
    }).length;
  }
  const stages: FunilStage[] = FUNIL_ORDER.map((id, idx) => {
    const count = counts[id];
    const prev = idx > 0 ? counts[FUNIL_ORDER[idx - 1]] : null;
    return {
      id,
      label: STAGE_LABELS[id],
      count,
      pctTotal: total > 0 ? count / total : 0,
      pctPrev: prev !== null && prev > 0 ? count / prev : null,
    };
  });
  const perdido = leads.filter(l => l.status === "perdido").length;
  const noShow = leads.filter(l => l.status === "no_show").length;
  stages.push(
    { id: "perdido", label: STAGE_LABELS.perdido, count: perdido, pctTotal: total > 0 ? perdido / total : 0, pctPrev: null },
    { id: "no_show", label: STAGE_LABELS.no_show, count: noShow, pctTotal: total > 0 ? noShow / total : 0, pctPrev: null },
  );
  return stages;
}

// Funil baseado nas etapas do Kanban (PIPELINE_STAGES) — progressão cumulativa
export function buildBiFunnel(leads: LeadRow[]): FunilStage[] {
  const total = leads.length;
  // Ordem progressiva do kanban (perdido/no_show ficam fora do funil de conversão)
  const order = ["lead", "qualificado", "reuniao_agendada", "compareceu", "negociacao", "ganho"];
  const rankOf = (s: string) => order.indexOf(s);
  const countAtOrBeyond = (idx: number) =>
    leads.filter(l => {
      const r = rankOf(l.status);
      return r >= idx;
    }).length;

  const rows = [
    { id: "lead",             label: "Lead",              count: total },
    { id: "qualificado",      label: "Qualificado",       count: countAtOrBeyond(1) },
    { id: "reuniao_agendada", label: "Consulta Agendada", count: countAtOrBeyond(2) },
    { id: "compareceu",       label: "Compareceu",        count: countAtOrBeyond(3) },
    { id: "negociacao",       label: "Negociação",        count: countAtOrBeyond(4) },
    { id: "ganho",            label: "Ganho",             count: countAtOrBeyond(5) },
  ];
  return rows.map((r, i) => {
    const prev = i > 0 ? rows[i - 1].count : null;
    return {
      id: r.id,
      label: r.label,
      count: r.count,
      pctTotal: total > 0 ? r.count / total : 0,
      pctPrev: prev != null && prev > 0 ? r.count / prev : null,
    };
  });
}

export function buildLeadsByDay(leads: LeadRow[], from: string, to: string) {
  const map = new Map<string, number>();
  for (const l of leads) {
    const day = l.created_at.slice(0, 10);
    map.set(day, (map.get(day) ?? 0) + 1);
  }
  const days = eachDayOfInterval({ start: parseISO(from), end: parseISO(to) });
  return days.map(d => {
    const key = format(d, "yyyy-MM-dd");
    return { date: format(d, "dd/MM", { locale: ptBR }), count: map.get(key) ?? 0 };
  });
}

export function buildTopBy<T extends string | null>(
  leads: LeadRow[], getKey: (l: LeadRow) => T, limit = 10,
) {
  const map = new Map<string, number>();
  for (const l of leads) {
    const k = (getKey(l) || "").toString().trim() || "(sem valor)";
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export function buildAttendanceByWeekday(appts: AppointmentRow[]) {
  const base = WEEKDAYS.map(d => ({ day: d, compareceu: 0, noShow: 0 }));
  for (const a of appts) {
    const wd = new Date(a.date_time).getDay();
    const st = (a.status ?? "").toLowerCase();
    if (st === "realizado" || st === "compareceu") base[wd].compareceu++;
    else if (st === "no_show" || st === "faltou") base[wd].noShow++;
  }
  return base;
}

export function buildOriginSplit(leads: LeadRow[]) {
  let paid = 0, organic = 0;
  for (const l of leads) {
    if (l.is_organic === true) organic++;
    else if (l.origem === "facebook_ads" || l.is_organic === false) paid++;
    else organic++;
  }
  return [
    { name: "Pago (Meta Ads)", value: paid },
    { name: "Orgânico", value: organic },
  ];
}

// ---- Rankings (BI antigo) ----
export function buildClosersRanking(sales: SaleRow[]): RankingItem[] {
  const map = new Map<string, RankingItem>();
  for (const s of sales) {
    const key = (s.seller_name || "").trim() || "(sem closer)";
    const cur = map.get(key) ?? { name: key, total: 0, count: 0 };
    cur.total += Number(s.amount) || 0;
    cur.count += 1;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 10);
}

export function buildSdrsRanking(leads: LeadRow[], ownersLabels: Map<string, string>): RankingItem[] {
  const map = new Map<string, RankingItem>();
  for (const l of leads) {
    if (l.status !== "ganho") continue;
    const key = l.owner_user_id || "(sem SDR)";
    const label = l.owner_user_id ? (ownersLabels.get(l.owner_user_id) || l.owner_user_id.slice(0, 8)) : "(sem SDR)";
    const cur = map.get(key) ?? { name: label, total: 0, count: 0 };
    cur.total += Number(l.valor_proposta) || 0;
    cur.count += 1;
    map.set(key, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 10);
}

// ---- Produtos (BI antigo) ----
export function buildSalesByProduct(sales: SaleRow[]) {
  const map = new Map<string, number>();
  for (const s of sales) {
    const key = ((s.product || s.procedure_name || "").trim()) || "(sem produto)";
    map.set(key, (map.get(key) || 0) + (Number(s.amount) || 0));
  }
  return Array.from(map.entries())
    .map(([name, total]) => ({ name, total }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

export function buildMonetizedByProduct(sales: SaleRow[]) {
  // Vendas de recompra por patient_id
  const salesByPatient = new Map<string, SaleRow[]>();
  for (const r of sales) {
    if (!r.patient_id) continue;
    const arr = salesByPatient.get(r.patient_id) ?? [];
    arr.push(r);
    salesByPatient.set(r.patient_id, arr);
  }
  const monetized: SaleRow[] = [];
  for (const arr of salesByPatient.values()) {
    if (arr.length < 2) continue;
    const sorted = arr.slice().sort((a, b) => (a.sale_date > b.sale_date ? 1 : -1));
    for (let i = 1; i < sorted.length; i++) monetized.push(sorted[i]);
  }
  return buildSalesByProduct(monetized);
}

// ---- Taxa por canal ----
function normalizeChannel(v?: string | null) {
  const s = (v || "").toString().trim().toLowerCase();
  if (!s) return "(sem canal)";
  if (s.includes("facebook") || s.includes("meta")) return "Meta";
  if (s.includes("insta")) return "Instagram";
  if (s.includes("google")) return "Google";
  if (s.includes("indica")) return "Indicação";
  if (s.includes("network")) return "Network";
  if (s.includes("organ")) return "Orgânico";
  return v || "(sem canal)";
}

export function buildChannelConversion(leads: LeadRow[], sales: SaleRow[]) {
  const leadsByCh = new Map<string, number>();
  for (const l of leads) {
    const k = normalizeChannel(l.origem);
    leadsByCh.set(k, (leadsByCh.get(k) || 0) + 1);
  }
  const salesByCh = new Map<string, number>();
  for (const s of sales) {
    const k = normalizeChannel(s.channel_origin || s.channel);
    salesByCh.set(k, (salesByCh.get(k) || 0) + 1);
  }
  const keys = new Set<string>([...leadsByCh.keys(), ...salesByCh.keys()]);
  return Array.from(keys).map(name => {
    const l = leadsByCh.get(name) || 0;
    const v = salesByCh.get(name) || 0;
    return { name, sales: v, leads: l, rate: l > 0 ? v / l : 0 };
  }).sort((a, b) => b.rate - a.rate);
}

export function buildChannelSql(leads: LeadRow[]) {
  const totalByCh = new Map<string, number>();
  const sqlByCh = new Map<string, number>();
  for (const l of leads) {
    const k = normalizeChannel(l.origem);
    totalByCh.set(k, (totalByCh.get(k) || 0) + 1);
    if (l.sql_qualified) sqlByCh.set(k, (sqlByCh.get(k) || 0) + 1);
  }
  return Array.from(totalByCh.keys()).map(name => {
    const t = totalByCh.get(name) || 0;
    const s = sqlByCh.get(name) || 0;
    return { name, sql: s, leads: t, rate: t > 0 ? s / t : 0 };
  }).sort((a, b) => b.rate - a.rate);
}

export function buildRelatorioData(
  filters: RelatorioFilters,
  leads: LeadRow[], appts: AppointmentRow[], insights: InsightRow[], spend: SpendRow[],
  sales: SaleRow[], goals: GoalRow[],
  availableTenants: { id: string; name: string }[],
): RelatorioData {
  const availableCampaigns = Array.from(new Set(leads.map(l => l.utm_campaign).filter(Boolean) as string[])).sort();
  const availableForms = Array.from(new Set(leads.map(l => l.facebook_form_name).filter(Boolean) as string[])).sort();
  const ownersMap = new Map<string, string>();
  for (const l of leads) if (l.owner_user_id) ownersMap.set(l.owner_user_id, l.owner_user_id.slice(0, 8));
  const availableOwners = Array.from(ownersMap.entries()).map(([id, label]) => ({ id, label }));

  return {
    leads, appointments: appts, insights, spend, sales, goals,
    kpis: buildKpis(leads, appts, insights, spend, sales, goals, filters.from, filters.to),
    funil: buildFunil(leads),
    biFunnel: buildBiFunnel(leads),
    leadsByDay: buildLeadsByDay(leads, filters.from, filters.to),
    leadsByCampaign: buildTopBy(leads, l => l.utm_campaign || l.facebook_campaign || null, 10),
    leadsByForm: buildTopBy(leads, l => l.facebook_form_name, 8),
    attendanceByWeekday: buildAttendanceByWeekday(appts),
    originSplit: buildOriginSplit(leads),
    rankingClosers: buildClosersRanking(sales),
    rankingSdrs: buildSdrsRanking(leads, ownersMap),
    salesByProduct: buildSalesByProduct(sales),
    monetizedByProduct: buildMonetizedByProduct(sales),
    channelConversion: buildChannelConversion(leads, sales),
    channelSql: buildChannelSql(leads),
    availableCampaigns,
    availableForms,
    availableOwners,
    availableTenants,
  };
}

export { STAGE_LABELS };
