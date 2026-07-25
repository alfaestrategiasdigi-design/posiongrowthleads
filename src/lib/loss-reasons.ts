export const LOSS_REASONS = [
  { id: "sem_orcamento", label: "Sem orçamento" },
  { id: "concorrente", label: "Escolheu concorrente" },
  { id: "nao_respondeu", label: "Não respondeu" },
  { id: "fora_perfil", label: "Fora do perfil" },
  { id: "desistiu", label: "Desistiu do procedimento" },
  { id: "sem_interesse", label: "Sem interesse no momento" },
  { id: "outro", label: "Outro (especificar)" },
] as const;

export type LossReasonId = typeof LOSS_REASONS[number]["id"];

export function getLossReasonLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const found = LOSS_REASONS.find((r) => r.id === value || r.label === value);
  if (found) return found.label;
  return value;
}
