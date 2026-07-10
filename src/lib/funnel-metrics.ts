/**
 * Fonte única para as taxas de conversão do funil.
 *
 * Regras (todas as métricas usam o mesmo período [from, to]):
 * - Qualificação   = leads qualificados ÷ leads criados
 *   qualificado = mql || sql_qualified || status ∈ {qualificado, reuniao_agendada, compareceu, negociacao, ganho}
 * - Agendamento    = leads distintos com appointment (status ≠ cancelado) no período ÷ qualificados
 * - Comparecimento = appts com status realizado/compareceu ÷ (realizados + no-show)
 * - No-show        = appts com status no_show/faltou ÷ (realizados + no-show)
 * - Fechamento     = ganhos ÷ compareceu (leads distintos que compareceram)
 * - Conv. Geral    = ganhos ÷ leads criados
 *
 * Datas:
 * - `created_at` para leads
 * - `date_time` para appointments (evento real)
 */

export interface FunnelLead {
  id: string;
  status: string | null;
  created_at: string | null;
  mql?: boolean | null;
  sql_qualified?: boolean | null;
}

export interface FunnelAppointment {
  id: string;
  lead_id: string | null;
  date_time: string | null;
  status: string | null;
}

export interface FunnelTotals {
  totalLeads: number;
  qualificados: number;
  agendados: number;
  compareceram: number;
  ganhos: number;
  noShowCount: number;
  perdidoCount: number;
  decididos: number;
}

export interface FunnelRates {
  qualificacao: number;
  agendamento: number;
  comparecimento: number;
  fechamento: number;
  noShow: number;
  geral: number;
  totals: FunnelTotals;
}

const QUALIFIED_STATUSES = new Set([
  "qualificado", "reuniao_agendada", "compareceu", "negociacao", "ganho",
]);

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  return new Date(v.length === 10 ? v + "T12:00:00" : v);
}

function inRange(dateStr: string | null | undefined, from: Date, to: Date): boolean {
  const d = toDate(dateStr);
  if (!d) return false;
  return d >= from && d <= to;
}

export function isQualifiedLead(l: FunnelLead): boolean {
  if (l.mql || l.sql_qualified) return true;
  return QUALIFIED_STATUSES.has(String(l.status || "").toLowerCase());
}

/** Numerator id → predicate that decides if a lead belongs to that metric's set. */
export interface LeadsByMetric {
  qualificacao: Set<string>;
  agendamento: Set<string>;
  comparecimento: Set<string>;
  noShow: Set<string>;
  fechamento: Set<string>;
  geral: Set<string>;
}

export interface FunnelResult {
  rates: FunnelRates;
  leadsByMetric: LeadsByMetric;
}

export function computeFunnelMetrics(params: {
  leads: FunnelLead[];
  appointments: FunnelAppointment[];
  from: Date;
  to: Date;
}): FunnelResult {
  const { leads, appointments, from, to } = params;

  const periodLeads = leads.filter((l) => inRange(l.created_at, from, to));
  const totalLeads = periodLeads.length;

  const qualificadosSet = new Set<string>();
  const ganhosSet = new Set<string>();
  let perdidoCount = 0;
  for (const l of periodLeads) {
    if (isQualifiedLead(l)) qualificadosSet.add(l.id);
    const st = String(l.status || "").toLowerCase();
    if (st === "ganho") ganhosSet.add(l.id);
    else if (st === "perdido") perdidoCount++;
  }

  // Appointments no período (por date_time)
  const periodAppts = appointments.filter((a) => inRange(a.date_time, from, to));

  const agendadosSet = new Set<string>();
  const compareceramSet = new Set<string>();
  const noShowSet = new Set<string>();
  let compareceuCount = 0;
  let noShowCount = 0;

  for (const a of periodAppts) {
    const st = String(a.status || "").toLowerCase();
    if (st === "cancelado") continue;
    if (a.lead_id) agendadosSet.add(a.lead_id);
    if (st === "realizado" || st === "compareceu") {
      compareceuCount++;
      if (a.lead_id) compareceramSet.add(a.lead_id);
    } else if (st === "no_show" || st === "faltou") {
      noShowCount++;
      if (a.lead_id) noShowSet.add(a.lead_id);
    }
  }

  const qualificados = qualificadosSet.size;
  const agendados = agendadosSet.size;
  const ganhos = ganhosSet.size;
  const decididos = compareceuCount + noShowCount;

  const rates: FunnelRates = {
    qualificacao:  totalLeads    ? qualificados / totalLeads    : 0,
    agendamento:   qualificados  ? agendados    / qualificados  : 0,
    comparecimento: decididos    ? compareceuCount / decididos  : 0,
    fechamento:    compareceramSet.size ? ganhos / compareceramSet.size : 0,
    noShow:        decididos     ? noShowCount / decididos      : 0,
    geral:         totalLeads    ? ganhos       / totalLeads    : 0,
    totals: {
      totalLeads,
      qualificados,
      agendados,
      compareceram: compareceuCount,
      ganhos,
      noShowCount,
      perdidoCount,
      decididos,
    },
  };

  return {
    rates,
    leadsByMetric: {
      qualificacao: qualificadosSet,
      agendamento: agendadosSet,
      comparecimento: compareceramSet,
      noShow: noShowSet,
      fechamento: ganhosSet,
      geral: ganhosSet,
    },
  };
}
