// Shared types for the automation builder.

export type TriggerKind =
  | "message_received"
  | "form_submitted"
  | "kanban_moved"
  | "appointment_created"
  | "appointment_confirmed"
  | "appointment_cancelled"
  | "time_delay"
  | "lead_entered"
  | "lead_won"
  | "manual"
  | "birthday";

export type NodeKind =
  | "trigger"
  | "message"
  | "buttons"
  | "list"
  | "audio"
  | "media"
  | "wait_response"
  | "wait"
  | "kanban_move"
  | "kanban_create"
  | "kanban_update"
  | "kanban_tag"
  | "appointment_create"
  | "appointment_link"
  | "appointment_confirm"
  | "appointment_cancel"
  | "condition"
  | "split"
  | "end"
  | "notify_team";

export interface FlowNode {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  data: Record<string, any>;
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  label?: string;
}

export interface AutomationFlow {
  id: string;
  tenant_id: string | null;
  is_admin_master: boolean;
  name: string;
  description: string | null;
  trigger_type: TriggerKind;
  trigger_config: Record<string, any>;
  nodes: FlowNode[];
  edges: FlowEdge[];
  status: "draft" | "active" | "paused";
  created_at: string;
  updated_at: string;
}

export interface AutomationTemplate {
  id: string;
  tenant_id: string | null;
  is_global: boolean;
  category: "agencia" | "clinica";
  name: string;
  description: string | null;
  icon: string | null;
  trigger_type: TriggerKind;
  trigger_config: Record<string, any>;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface AutomationTask {
  id: string;
  tenant_id: string | null;
  contact_name: string | null;
  contact_phone: string;
  message_content: string;
  scheduled_for: string;
  status: "pending" | "approved" | "sent" | "cancelled" | "failed";
  requires_approval: boolean;
  sent_at: string | null;
  send_error: string | null;
  created_at: string;
}

export const TRIGGERS: { kind: TriggerKind; label: string; icon: string; scope: "both" | "agencia" | "clinica" }[] = [
  { kind: "message_received", label: "Mensagem recebida no WhatsApp", icon: "📱", scope: "both" },
  { kind: "form_submitted", label: "Formulário preenchido", icon: "📋", scope: "both" },
  { kind: "kanban_moved", label: "Lead movido no Kanban", icon: "🃏", scope: "both" },
  { kind: "appointment_created", label: "Agendamento criado", icon: "📅", scope: "clinica" },
  { kind: "appointment_confirmed", label: "Agendamento confirmado", icon: "✅", scope: "clinica" },
  { kind: "appointment_cancelled", label: "Agendamento cancelado", icon: "❌", scope: "clinica" },
  { kind: "time_delay", label: "Após tempo de um evento", icon: "⏰", scope: "both" },
  { kind: "lead_entered", label: "Lead entra (Facebook Ads)", icon: "🎯", scope: "both" },
  { kind: "lead_won", label: "Lead marcado como GANHO", icon: "🏆", scope: "both" },
  { kind: "birthday", label: "Aniversário do paciente", icon: "🎂", scope: "clinica" },
  { kind: "manual", label: "Início manual", icon: "▶️", scope: "both" },
];

export const NODE_PALETTE: {
  group: string;
  color: string;
  items: { kind: NodeKind; label: string; icon: string }[];
}[] = [
  {
    group: "Mensagens",
    color: "hsl(210 90% 60%)",
    items: [
      { kind: "message", label: "Enviar texto", icon: "💬" },
      { kind: "buttons", label: "Menu de opções", icon: "🔘" },
      { kind: "list", label: "Lista de opções", icon: "📋" },
      { kind: "audio", label: "Enviar áudio", icon: "🎙️" },
      { kind: "media", label: "Imagem / documento", icon: "🖼️" },
      { kind: "wait_response", label: "Aguardar resposta", icon: "⌛" },
    ],
  },
  {
    group: "Kanban",
    color: "hsl(150 70% 50%)",
    items: [
      { kind: "kanban_move", label: "Mover lead para coluna", icon: "➡️" },
      { kind: "kanban_create", label: "Criar novo lead", icon: "➕" },
      { kind: "kanban_update", label: "Atualizar campo do lead", icon: "✏️" },
      { kind: "kanban_tag", label: "Adicionar tag", icon: "🏷️" },
    ],
  },
  {
    group: "Agenda",
    color: "hsl(45 90% 55%)",
    items: [
      { kind: "appointment_create", label: "Criar agendamento", icon: "📅" },
      { kind: "appointment_link", label: "Enviar link agendamento", icon: "🔗" },
      { kind: "appointment_confirm", label: "Confirmar agendamento", icon: "✅" },
      { kind: "appointment_cancel", label: "Cancelar agendamento", icon: "❌" },
    ],
  },
  {
    group: "Sistema",
    color: "hsl(0 0% 55%)",
    items: [
      { kind: "wait", label: "Aguardar X horas/dias", icon: "⏳" },
      { kind: "condition", label: "Condição (se/então)", icon: "❓" },
      { kind: "split", label: "Dividir fluxo A/B", icon: "🔀" },
      { kind: "end", label: "Encerrar fluxo", icon: "🛑" },
      { kind: "notify_team", label: "Notificar equipe interna", icon: "🔔" },
    ],
  },
];

export const AVAILABLE_VARIABLES: { token: string; description: string }[] = [
  { token: "{{lead.nome}}", description: "Nome do lead" },
  { token: "{{lead.whatsapp}}", description: "Telefone do lead" },
  { token: "{{lead.email}}", description: "E-mail do lead" },
  { token: "{{lead.produto}}", description: "Produto / procedimento" },
  { token: "{{agendamento.data}}", description: "Data da consulta" },
  { token: "{{agendamento.hora}}", description: "Hora da consulta" },
  { token: "{{clinica.nome}}", description: "Nome da clínica" },
  { token: "{{clinica.endereco}}", description: "Endereço da clínica" },
];

export function nodeColor(type: NodeKind): string {
  if (type === "trigger") return "hsl(280 85% 65%)";
  if (["message", "buttons", "list", "audio", "media", "wait_response"].includes(type))
    return "hsl(210 90% 60%)";
  if (["condition", "split"].includes(type)) return "hsl(45 90% 55%)";
  if (["kanban_move", "kanban_create", "kanban_update", "kanban_tag"].includes(type))
    return "hsl(150 70% 50%)";
  if (type === "wait") return "hsl(0 0% 55%)";
  if (type === "end") return "hsl(0 75% 55%)";
  return "hsl(220 15% 55%)";
}
