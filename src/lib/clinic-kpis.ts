// Helpers to compute KPIs from sales/evaluations data — mirrors the report spreadsheet.

export interface SaleRow {
  id: string;
  seller_name: string | null;
  product: string | null;
  amount: number;
  channel: string | null;
  payment_method: string | null;
  sale_date: string;
  first_contact_date: string | null;
  attended: string | null;
  patient_name: string;
  international?: boolean;
}

export const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });

export const PCT = (n: number) => `${(n * 100).toFixed(1)}%`;

export function isEvaluation(s: SaleRow) {
  const p = (s.product || "").toUpperCase();
  return p.includes("AVALIAÇÃO") || p.includes("AVALIACAO") || p.includes("CONSULTA");
}

export function isInternational(s: SaleRow) {
  const n = (s.patient_name || "").toUpperCase();
  return s.international || n.includes("(USA)") || n.includes("(EUA)");
}

export function categorize(s: SaleRow): string {
  const p = (s.product || "").toUpperCase();
  if (p.includes("AVALIAÇÃO") || p.includes("AVALIACAO")) return "Avaliação";
  if (p.includes("GOLD") || p.includes("REMODELAÇÃO") || p.includes("REMODELACAO") || p.includes("HARMONIZE") || p.includes("LINNEA")) return "GOLD/Remodelação";
  if (p.includes("BIOESTIMUL")) return "Bioestimulador";
  if (p.includes("IMPLANTE")) return "Implantes Hormonais";
  if (p.includes("TIRZEP") || p.includes("RETATR") || p.includes("CONTOUR")) return "Emagrecimento";
  if (p.includes("HORMONIO") || p.includes("HORMÔNIO") || p.includes("PEPTIDEO") || p.includes("VITAMINA")) return "Metabólico";
  if (p.includes("TOXINA") || p.includes("BOTOX")) return "Toxina";
  if (p.includes("CONSULTA")) return "Consulta";
  return "Outros";
}

export function summarize(sales: SaleRow[]) {
  const total = sales.reduce((s, r) => s + Number(r.amount || 0), 0);
  const count = sales.length;
  const avg = count ? total / count : 0;
  const maxSale = sales.reduce<SaleRow | null>((m, r) => (!m || r.amount > m.amount ? r : m), null);
  return { total, count, avg, maxSale };
}

export function groupSum<T>(rows: T[], key: (r: T) => string, val: (r: T) => number) {
  const map = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    const k = key(r) || "—";
    const entry = map.get(k) || { total: 0, count: 0 };
    entry.total += val(r);
    entry.count += 1;
    map.set(k, entry);
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, total: v.total, count: v.count, ticket: v.count ? v.total / v.count : 0 }))
    .sort((a, b) => b.total - a.total);
}

export function evaluationFunnel(sales: SaleRow[]) {
  const evals = sales.filter(isEvaluation);
  const sold = evals.length;
  const attended = evals.filter((s) => (s.attended || "").toUpperCase() === "SIM").length;
  const noShow = evals.filter((s) => (s.attended || "").toUpperCase() === "NÃO" || (s.attended || "").toUpperCase() === "NAO").length;
  const future = evals.filter((s) => (s.attended || "").toUpperCase() === "FUTURA").length;
  const attendanceRate = sold ? attended / sold : 0;
  const noShowRate = sold ? noShow / sold : 0;

  // Conversion: patient who had eval + later bought a non-eval procedure
  const evalPatients = new Set(evals.map((e) => e.patient_name));
  const converted = new Set(
    sales.filter((s) => !isEvaluation(s) && evalPatients.has(s.patient_name)).map((s) => s.patient_name)
  );
  const conversionRate = evalPatients.size ? converted.size / evalPatients.size : 0;
  return { sold, attended, noShow, future, attendanceRate, noShowRate, conversionRate, converted: converted.size, evalPatients: evalPatients.size };
}

export function weeklyBreakdown(sales: SaleRow[]) {
  const weeks = new Map<number, { total: number; count: number; from: string; to: string }>();
  for (const s of sales) {
    const d = new Date(s.sale_date + "T00:00:00");
    const day = d.getDate();
    const w = Math.min(5, Math.floor((day - 1) / 7) + 1);
    const e = weeks.get(w) || { total: 0, count: 0, from: s.sale_date, to: s.sale_date };
    e.total += Number(s.amount);
    e.count += 1;
    if (s.sale_date < e.from) e.from = s.sale_date;
    if (s.sale_date > e.to) e.to = s.sale_date;
    weeks.set(w, e);
  }
  return Array.from(weeks.entries()).sort(([a],[b]) => a - b).map(([w, v]) => ({ week: w, ...v, ticket: v.count ? v.total / v.count : 0 }));
}
