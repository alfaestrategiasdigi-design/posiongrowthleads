export type Scope = "admin" | "tenant";

export interface RelatorioFilters {
  from: string; // yyyy-MM-dd
  to: string;   // yyyy-MM-dd
  tenantIds: string[];     // vazio = todos (só faz sentido em admin)
  campaigns: string[];     // utm_campaign ou facebook_campaign
  forms: string[];         // facebook_form_name
  ownerIds: string[];      // owner_user_id
  adAccountIds: string[];  // tenant_ad_accounts.ad_account_id
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
}

export interface FunilStage {
  id: string;
  label: string;
  count: number;
  pctTotal: number;
  pctPrev: number | null;
}

export interface RelatorioData {
  leads: LeadRow[];
  appointments: AppointmentRow[];
  insights: InsightRow[];
  spend: SpendRow[];
  kpis: Kpis;
  funil: FunilStage[];
  leadsByDay: { date: string; count: number }[];
  leadsByCampaign: { name: string; count: number }[];
  leadsByForm: { name: string; count: number }[];
  attendanceByWeekday: { day: string; compareceu: number; noShow: number }[];
  originSplit: { name: string; value: number }[];
  // opções pra popular filtros
  availableCampaigns: string[];
  availableForms: string[];
  availableOwners: { id: string; label: string }[];
  availableTenants: { id: string; name: string }[];
  availableAdAccounts: { id: string; label: string }[];
}
