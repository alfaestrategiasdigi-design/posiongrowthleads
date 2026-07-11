/**
 * Registry central de campos por tipo de entidade.
 *
 * Objetivo: eliminar o vazamento de campos B2B (CNPJ, num_profissionais,
 * especialidade, investiu_trafego) em contextos onde não fazem sentido
 * (paciente de clínica, cliente promovido de clínica, etc).
 *
 * Uso atual (Fase 2):
 *  - 'form_lead'   → lead do formulário público (tabela `leads`) em contexto Master
 *  - 'agency_lead' → lead da agência (tabela `agency_leads`, pipeline Master)
 *
 * Reservados para Fase 3 (ainda não plugados na UI):
 *  - 'clinic_lead'    → lead da clínica (tabela `clinic_leads`, kanban do tenant)
 *  - 'patient'        → paciente promovido dentro do tenant
 *  - 'tenant_client'  → clínica-cliente vista do Master (tenant + tenant_client_profile)
 */

export type EntityKind =
  | "form_lead"
  | "agency_lead"
  | "clinic_lead"
  | "patient"
  | "tenant_client";

/**
 * Campos B2B (prospecção de clínica) — só existem para leads B2B do funil de agência.
 * NUNCA devem aparecer para paciente ou lead de clínica.
 */
export type B2BField = "especialidade" | "num_profissionais" | "investiu_trafego" | "cnpj";

export interface EntityFieldsConfig {
  /** Campos exibidos na aba Resumo (diagnóstico rápido). */
  summary: {
    /** Mostra bloco B2B (especialidade / nº profissionais / investiu tráfego / CNPJ). */
    b2bBlock: boolean;
    /** Mostra faturamento/plano de interesse ("volume"). */
    volume: boolean;
    /** Mostra empresa/nome da clínica no strip superior e no resumo. */
    company: boolean;
    /** Mostra datas de reunião realizada / próxima. */
    meetingDates: boolean;
  };
  /** Aba de respostas do formulário público (só faz sentido para leads vindos de form). */
  formAnswers: boolean;
  /** Aba de qualificação SDR. */
  sdr: boolean;
  /** Aba de tarefas. */
  tasks: boolean;
}

export const FIELDS_BY_KIND: Record<EntityKind, EntityFieldsConfig> = {
  form_lead: {
    summary: { b2bBlock: true, volume: true, company: true, meetingDates: true },
    formAnswers: true,
    sdr: true,
    tasks: true,
  },
  agency_lead: {
    summary: { b2bBlock: true, volume: true, company: true, meetingDates: true },
    formAnswers: true, // agency_lead pode ter source_lead_id → mostra respostas do form vinculado
    sdr: true,
    tasks: true,
  },
  clinic_lead: {
    summary: { b2bBlock: false, volume: false, company: false, meetingDates: true },
    formAnswers: false,
    sdr: true,
    tasks: true,
  },
  patient: {
    summary: { b2bBlock: false, volume: false, company: false, meetingDates: false },
    formAnswers: false,
    sdr: false,
    tasks: true,
  },
  tenant_client: {
    summary: { b2bBlock: false, volume: false, company: true, meetingDates: true },
    formAnswers: false,
    sdr: false,
    tasks: true,
  },
};

/**
 * Default legado: reproduz EXATAMENTE o comportamento anterior do UnifiedLeadPanel
 * quando nenhum entityKind explícito é passado pelo call site.
 *
 * Regra pré-registry:
 *  - source='lead' fora de /app/ (contexto Master) → mostrava campos B2B → 'form_lead'
 *  - source='lead' dentro de /app/ (tenant)        → ocultava B2B         → 'clinic_lead'
 *  - source='agency_lead'                          → sempre B2B          → 'agency_lead'
 */
export function resolveEntityKindLegacy(
  source: "lead" | "agency_lead" | null | undefined,
  isTenantContext: boolean,
): EntityKind {
  if (source === "agency_lead") return "agency_lead";
  // source === 'lead' (ou null → assume form)
  return isTenantContext ? "clinic_lead" : "form_lead";
}
