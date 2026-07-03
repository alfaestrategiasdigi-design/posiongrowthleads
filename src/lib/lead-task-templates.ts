// Templates de tarefas sugeridas com base no perfil de compra ("Você compra para")
// e na faixa do Score SDR. Cada item tem um `key` estável usado para deduplicação
// via coluna `lead_tasks.template_key`.

export type PurchaseBucket = "uso_proprio" | "revenda" | "iniciante" | "outro";
export type ScoreBucket = "quente" | "morno" | "frio";

export interface SuggestedTask {
  key: string;
  title: string;
  subtasks?: string[];
}

const normalize = (v: string | null | undefined) =>
  (v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export function bucketPurchase(tipo?: string | null): PurchaseBucket {
  const s = normalize(tipo);
  if (!s) return "outro";
  if (/(clinica|proprio|uso|consumo)/.test(s)) return "uso_proprio";
  if (/(revenda|distribu|atacado)/.test(s)) return "revenda";
  if (/(iniciante|pesquis|estudando|explorando)/.test(s)) return "iniciante";
  return "outro";
}

export function bucketScore(score?: number | null): ScoreBucket {
  if (score == null) return "frio";
  if (score >= 70) return "quente";
  if (score >= 40) return "morno";
  return "frio";
}

const PURCHASE_TEMPLATES: Record<PurchaseBucket, SuggestedTask[]> = {
  uso_proprio: [
    {
      key: "up.cnpj",
      title: "Confirmar CNPJ e razão social da clínica",
      subtasks: ["Consultar CNPJ na Receita", "Validar sócios/responsável"],
    },
    {
      key: "up.volume",
      title: "Levantar volume atual de pacientes/procedimentos",
    },
    {
      key: "up.ferramentas",
      title: "Mapear ferramentas de gestão em uso hoje",
    },
    {
      key: "up.diagnostico",
      title: "Agendar diagnóstico com especialista POSION",
    },
  ],
  revenda: [
    {
      key: "rv.regiao",
      title: "Validar região de atuação e portfólio atual",
    },
    { key: "rv.volume", title: "Levantar volume mensal de compra" },
    { key: "rv.tabela", title: "Enviar tabela de revenda / distribuidor" },
    { key: "rv.condicoes", title: "Alinhar condições comerciais e prazos" },
  ],
  iniciante: [
    {
      key: "in.material",
      title: "Enviar material educativo (case + vídeo overview)",
    },
    { key: "in.orcamento", title: "Qualificar orçamento disponível" },
    { key: "in.timeline", title: "Explorar timeline de decisão" },
  ],
  outro: [
    { key: "ot.objetivo", title: "Confirmar objetivo da compra com o lead" },
    { key: "ot.dados", title: "Coletar dados básicos faltantes" },
  ],
};

const SCORE_TEMPLATES: Record<ScoreBucket, SuggestedTask[]> = {
  quente: [
    { key: "sc.hot.reuniao", title: "Agendar reunião de proposta em ≤48h" },
    { key: "sc.hot.proposta", title: "Preparar proposta comercial personalizada" },
    { key: "sc.hot.followup", title: "Enviar follow-up no WhatsApp hoje" },
  ],
  morno: [
    { key: "sc.warm.case", title: "Enviar case de sucesso do segmento" },
    { key: "sc.warm.call", title: "Agendar call de descoberta em 5 dias" },
    { key: "sc.warm.touch", title: "Registrar próximo touchpoint na agenda" },
  ],
  frio: [
    { key: "sc.cold.nutrir", title: "Nutrir com conteúdo (2 mensagens em 7 dias)" },
    { key: "sc.cold.reagendar", title: "Reagendar qualificação em 15 dias" },
  ],
};

export function getSuggestedTasks(input: {
  tipoPurchase?: string | null;
  sdrScore?: number | null;
}): SuggestedTask[] {
  const p = bucketPurchase(input.tipoPurchase);
  const s = bucketScore(input.sdrScore);
  // Evita duplicar por chave se algum dia listas se sobrepuserem
  const seen = new Set<string>();
  const out: SuggestedTask[] = [];
  for (const t of [...PURCHASE_TEMPLATES[p], ...SCORE_TEMPLATES[s]]) {
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    out.push(t);
  }
  return out;
}

export const TEMPLATE_VERSION = 1;
