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
  tenant_id?: string | null;
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
  tenant_id?: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender: "cliente" | "usuario";
  conteudo: string;
  tipo: "text" | "image" | "audio" | "video" | "document";
  media_url: string | null;
  media_type?: string | null;
  media_mime?: string | null;
  status?: string | null;
  tipo_disparo?: string | null;
  lida: boolean;
  created_at: string;
  wamid?: string | null;
  reply_to_wamid?: string | null;
  reply_preview?: string | null;
  deleted_at?: string | null;
  edited_at?: string | null;
  location?: { lat?: number; lng?: number; name?: string | null; address?: string | null } | null;
  contact_card?: { name?: string | null; vcard?: string | null; contacts?: any[] | null } | null;
  tenant_id?: string | null;
  direction?: "inbound" | "outbound" | null;
}

export interface MessageReaction {
  id: string;
  message_wamid: string;
  conversation_id: string;
  actor_jid: string;
  from_me: boolean;
  emoji: string;
  created_at: string;
  tenant_id?: string | null;
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

// Funil padronizado POSION — etapas do Kanban administrativo (admin master, reunião)
// Funil B2B da agência POSION Master — jornada de captação de clínicas
export const PIPELINE_STAGES = [
  { id: "lead",              title: "Clínica Interessada",   short: "Interessada",     color: "from-blue-500 to-blue-600",       hex: "#3b82f6" },
  { id: "qualificado",       title: "MQL Qualificada",       short: "MQL",             color: "from-violet-500 to-violet-600",   hex: "#8b5cf6" },
  { id: "agendar_reuniao",   title: "Agendar Reunião",       short: "Agendar",         color: "from-pink-500 to-pink-600",       hex: "#ec4899" },
  { id: "reuniao_agendada",  title: "Reunião Agendada",      short: "Reunião",         color: "from-red-500 to-red-600",         hex: "#ef4444" },
  { id: "proposta",          title: "Reunião Efetuada",      short: "Reunião Efet.",   color: "from-orange-500 to-orange-600",   hex: "#f97316" },
  { id: "negociacao",        title: "Proposta Enviada",      short: "Proposta",        color: "from-amber-500 to-amber-600",     hex: "#f59e0b" },
  { id: "ganho",             title: "Contrato Assinado",     short: "Contrato",        color: "from-emerald-500 to-emerald-600", hex: "#10b981" },
  { id: "ativo",             title: "Cliente Ativo",         short: "Cliente Ativo",   color: "from-teal-500 to-teal-600",       hex: "#14b8a6" },
  { id: "perdido",           title: "Perdido",               short: "Perdido",         color: "from-rose-500 to-rose-600",       hex: "#f43f5e" },
] as const;

// Funil para clientes/tenants — mesmas etapas, mas com linguagem de consulta médica
export const CLIENT_PIPELINE_STAGES = [
  { id: "lead",              title: "Lead Novo",             short: "Lead Novo",       color: "from-blue-500 to-blue-600",       hex: "#3b82f6" },
  { id: "qualificado",       title: "Início de Atendimento", short: "Início Atend.",   color: "from-violet-500 to-violet-600",   hex: "#8b5cf6" },
  { id: "agendar_reuniao",   title: "Agendar Consulta",      short: "Agendar",         color: "from-pink-500 to-pink-600",       hex: "#ec4899" },
  { id: "reuniao_agendada",  title: "Consulta Agendada",     short: "Consulta",        color: "from-red-500 to-red-600",         hex: "#ef4444" },
  { id: "proposta",          title: "Proposta",              short: "Proposta",        color: "from-orange-500 to-orange-600",   hex: "#f97316" },
  { id: "negociacao",        title: "Negociação",            short: "Negociação",      color: "from-amber-500 to-amber-600",     hex: "#f59e0b" },
  { id: "ganho",             title: "Ganho",                 short: "Ganho",           color: "from-emerald-500 to-emerald-600", hex: "#10b981" },
  { id: "ativo",             title: "Paciente Ativo",        short: "Paciente Ativo",  color: "from-teal-500 to-teal-600",       hex: "#14b8a6" },
  { id: "perdido",           title: "Perdido",               short: "Perdido",         color: "from-rose-500 to-rose-600",       hex: "#f43f5e" },
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number]["id"];

export const ORIGEM_LABELS: Record<string, { label: string; color: string }> = {
  site:         { label: "Site",          color: "bg-accent/15 text-accent" },
  facebook_ads: { label: "Facebook Ads",  color: "bg-blue-500/15 text-blue-400" },
  whatsapp:     { label: "WhatsApp",      color: "bg-green-500/15 text-green-400" },
  indicacao:    { label: "Indicação",     color: "bg-purple-500/15 text-purple-400" },
  outro:        { label: "Outro",         color: "bg-muted text-muted-foreground" },
};
