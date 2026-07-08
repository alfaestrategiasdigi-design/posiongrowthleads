import { useEffect, useMemo, useState } from "react";
import { X, Download, FileText, Loader2, AlertTriangle, Trophy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { format, differenceInDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { Lead } from "@/types/admin";

const STATUS_LABEL: Record<string, string> = {
  lead: "Lead",
  qualificado: "Qualificado",
  reuniao_agendada: "R. Agendada",
  compareceu: "Compareceu",
  negociacao: "Negociação",
  ganho: "Ganho",
  perdido: "Perdido",
  no_show: "No-show",
};

type StatusEvent = {
  id: string;
  lead_id: string;
  from_status: string | null;
  to_status: string;
  changed_at: string;
  source: string | null;
};

type FormField = { name?: string; label?: string; value?: any };

type Row = {
  lead: Lead;
  events: StatusEvent[];
  formFields: FormField[];
  daysSinceEntry: number;
  daysInCurrentStatus: number;
  interactionsCount: number;
  lastInteractionAt: string | null;
  lastInteractionType: string | null;
  stuck: boolean;
  finalStatusAt: string | null;
};

const getFormFields = (lead: any): FormField[] => {
  const raw = lead?.extras?.form_fields;
  if (Array.isArray(raw)) return raw as FormField[];
  return [];
};

const stringifyValue = (v: any): string => {
  if (v == null) return "—";
  if (Array.isArray(v)) return v.map(stringifyValue).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).replace(/_/g, " ");
};

const LeadsReportModal = ({
  leads,
  open,
  onClose,
  filtersLabel,
}: {
  leads: Lead[];
  open: boolean;
  onClose: () => void;
  filtersLabel: string;
}) => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (!open) return;
    if (leads.length === 0) {
      setRows([]);
      return;
    }
    (async () => {
      setLoading(true);
      const ids = leads.map(l => l.id);
      const { data: events } = await supabase
        .from("lead_status_events")
        .select("id, lead_id, from_status, to_status, changed_at, source")
        .in("lead_id", ids)
        .order("changed_at", { ascending: false });

      const byLead = new Map<string, StatusEvent[]>();
      for (const e of (events || []) as StatusEvent[]) {
        const arr = byLead.get(e.lead_id) || [];
        arr.push(e);
        byLead.set(e.lead_id, arr);
      }

      const now = Date.now();
      const built: Row[] = leads.map(lead => {
        const evs = byLead.get(lead.id) || [];
        const lastEv = evs[0] || null;
        const currentStatusEntry = evs.find(e => e.to_status === lead.status) || lastEv;
        const daysSinceEntry = Math.max(0, differenceInDays(now, new Date(lead.created_at).getTime()));
        const anchor = currentStatusEntry ? new Date(currentStatusEntry.changed_at).getTime() : new Date(lead.created_at).getTime();
        const daysInCurrentStatus = Math.max(0, differenceInDays(now, anchor));
        const isFinal = lead.status === "ganho" || lead.status === "perdido";
        const finalStatusAt = isFinal && currentStatusEntry ? currentStatusEntry.changed_at : null;
        const stuck = !isFinal && daysInCurrentStatus > 5;
        return {
          lead,
          events: evs,
          formFields: getFormFields(lead),
          daysSinceEntry,
          daysInCurrentStatus,
          interactionsCount: evs.length,
          lastInteractionAt: lastEv?.changed_at ?? null,
          lastInteractionType: lastEv ? `Status → ${STATUS_LABEL[lastEv.to_status] ?? lastEv.to_status}` : null,
          stuck,
          finalStatusAt,
        };
      });
      setRows(built);
      setLoading(false);
    })();
  }, [open, leads]);

  const aggregate = useMemo(() => {
    const total = rows.length;
    const byStatus = new Map<string, number>();
    const byForm = new Map<string, number>();
    let stuckCount = 0;
    let won = 0;
    for (const r of rows) {
      byStatus.set(r.lead.status, (byStatus.get(r.lead.status) || 0) + 1);
      const fname = (r.lead as any).facebook_form_name || (r.lead as any).facebook_form_id || "(sem formulário)";
      byForm.set(fname, (byForm.get(fname) || 0) + 1);
      if (r.stuck) stuckCount++;
      if (r.lead.status === "ganho") won++;
    }
    return {
      total,
      byStatus: Array.from(byStatus.entries()).sort((a, b) => b[1] - a[1]),
      byForm: Array.from(byForm.entries()).sort((a, b) => b[1] - a[1]),
      stuckCount,
      won,
      convRate: total ? (won / total) * 100 : 0,
    };
  }, [rows]);

  const handleExportCSV = () => {
    if (rows.length === 0) return;
    // Coleta todas as perguntas únicas (labels) preservando ordem de aparição
    const questionOrder: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      for (const f of r.formFields) {
        const key = (f.label || f.name || "").trim();
        if (key && !seen.has(key)) {
          seen.add(key);
          questionOrder.push(key);
        }
      }
    }
    const base = ["Nome", "WhatsApp", "E-mail", "Origem", "Formulário", "Status", "Data Entrada", "Dias no Status", "Interações", "Última Interação"];
    const headers = [...base, ...questionOrder];
    const escape = (s: any) => `"${String(s ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.map(escape).join(";")];
    for (const r of rows) {
      const l = r.lead as any;
      const answers: Record<string, string> = {};
      for (const f of r.formFields) {
        const key = (f.label || f.name || "").trim();
        if (key) answers[key] = stringifyValue(f.value);
      }
      const row = [
        l.nome_completo, l.whatsapp, l.email || "",
        l.origem || "", l.facebook_form_name || l.facebook_form_id || "",
        STATUS_LABEL[l.status] ?? l.status,
        format(new Date(l.created_at), "dd/MM/yyyy HH:mm"),
        r.daysInCurrentStatus,
        r.interactionsCount,
        r.lastInteractionAt ? format(new Date(r.lastInteractionAt), "dd/MM/yyyy HH:mm") : "",
        ...questionOrder.map(q => answers[q] ?? ""),
      ];
      lines.push(row.map(escape).join(";"));
    }
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `relatorio-leads-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  const handleExportPDF = () => {
    if (rows.length === 0) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const NAVY: [number, number, number] = [1, 8, 60];
    const GOLD: [number, number, number] = [201, 162, 39];
    const DARK: [number, number, number] = [15, 18, 40];
    const TEXT: [number, number, number] = [230, 232, 240];
    const MUTED: [number, number, number] = [150, 155, 175];
    const CARD: [number, number, number] = [26, 30, 55];
    const CARD_ALT: [number, number, number] = [34, 38, 65];

    const statusColor = (s: string): [number, number, number] => {
      switch (s) {
        case "ganho": return [46, 160, 100];
        case "perdido": return [200, 60, 80];
        case "qualificado": return [70, 140, 220];
        case "reuniao_agendada":
        case "compareceu": return [130, 90, 220];
        case "negociacao": return [220, 160, 40];
        default: return [110, 120, 145];
      }
    };

    // Pinta o fundo dark em toda página nova (chamado antes de qualquer conteúdo)
    const paintBackground = () => {
      doc.setFillColor(...DARK);
      doc.rect(0, 0, pageW, pageH, "F");
    };

    const drawFooter = (pageNum: number, total: number) => {
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(0.5);
      doc.line(40, pageH - 32, pageW - 40, pageH - 32);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text("Relatório de Leads · POSION", 40, pageH - 18);
      doc.text(`Página ${pageNum} de ${total}`, pageW - 40, pageH - 18, { align: "right" });
    };

    // Página 1 — capa/resumo
    paintBackground();
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 90, "F");
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(1);
    doc.line(0, 90, pageW, 90);

    doc.setTextColor(...GOLD);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text("RELATÓRIO", 40, 32);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(22);
    doc.text("Relatório de Leads", 40, 58);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(`Gerado em ${format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`, 40, 76);

    // Filtros aplicados
    doc.setTextColor(...TEXT);
    doc.setFontSize(9);
    const filtroLines = doc.splitTextToSize(filtersLabel, pageW - 80);
    doc.text(filtroLines, 40, 112);

    // KPIs em cartões
    const cardY = 130 + filtroLines.length * 12;
    const cardW = (pageW - 80 - 3 * 10) / 4;
    const kpiData: Array<[string, string, [number, number, number]]> = [
      ["TOTAL DE LEADS", String(aggregate.total), TEXT],
      ["GANHOS", String(aggregate.won), [120, 220, 170]],
      ["PARADOS > 5 DIAS", String(aggregate.stuckCount), [230, 130, 150]],
      ["CONVERSÃO", `${aggregate.convRate.toFixed(1)}%`, [130, 190, 240]],
    ];
    kpiData.forEach(([label, value, color], i) => {
      const x = 40 + i * (cardW + 10);
      doc.setFillColor(...CARD);
      doc.roundedRect(x, cardY, cardW, 60, 6, 6, "F");
      doc.setTextColor(...MUTED);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text(label, x + 10, cardY + 18);
      doc.setTextColor(...color);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(18);
      doc.text(value, x + 10, cardY + 44);
    });

    const tableStyles = {
      styles: { fontSize: 9, cellPadding: 5, textColor: TEXT, fillColor: CARD, lineColor: [55, 60, 90] as [number, number, number], lineWidth: 0.3 },
      alternateRowStyles: { fillColor: CARD_ALT },
      headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" as const, fontSize: 9 },
      margin: { left: 40, right: 40 },
    };

    let y = cardY + 82;
    doc.setTextColor(...GOLD);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("DISTRIBUIÇÃO POR STATUS", 40, y);
    autoTable(doc, {
      ...tableStyles,
      startY: y + 6,
      head: [["Status", "Qtd", "%"]],
      body: aggregate.byStatus.map(([s, c]) => [STATUS_LABEL[s] ?? s, String(c), `${((c / (aggregate.total || 1)) * 100).toFixed(1)}%`]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    });
    y = (doc as any).lastAutoTable.finalY + 20;

    doc.setTextColor(...GOLD);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("DISTRIBUIÇÃO POR FORMULÁRIO", 40, y);
    autoTable(doc, {
      ...tableStyles,
      startY: y + 6,
      head: [["Formulário", "Qtd", "%"]],
      body: aggregate.byForm.map(([f, c]) => [f, String(c), `${((c / (aggregate.total || 1)) * 100).toFixed(1)}%`]),
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    });

    // Um bloco por lead — nova página cada
    for (const r of rows) {
      doc.addPage();
      paintBackground();
      const l = r.lead as any;
      const sColor = statusColor(l.status);

      // Header do lead
      doc.setFillColor(...NAVY);
      doc.rect(0, 0, pageW, 70, "F");
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(1);
      doc.line(0, 70, pageW, 70);

      doc.setTextColor(...GOLD);
      doc.setFontSize(7);
      doc.setFont("helvetica", "normal");
      doc.text("LEAD", 40, 22);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      const nameLine = doc.splitTextToSize(l.nome_completo || "Lead", pageW - 220)[0];
      doc.text(nameLine, 40, 42);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...MUTED);
      doc.text(`${l.whatsapp || "—"}  ·  ${l.email || "sem e-mail"}  ·  ${l.origem || "—"}`, 40, 58);

      // Status badge no header (canto direito)
      const badge = STATUS_LABEL[l.status] ?? l.status;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      const bw = doc.getTextWidth(badge) + 20;
      doc.setFillColor(...sColor);
      doc.roundedRect(pageW - 40 - bw, 30, bw, 20, 10, 10, "F");
      doc.setTextColor(255, 255, 255);
      doc.text(badge, pageW - 40 - bw / 2, 44, { align: "center" });

      // Alertas
      let cy = 88;
      if (r.stuck) {
        doc.setFillColor(60, 20, 35);
        doc.setDrawColor(230, 90, 120);
        doc.setLineWidth(0.5);
        doc.roundedRect(40, cy, pageW - 80, 24, 4, 4, "FD");
        doc.setTextColor(230, 130, 150);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(`ALERTA · Parado há ${r.daysInCurrentStatus} dias sem movimentação`, 52, cy + 16);
        cy += 32;
      }

      // Dados cadastrais
      doc.setTextColor(...GOLD);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("DADOS CADASTRAIS", 40, cy);
      cy += 6;
      autoTable(doc, {
        ...tableStyles,
        startY: cy,
        head: [["Campo", "Valor"]],
        body: [
          ["Origem", l.origem || "—"],
          ["Formulário", l.facebook_form_name || l.facebook_form_id || "—"],
          ["Data de entrada", format(new Date(l.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })],
          ["Dias na base", `${r.daysSinceEntry} dias`],
          ["Dias no status atual", `${r.daysInCurrentStatus} dias`],
          ["Interações registradas", String(r.interactionsCount)],
          ["Última interação", r.lastInteractionAt ? `${format(new Date(r.lastInteractionAt), "dd/MM/yyyy HH:mm", { locale: ptBR })} — ${r.lastInteractionType}` : "—"],
          ...(r.finalStatusAt ? [[`Data ${STATUS_LABEL[l.status]}`, format(new Date(r.finalStatusAt), "dd/MM/yyyy HH:mm", { locale: ptBR })]] : []),
        ],
        columnStyles: { 0: { cellWidth: 160, textColor: MUTED, fontStyle: "bold" }, 1: { textColor: TEXT } },
      });
      cy = (doc as any).lastAutoTable.finalY + 16;

      if (r.formFields.length > 0) {
        doc.setTextColor(...GOLD);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("RESPOSTAS DO FORMULÁRIO", 40, cy);
        cy += 6;
        autoTable(doc, {
          ...tableStyles,
          startY: cy,
          head: [["Pergunta", "Resposta"]],
          body: r.formFields.map(f => [f.label || f.name || "—", stringifyValue(f.value)]),
          columnStyles: { 0: { cellWidth: 220, textColor: MUTED, fontStyle: "bold" }, 1: { textColor: TEXT } },
        });
        cy = (doc as any).lastAutoTable.finalY + 16;
      }

      if (r.events.length > 0) {
        doc.setTextColor(...GOLD);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        doc.text("LINHA DO TEMPO", 40, cy);
        cy += 6;
        autoTable(doc, {
          ...tableStyles,
          startY: cy,
          styles: { ...tableStyles.styles, fontSize: 8, cellPadding: 4 },
          head: [["Quando", "De", "Para", "Origem"]],
          body: r.events.map(e => [
            format(new Date(e.changed_at), "dd/MM/yy HH:mm", { locale: ptBR }),
            e.from_status ? (STATUS_LABEL[e.from_status] ?? e.from_status) : "—",
            STATUS_LABEL[e.to_status] ?? e.to_status,
            e.source ?? "—",
          ]),
          columnStyles: { 0: { cellWidth: 100 }, 1: { cellWidth: 120 }, 2: { cellWidth: 120, fontStyle: "bold" } },
        });
      }
    }

    // Footer em todas as páginas
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      drawFooter(i, total);
    }

    doc.save(`relatorio-leads-${new Date().toISOString().split("T")[0]}.pdf`);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="w-full max-w-6xl max-h-[92vh] bg-card border border-border/60 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-card/80">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-accent/80">Relatório</p>
            <h2 className="text-lg font-display text-foreground">Relatório de Leads</h2>
            <p className="text-xs text-muted-foreground">{filtersLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="rounded-full gap-2" onClick={handleExportCSV} disabled={rows.length === 0}>
              <Download className="w-3.5 h-3.5" /> CSV
            </Button>
            <Button size="sm" className="rounded-full gap-2" onClick={handleExportPDF} disabled={rows.length === 0}>
              <FileText className="w-3.5 h-3.5" /> PDF
            </Button>
            <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-card flex items-center justify-center text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="w-6 h-6 animate-spin text-accent" />
            </div>
          ) : rows.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-24">Nenhum lead nos filtros atuais.</p>
          ) : (
            <>
              {/* Resumo geral */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryTile label="Total" value={aggregate.total} />
                <SummaryTile label="Ganhos" value={aggregate.won} tone="emerald" icon={Trophy} />
                <SummaryTile label="Parados > 5d" value={aggregate.stuckCount} tone="rose" icon={AlertTriangle} />
                <SummaryTile label="Conversão" value={`${aggregate.convRate.toFixed(1)}%`} tone="sky" />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="card-elevated p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Distribuição por status</p>
                  <div className="space-y-2">
                    {aggregate.byStatus.map(([s, c]) => {
                      const pct = (c / (aggregate.total || 1)) * 100;
                      return (
                        <div key={s} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-foreground">{STATUS_LABEL[s] ?? s}</span>
                            <span className="text-muted-foreground tabular-nums">{c} · {pct.toFixed(1)}%</span>
                          </div>
                          <div className="h-1.5 bg-card/60 rounded-full overflow-hidden">
                            <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div className="card-elevated p-4">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Distribuição por formulário</p>
                  <div className="space-y-2">
                    {aggregate.byForm.map(([f, c]) => {
                      const pct = (c / (aggregate.total || 1)) * 100;
                      return (
                        <div key={f} className="space-y-1">
                          <div className="flex items-center justify-between text-xs gap-2">
                            <span className="text-foreground truncate" title={f}>{f}</span>
                            <span className="text-muted-foreground tabular-nums shrink-0">{c} · {pct.toFixed(1)}%</span>
                          </div>
                          <div className="h-1.5 bg-card/60 rounded-full overflow-hidden">
                            <div className="h-full bg-accent/70 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Bloco por lead */}
              <div className="space-y-4">
                {rows.map(r => (
                  <LeadBlock key={r.lead.id} row={r} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const SummaryTile = ({ label, value, tone = "default", icon: Icon }: { label: string; value: number | string; tone?: "default" | "emerald" | "rose" | "sky"; icon?: any }) => {
  const toneClass = {
    default: "text-foreground",
    emerald: "text-emerald-300",
    rose: "text-rose-300",
    sky: "text-sky-300",
  }[tone];
  return (
    <div className="card-elevated p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold tabular-nums mt-1 ${toneClass}`}>{value}</p>
        </div>
        {Icon && <Icon className={`w-4 h-4 ${toneClass}`} />}
      </div>
    </div>
  );
};

const LeadBlock = ({ row }: { row: Row }) => {
  const l = row.lead as any;
  const isWon = l.status === "ganho";
  const isLost = l.status === "perdido";
  return (
    <div className="card-elevated p-5 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-display text-base text-foreground">{l.nome_completo}</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
              {STATUS_LABEL[l.status] ?? l.status}
            </span>
            {row.stuck && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Parado há {row.daysInCurrentStatus} dias
              </span>
            )}
            {isWon && row.finalStatusAt && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 inline-flex items-center gap-1">
                <Trophy className="w-3 h-3" /> Ganho em {format(new Date(row.finalStatusAt), "dd/MM/yy", { locale: ptBR })}
              </span>
            )}
            {isLost && row.finalStatusAt && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 border border-rose-500/40 inline-flex items-center gap-1">
                <XCircle className="w-3 h-3" /> Perdido em {format(new Date(row.finalStatusAt), "dd/MM/yy", { locale: ptBR })}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {l.whatsapp} · {l.email || "sem e-mail"} · {l.origem || "—"} · {l.facebook_form_name || l.facebook_form_id || "sem formulário"} · entrou {format(new Date(l.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}
          </p>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <p>{row.daysSinceEntry} dias na base</p>
          <p>{row.interactionsCount} interações</p>
        </div>
      </div>

      {row.formFields.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Respostas do formulário</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {row.formFields.map((f, i) => (
              <div key={i} className="rounded-lg border border-border/50 bg-card/40 p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.label || f.name}</p>
                <p className="text-xs text-foreground mt-1 break-words">{stringifyValue(f.value)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {row.events.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Linha do tempo</p>
          <div className="space-y-1">
            {row.events.map(e => (
              <div key={e.id} className="flex items-center justify-between text-xs border-b border-border/30 py-1.5">
                <span className="text-foreground">
                  {e.from_status ? `${STATUS_LABEL[e.from_status] ?? e.from_status} → ` : "Criado como "}
                  <strong>{STATUS_LABEL[e.to_status] ?? e.to_status}</strong>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {format(new Date(e.changed_at), "dd/MM/yy HH:mm", { locale: ptBR })} · {e.source ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LeadsReportModal;
