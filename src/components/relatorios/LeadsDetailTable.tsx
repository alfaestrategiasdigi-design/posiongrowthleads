import { useMemo, useState } from "react";
import type { LeadRow } from "@/lib/relatorios/types";
import { STAGE_LABELS } from "@/lib/relatorios/aggregators";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";

const fmt = (d: string | null) => d ? new Date(d).toLocaleDateString("pt-BR") : "—";
const fmtBRL = (n: number | null) => n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const PAGE_SIZE = 25;

export default function LeadsDetailTable({ leads }: { leads: LeadRow[] }) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!q) return leads;
    const s = q.toLowerCase();
    return leads.filter(l =>
      l.nome_completo.toLowerCase().includes(s) ||
      (l.whatsapp || "").includes(q) ||
      (l.utm_campaign || "").toLowerCase().includes(s) ||
      (l.facebook_form_name || "").toLowerCase().includes(s)
    );
  }, [leads, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const cur = Math.min(page, totalPages - 1);
  const rows = filtered.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE);

  return (
    <div className="card-elevated p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-display text-lg">Detalhamento por lead</h3>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={e => { setQ(e.target.value); setPage(0); }}
              placeholder="Buscar nome, whatsapp, campanha…"
              className="h-9 pl-8 text-xs w-64" />
          </div>
          <span className="text-xs text-muted-foreground">{filtered.length.toLocaleString("pt-BR")} leads</span>
        </div>
      </div>

      <div className="overflow-x-auto -mx-4 px-4">
        <table className="min-w-[1200px] w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground uppercase tracking-wider text-[10px]">
              <th className="py-2 pr-3">Nome</th>
              <th className="py-2 pr-3">WhatsApp</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 pr-3">Campanha</th>
              <th className="py-2 pr-3">Conjunto</th>
              <th className="py-2 pr-3">Anúncio</th>
              <th className="py-2 pr-3">Formulário</th>
              <th className="py-2 pr-3">UTM src/med</th>
              <th className="py-2 pr-3">Resp.</th>
              <th className="py-2 pr-3">Criado</th>
              <th className="py-2 pr-3">Agendado</th>
              <th className="py-2 pr-3">Realizado</th>
              <th className="py-2 pr-3">Valor proposta</th>
              <th className="py-2 pr-3">Fech./Perda</th>
              <th className="py-2 pr-3">Motivo perda</th>
              <th className="py-2 pr-3">Valor ganho/perd.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(l => (
              <tr key={l.id} className="border-b border-border/40 hover:bg-accent/5">
                <td className="py-2 pr-3 whitespace-nowrap">{l.nome_completo}</td>
                <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{l.whatsapp}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{STAGE_LABELS[l.status] ?? l.status}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{l.utm_campaign || l.facebook_campaign || "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{l.facebook_adset_name || "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{l.facebook_ad_name || "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{l.facebook_form_name || "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{[l.utm_source, l.utm_medium].filter(Boolean).join("/") || "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{l.owner_user_id ? l.owner_user_id.slice(0, 8) : "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmt(l.created_at)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmt(l.reuniao_agendada_em)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmt(l.reuniao_realizada_em)}</td>
                <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{fmtBRL(l.valor_proposta)}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{fmt(l.fechado_em)}</td>
                <td className="py-2 pr-3 max-w-[160px] truncate" title={l.motivo_perda ?? ""}>{l.motivo_perda || "—"}</td>
                <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                  {l.status === "ganho" ? fmtBRL(l.valor_proposta) : l.status === "perdido" ? fmtBRL(l.valor_perdido) : "—"}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={16} className="py-10 text-center text-muted-foreground">Nenhum lead no filtro</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Página {cur + 1} de {totalPages}</span>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="outline" disabled={cur === 0} onClick={() => setPage(cur - 1)} className="h-8"><ChevronLeft className="w-4 h-4" /></Button>
            <Button size="sm" variant="outline" disabled={cur >= totalPages - 1} onClick={() => setPage(cur + 1)} className="h-8"><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
