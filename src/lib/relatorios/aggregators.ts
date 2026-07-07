import { format, parseISO, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";
import type {
  LeadRow, AppointmentRow, InsightRow, SpendRow,
  Kpis, FunilStage, RelatorioData, RelatorioFilters,
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

// Ordem do funil principal (perdido/no_show ficam à parte)
const FUNIL_ORDER = ["lead", "qualificado", "reuniao_agendada", "compareceu", "negociacao", "ganho"] as const;

export function buildKpis(
  leads: LeadRow[], appts: AppointmentRow[], insights: InsightRow[], spend: SpendRow[],
): Kpis {
  const total = leads.length;
  const qualificados = leads.filter(l => l.mql || l.sql_qualified || ["qualificado","reuniao_agendada","compareceu","negociacao","ganho"].includes(l.status)).length;
  const agendamentos = appts.length;
  const compareceu = appts.filter(a => (a.status ?? "").toLowerCase() === "realizado" || (a.status ?? "").toLowerCase() === "compareceu").length;
  const noShow = appts.filter(a => (a.status ?? "").toLowerCase() === "no_show" || (a.status ?? "").toLowerCase() === "faltou").length;
  const ganhosLeads = leads.filter(l => l.status === "ganho");
  const ganhos = ganhosLeads.length;
  // Valor Ganho: Kanban puro — soma valor_proposta dos leads na coluna 'ganho'
  const valorGanho = ganhosLeads.reduce((s, l) => s + (Number(l.valor_proposta) || 0), 0);
  const valorPerdido = leads.filter(l => l.status === "perdido").reduce((s, l) => s + (Number(l.valor_perdido) || 0), 0);
  // Investimento: insights sincronizados + spend manual
  const investimentoInsights = insights.reduce((s, i) => s + (Number(i.spend) || 0), 0);
  const investimentoManual = spend.reduce((s, x) => s + (Number(x.amount_spent) || 0), 0);
  const investimento = investimentoInsights + investimentoManual;
  const cpl = total > 0 ? investimento / total : 0;
  const cac = ganhos > 0 ? investimento / ganhos : 0;

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
  };
}

export function buildFunil(leads: LeadRow[]): FunilStage[] {
  const total = leads.length;
  // Cumulativo: quem chegou em X, obrigatoriamente passou por lead. Usamos "todos que estão em X ou depois".
  const counts: Record<string, number> = {};
  const RANK: Record<string, number> = { lead: 0, qualificado: 1, reuniao_agendada: 2, compareceu: 3, negociacao: 4, ganho: 5, perdido: -1, no_show: -1 };
  for (const stage of FUNIL_ORDER) {
    const rank = RANK[stage];
    counts[stage] = leads.filter(l => {
      const r = RANK[l.status] ?? 0;
      // ganho conta em todos os anteriores; perdido/no_show contam só onde estavam
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

  // Adiciona perdido e no_show ao final como referência (não cumulativos)
  const perdido = leads.filter(l => l.status === "perdido").length;
  const noShow = leads.filter(l => l.status === "no_show").length;
  stages.push(
    { id: "perdido", label: STAGE_LABELS.perdido, count: perdido, pctTotal: total > 0 ? perdido / total : 0, pctPrev: null },
    { id: "no_show", label: STAGE_LABELS.no_show, count: noShow, pctTotal: total > 0 ? noShow / total : 0, pctPrev: null },
  );

  return stages;
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

export function buildRelatorioData(
  filters: RelatorioFilters,
  leads: LeadRow[], appts: AppointmentRow[], insights: InsightRow[], spend: SpendRow[],
  availableTenants: { id: string; name: string }[],
): RelatorioData {
  const availableCampaigns = Array.from(new Set(leads.map(l => l.utm_campaign).filter(Boolean) as string[])).sort();
  const availableForms = Array.from(new Set(leads.map(l => l.facebook_form_name).filter(Boolean) as string[])).sort();
  const ownersMap = new Map<string, string>();
  for (const l of leads) if (l.owner_user_id) ownersMap.set(l.owner_user_id, l.owner_user_id.slice(0, 8));
  const availableOwners = Array.from(ownersMap.entries()).map(([id, label]) => ({ id, label }));

  return {
    leads, appointments: appts, insights, spend,
    kpis: buildKpis(leads, appts, insights, spend),
    funil: buildFunil(leads),
    leadsByDay: buildLeadsByDay(leads, filters.from, filters.to),
    leadsByCampaign: buildTopBy(leads, l => l.utm_campaign || l.facebook_campaign || null, 10),
    leadsByForm: buildTopBy(leads, l => l.facebook_form_name, 8),
    attendanceByWeekday: buildAttendanceByWeekday(appts),
    originSplit: buildOriginSplit(leads),
    availableCampaigns,
    availableForms,
    availableOwners,
    availableTenants,
  };
}

export { STAGE_LABELS };
