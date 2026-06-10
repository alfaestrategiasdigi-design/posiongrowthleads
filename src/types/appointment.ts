export type AppointmentStatus =
  | "agendado"
  | "em_andamento"
  | "realizado"
  | "no_show"
  | "cancelado";

export type AppointmentType =
  | "avaliacao"
  | "procedimento"
  | "retorno"
  | "consulta"
  | "reuniao_comercial";

export interface Appointment {
  id: string;
  lead_id: string | null;
  client_name: string;
  client_phone: string;
  date_time: string;
  duration_minutes: number;
  appointment_type: AppointmentType | string;
  procedure: string | null;
  responsible_user_id: string | null;
  channel: string | null;
  status: AppointmentStatus | string;
  notes: string | null;
  send_reminder: boolean;
  reminder_hours_before: number;
  reminder_sent: boolean;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export const APPOINTMENT_STATUS: Record<
  AppointmentStatus,
  { label: string; color: string; hex: string; bg: string }
> = {
  agendado:     { label: "Agendado",      color: "text-yellow-400",  hex: "#facc15", bg: "bg-yellow-500/15 border-yellow-500/40" },
  em_andamento: { label: "Em andamento",  color: "text-blue-400",    hex: "#3b82f6", bg: "bg-blue-500/15 border-blue-500/40" },
  realizado:    { label: "Realizado",     color: "text-emerald-400", hex: "#10b981", bg: "bg-emerald-500/15 border-emerald-500/40" },
  no_show:      { label: "No-show",       color: "text-rose-400",    hex: "#f43f5e", bg: "bg-rose-500/15 border-rose-500/40" },
  cancelado:    { label: "Cancelado",     color: "text-slate-400",   hex: "#94a3b8", bg: "bg-slate-500/15 border-slate-500/40" },
};

export const APPOINTMENT_TYPES: Record<AppointmentType, string> = {
  avaliacao:         "Avaliação",
  procedimento:      "Procedimento",
  retorno:           "Retorno",
  consulta:          "Consulta",
  reuniao_comercial: "Reunião comercial",
};

export const DURATIONS = [15, 30, 45, 60, 90, 120];

export const CHANNELS = [
  "Instagram",
  "Tráfego Pago",
  "Indicação",
  "WhatsApp",
  "Site",
  "Facebook Ads",
  "Outro",
];

export const REMINDER_OPTIONS = [
  { value: 0,  label: "Não enviar" },
  { value: 1,  label: "1 hora antes" },
  { value: 2,  label: "2 horas antes" },
  { value: 6,  label: "6 horas antes" },
  { value: 12, label: "12 horas antes" },
  { value: 24, label: "24 horas antes (padrão)" },
  { value: 48, label: "48 horas antes" },
  { value: 72, label: "3 dias antes" },
];
