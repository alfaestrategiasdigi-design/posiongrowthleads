// Dicionário de labels por tipo de negócio do tenant.
// Permite reaproveitar toda a estrutura clínica para clientes de infoproduto
// apenas trocando os textos exibidos na UI.

export type BusinessType = "clinica" | "infoproduto";

export interface TenantLabels {
  patient: string;         // "Paciente" / "Cliente"
  patientPlural: string;
  appointment: string;     // "Agendamento" / "Sessão"
  appointmentVerb: string; // "Agendar consulta" / "Agendar sessão"
  procedure: string;       // "Procedimento" / "Produto"
  activePatients: string;  // label do menu
  schedule: string;        // "Agenda" / "Sessões"
  medicalRecord: string;   // "Prontuário"
}

const CLINICA: TenantLabels = {
  patient: "Paciente",
  patientPlural: "Pacientes",
  appointment: "Agendamento",
  appointmentVerb: "Agendar consulta",
  procedure: "Procedimento",
  activePatients: "Pacientes Ativos",
  schedule: "Agenda",
  medicalRecord: "Prontuário",
};

const INFOPRODUTO: TenantLabels = {
  patient: "Cliente",
  patientPlural: "Clientes",
  appointment: "Sessão",
  appointmentVerb: "Agendar sessão",
  procedure: "Produto",
  activePatients: "Clientes Ativos",
  schedule: "Sessões",
  medicalRecord: "Ficha",
};

export function getTenantLabels(businessType?: string | null): TenantLabels {
  return businessType === "infoproduto" ? INFOPRODUTO : CLINICA;
}

export function isInfoproduto(businessType?: string | null): boolean {
  return businessType === "infoproduto";
}
