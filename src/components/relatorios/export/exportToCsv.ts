import type { LeadRow } from "@/lib/relatorios/types";
import { STAGE_LABELS } from "@/lib/relatorios/aggregators";

const COLS = [
  "Nome","WhatsApp","Status","Campanha","Conjunto","Anúncio","Formulário",
  "utm_source","utm_medium","utm_campaign","utm_content","utm_term",
  "Responsável","Criado em","Agendado em","Realizado em","Proposta enviada em",
  "Valor proposta","Fechado/Perda em","Motivo perda","Valor ganho","Valor perdido",
];

function esc(v: any): string {
  if (v == null) return "";
  const s = String(v).replace(/"/g, '""');
  return /[",;\n]/.test(s) ? `"${s}"` : s;
}
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleString("pt-BR") : ""; }

export function exportLeadsCsv(leads: LeadRow[], scopeLabel: string) {
  const rows = leads.map(l => [
    l.nome_completo, l.whatsapp, STAGE_LABELS[l.status] ?? l.status,
    l.utm_campaign || l.facebook_campaign || "",
    l.facebook_adset_name || "", l.facebook_ad_name || "", l.facebook_form_name || "",
    l.utm_source || "", l.utm_medium || "", l.utm_campaign || "", l.utm_content || "", l.utm_term || "",
    l.owner_user_id || "",
    fmtDate(l.created_at), fmtDate(l.reuniao_agendada_em), fmtDate(l.reuniao_realizada_em), fmtDate(l.proposta_enviada_em),
    l.valor_proposta ?? "",
    fmtDate(l.fechado_em),
    l.motivo_perda || "",
    l.status === "ganho" ? (l.valor_proposta ?? "") : "",
    l.status === "perdido" ? (l.valor_perdido ?? "") : "",
  ].map(esc).join(";"));

  const csv = "\uFEFF" + [COLS.join(";"), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `relatorio_${scopeLabel}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
