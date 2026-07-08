// Extrai e formata o valor de "faturamento" de um lead, olhando
// primeiro a coluna dedicada e caindo em `extras.form_fields` quando vazio.

type LeadLike = {
  faturamento_mensal?: string | null;
  extras?: any;
};

const KEYWORDS = ["faturamento", "revenue", "receita", "billing"];

function stripAccents(s: string) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function matchesFaturamento(key: string | null | undefined): boolean {
  if (!key) return false;
  const norm = stripAccents(String(key)).toLowerCase();
  return KEYWORDS.some((k) => norm.includes(k));
}

/** Formata "de_r$30_mil_a_r$50_mil" em "De R$30 mil a R$50 mil". */
export function formatFaturamentoValue(raw: string | null | undefined): string {
  if (!raw) return "—";
  let v = String(raw).trim();
  if (!v) return "—";
  // troca separadores comuns do Meta
  v = v.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  // deixa "r$" como "R$"
  v = v.replace(/r\$/gi, "R$");
  // capitaliza a primeira letra
  v = v.charAt(0).toUpperCase() + v.slice(1);
  return v;
}

/** Devolve o valor bruto do faturamento (sem formatação), ou null. */
export function extractFaturamentoRaw(lead: LeadLike): string | null {
  if (lead.faturamento_mensal && String(lead.faturamento_mensal).trim() !== "") {
    return String(lead.faturamento_mensal);
  }
  const extras = lead.extras;
  if (!extras || typeof extras !== "object") return null;

  const fields = Array.isArray(extras.form_fields) ? extras.form_fields : null;
  if (fields) {
    for (const f of fields) {
      if (!f || typeof f !== "object") continue;
      if (matchesFaturamento(f.name) || matchesFaturamento(f.label)) {
        if (f.value != null && String(f.value).trim() !== "") return String(f.value);
      }
    }
  }
  // fallback: chaves diretas no extras
  for (const [k, v] of Object.entries(extras)) {
    if (matchesFaturamento(k) && v != null && String(v).trim() !== "") {
      return String(v);
    }
  }
  return null;
}

/** Valor pronto para exibição na UI. */
export function getFaturamento(lead: LeadLike): string {
  return formatFaturamentoValue(extractFaturamentoRaw(lead));
}
