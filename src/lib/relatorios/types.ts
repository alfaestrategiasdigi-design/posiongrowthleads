export type Scope = "admin" | "tenant";

export interface RelatorioFilters {
  from: string; // yyyy-MM-dd
  to: string;   // yyyy-MM-dd
  tenantIds: string[];     // vazio = todos (só faz sentido em admin)
  campaigns: string[];     // utm_campaign ou facebook_campaign
  forms: string[];         // facebook_form_name
  ownerIds: string[];      // owner_user_id
  origem: "all" | "paid" | "organic";
}

export interface LeadRow {
  id: string;
  tenant_id: string | null;
  nome_completo: string;
  whatsapp: string;
  status: string;
  origem: string | null;
  is_organic: boolean | null;
  facebook_campaign: string | null;
  facebook_adset_name: string | null;
  facebook_ad_name: string | null;
  facebook_form_name: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  owner_user_id: string | null;
  valor_proposta: number | null;
  valor_perdido: number | null;
  motivo_perda: string | null;
  mql: boolean | null;
  sql_qualified: boolean | null;
  reuniao_agendada_em: string | null;
  reuniao_realizada_em: string | null;
  proposta_enviada_em: string | null;
  fechado_em: string | null;
  created_at: string;
}

export interface AppointmentRow {
  id: string;
  tenant_id: string | null;
  lead_id: string | null;
  date_time: string;
  status: string | null;
}

export interface InsightRow {
  tenant_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  spend: number | null;
  leads: number | null;
  cost_per_lead: number | null;
  date_start: string;
}

export interface SpendRow {
  tenant_id: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  amount_spent: number | null;
  period_start: string;
  period_end: string;
}

export interface SaleRow {
  id: string;
  tenant_id: string;
  seller_name: string | null;
  product: string | null;
  procedure_name: string | null;
  channel: string | null;
  channel_origin: string | null;
  amount: number;
  sale_date: string;
  first_contact_date: string | null;
  patient_id: string | null;
}

export interface GoalRow {
  tenant_id: string;
  year: number;
  month: number;
  goal_1: number;
  goal_2: number;
  goal_3: number;
}

export interface Kpis {
  totalLeads: number;
  qualificados: number;
  taxaQualificacao: number;
  agendamentos: number;
  compareceu: number;
  noShow: number;
  taxaComparecimento: number;
  ganhos: number;
  taxaConversao: number;
  valorGanho: number;
  valorPerdido: number;
  investimento: number;
  cpl: number;
  cac: number;
  // ---- Novos KPIs financeiros (BI antigo) ----
  vendasTotal: number;         // soma sales.amount no período
  vendasQtd: number;           // contagem de sales
  novaVenda: number;           // vendas onde first_contact_date está no período
  monetizacao: number;         // vendas de recompra (patient_id já teve venda anterior)
  meta: number;                // soma de monthly_goals (goal_3) dos meses no período
  naoRealizado: number;        // max(meta - vendasTotal, 0)
  ticketMedio: number;         // vendasTotal / vendasQtd
  cpa: number;                 // investimento / vendasQtd
  cpmql: number;               // investimento / qtd mql
  cpsql: number;               // investimento / qtd sql_qualified
}

export interface FunilStage {
  id: string;
  label: string;
  count: number;
  pctTotal: number;
  pctPrev: number | null;
}

export interface RankingItem {
  name: string;
  total: number;
  count: number;
}

export interface RelatorioData {
  leads: LeadRow[];
  appointments: AppointmentRow[];
  insights: InsightRow[];
  spend: SpendRow[];
  sales: SaleRow[];
  goals: GoalRow[];
  kpis: Kpis;
  funil: FunilStage[];
  biFunnel: FunilStage[];
  leadsByDay: { date: string; count: number }[];
  leadsByCampaign: { name: string; count: number }[];
  leadsByForm: { name: string; count: number }[];
  attendanceByWeekday: { day: string; compareceu: number; noShow: number }[];
  originSplit: { name: string; value: number }[];
  // BI antigo
  rankingClosers: RankingItem[];
  rankingSdrs: RankingItem[];
  salesByProduct: { name: string; total: number }[];
  monetizedByProduct: { name: string; total: number }[];
  channelConversion: { name: string; rate: number; sales: number; leads: number }[];
  channelSql: { name: string; rate: number; sql: number; leads: number }[];
  // opções pra popular filtros
  availableCampaigns: string[];
  availableForms: string[];
  availableOwners: { id: string; label: string }[];
  availableTenants: { id: string; name: string }[];
}
