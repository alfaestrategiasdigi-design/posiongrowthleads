export interface Lead {
  id: string;
  nome_completo: string;
  whatsapp: string;
  email: string | null;
  nome_empresa: string | null;
  cnpj: string | null;
  cidade_estado: string | null;
  tipo_purchase: string | null;
  especialidade: string | null;
  num_profissionais: string | null;
  investiu_trafego: string | null;
  faturamento_mensal: string | null;
  revendedor_iniciante: boolean;
  created_at: string;
  status: string;
  // Pipeline B2B SaaS
  origem?: string | null;
  mql?: boolean | null;
  sql_qualified?: boolean | null;
  reuniao_agendada_em?: string | null;
  reuniao_realizada_em?: string | null;
  proposta_enviada_em?: string | null;
  valor_proposta?: number | null;
  fechado_em?: string | null;
  motivo_perda?: string | null;
  facebook_lead_id?: string | null;
  facebook_form_id?: string | null;
  facebook_campaign?: string | null;
  utm_source?: string | null;
  utm_medium?: string | null;
  utm_campaign?: string | null;
  observacoes?: string | null;
}

export interface Conversation {
  id: string;
  lead_id: string | null;
  telefone: string;
  nome_contato: string | null;
  foto_url: string | null;
  ultima_mensagem: string | null;
  ultima_interacao: string | null;
  nao_lidas: number;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender: "cliente" | "usuario";
  conteudo: string;
  tipo: "text" | "image" | "audio" | "video" | "document";
  media_url: string | null;
  lida: boolean;
  created_at: string;
}

export interface ZapiConnection {
  id: string;
  instance_id: string;
  token: string;
  client_token: string;
  webhook_url: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// Pipeline B2B SaaS — etapas oficiais (em ordem)
export const PIPELINE_STAGES = [
  { id: "novo",              title: "Novo Lead",          short: "Novo",         color: "from-slate-500 to-slate-600",     hex: "#64748b" },
  { id: "mql",               title: "MQL",                short: "MQL",          color: "from-sky-500 to-sky-600",         hex: "#0ea5e9" },
  { id: "sql",               title: "SQL",                short: "SQL",          color: "from-blue-500 to-blue-600",       hex: "#3b82f6" },
  { id: "reuniao_agendada",  title: "Reunião Agendada",   short: "R. Agendada",  color: "from-indigo-500 to-indigo-600",   hex: "#6366f1" },
  { id: "reuniao_realizada", title: "Reunião Realizada",  short: "R. Realizada", color: "from-violet-500 to-violet-600",   hex: "#8b5cf6" },
  { id: "proposta",          title: "Proposta Enviada",   short: "Proposta",     color: "from-purple-500 to-purple-600",   hex: "#a855f7" },
  { id: "negociacao",        title: "Negociação",         short: "Negociação",   color: "from-amber-500 to-amber-600",     hex: "#f59e0b" },
  { id: "ganho",             title: "Fechado Ganho",      short: "Ganho",        color: "from-emerald-500 to-emerald-600", hex: "#10b981" },
  { id: "perdido",           title: "Fechado Perdido",    short: "Perdido",      color: "from-rose-500 to-rose-600",       hex: "#f43f5e" },
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number]["id"];

export const ORIGEM_LABELS: Record<string, { label: string; color: string }> = {
  site:         { label: "Site",          color: "bg-accent/15 text-accent" },
  facebook_ads: { label: "Facebook Ads",  color: "bg-blue-500/15 text-blue-400" },
  whatsapp:     { label: "WhatsApp",      color: "bg-green-500/15 text-green-400" },
  indicacao:    { label: "Indicação",     color: "bg-purple-500/15 text-purple-400" },
  outro:        { label: "Outro",         color: "bg-muted text-muted-foreground" },
};
