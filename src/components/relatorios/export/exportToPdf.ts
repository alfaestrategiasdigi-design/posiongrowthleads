import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import type { RelatorioData, RelatorioFilters } from "@/lib/relatorios/types";
import { STAGE_LABELS } from "@/lib/relatorios/aggregators";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const PCT = (n: number) => `${(n * 100).toFixed(1)}%`;
const NUM = (n: number) => n.toLocaleString("pt-BR");
const D = (d: string | null) => d ? new Date(d).toLocaleDateString("pt-BR") : "—";

export interface PdfOptions {
  scopeLabel: string;     // "POSION (todos)" ou nome da clínica
  filters: RelatorioFilters;
  data: RelatorioData;
  chartsRoot: HTMLElement | null; // container que envelopa os gráficos
}

export async function exportRelatorioPdf({ scopeLabel, filters, data, chartsRoot }: PdfOptions) {
  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 40;

  const filterSummary = () => {
    const parts: string[] = [];
    if (filters.tenantIds.length) parts.push(`Clínicas: ${filters.tenantIds.length} selecionada(s)`);
    if (filters.campaigns.length) parts.push(`Campanhas: ${filters.campaigns.length}`);
    if (filters.forms.length) parts.push(`Formulários: ${filters.forms.length}`);
    if (filters.ownerIds.length) parts.push(`Responsáveis: ${filters.ownerIds.length}`);
    parts.push(`Origem: ${filters.origem === "all" ? "Todas" : filters.origem === "paid" ? "Pago" : "Orgânico"}`);
    return parts;
  };

  // ---------- CAPA ----------
  pdf.setFillColor(15, 15, 25);
  pdf.rect(0, 0, W, H, "F");
  pdf.setTextColor(245, 158, 11);
  pdf.setFontSize(10);
  pdf.text("POSION", M, 60);
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(26);
  pdf.text("Relatório Comercial", M, 130);
  pdf.setFontSize(12);
  pdf.setTextColor(200, 200, 210);
  pdf.text(`Escopo: ${scopeLabel}`, M, 160);
  pdf.text(`Período: ${new Date(filters.from).toLocaleDateString("pt-BR")} a ${new Date(filters.to).toLocaleDateString("pt-BR")}`, M, 180);
  pdf.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, M, 200);

  pdf.setFontSize(11);
  pdf.setTextColor(180, 180, 200);
  pdf.text("Filtros aplicados:", M, 240);
  pdf.setFontSize(10);
  let y = 260;
  for (const line of filterSummary()) {
    pdf.text(`• ${line}`, M + 10, y);
    y += 16;
  }

  // ---------- RESUMO EXECUTIVO ----------
  pdf.addPage();
  pdf.setTextColor(20, 20, 30);
  pdf.setFontSize(16);
  pdf.text("Resumo Executivo", M, 60);

  const k = data.kpis;
  autoTable(pdf, {
    startY: 80,
    theme: "grid",
    headStyles: { fillColor: [15, 15, 25], textColor: 255 },
    styles: { fontSize: 9, cellPadding: 6 },
    head: [["Indicador", "Valor"]],
    body: [
      ["Leads no período", NUM(k.totalLeads)],
      ["Taxa de qualificação", `${PCT(k.taxaQualificacao)}  (${NUM(k.qualificados)}/${NUM(k.totalLeads)})`],
      ["Agendamentos", NUM(k.agendamentos)],
      ["Taxa de comparecimento", `${PCT(k.taxaComparecimento)}  (${NUM(k.compareceu)}/${NUM(k.compareceu + k.noShow)})`],
      ["Leads ganhos", NUM(k.ganhos)],
      ["Taxa de conversão geral", PCT(k.taxaConversao)],
      ["Valor ganho", BRL(k.valorGanho)],
      ["Valor perdido", BRL(k.valorPerdido)],
      ["Investimento em anúncios", BRL(k.investimento)],
      ["CPL médio", BRL(k.cpl)],
      ["CAC", BRL(k.cac)],
    ],
  });

  // Funil
  const funilY = (pdf as any).lastAutoTable.finalY + 24;
  pdf.setFontSize(14);
  pdf.text("Funil", M, funilY);
  autoTable(pdf, {
    startY: funilY + 10,
    theme: "striped",
    headStyles: { fillColor: [30, 30, 40], textColor: 255 },
    styles: { fontSize: 9, cellPadding: 5 },
    head: [["Etapa", "Qtd", "% do total", "% etapa anterior"]],
    body: data.funil.map(s => [s.label, NUM(s.count), PCT(s.pctTotal), s.pctPrev == null ? "—" : PCT(s.pctPrev)]),
  });

  // ---------- GRÁFICOS ----------
  if (chartsRoot) {
    const cards = Array.from(chartsRoot.querySelectorAll("[data-chart-id]")) as HTMLElement[];
    for (const card of cards) {
      try {
        const canvas = await html2canvas(card, { backgroundColor: "#0b0b12", scale: 2, logging: false });
        const img = canvas.toDataURL("image/png");
        pdf.addPage();
        pdf.setFontSize(12);
        pdf.setTextColor(20, 20, 30);
        const title = card.querySelector("h4")?.textContent ?? "Gráfico";
        pdf.text(title, M, 50);
        const ratio = canvas.width / canvas.height;
        const w = W - M * 2;
        const h = w / ratio;
        pdf.addImage(img, "PNG", M, 70, w, Math.min(h, H - 100));
      } catch (e) {
        console.warn("chart render failed", e);
      }
    }
  }

  // ---------- TABELA DETALHADA ----------
  pdf.addPage();
  pdf.setFontSize(14);
  pdf.setTextColor(20, 20, 30);
  pdf.text(`Detalhamento — ${data.leads.length.toLocaleString("pt-BR")} leads`, M, 40);

  autoTable(pdf, {
    startY: 55,
    theme: "grid",
    headStyles: { fillColor: [15, 15, 25], textColor: 255, fontSize: 7 },
    styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
    columnStyles: {
      0: { cellWidth: 90 }, 1: { cellWidth: 65 }, 2: { cellWidth: 55 },
      3: { cellWidth: 70 }, 4: { cellWidth: 60 }, 5: { cellWidth: 55 },
      6: { cellWidth: 55 }, 7: { cellWidth: 45 }, 8: { cellWidth: 45 },
      9: { cellWidth: 45 }, 10: { cellWidth: 50 },
    },
    head: [["Nome","WhatsApp","Status","Campanha","Formulário","Criado","Agendado","Fechado","Valor prop.","Valor ganho","Valor perd."]],
    body: data.leads.map(l => [
      l.nome_completo,
      l.whatsapp,
      STAGE_LABELS[l.status] ?? l.status,
      l.utm_campaign || l.facebook_campaign || "—",
      l.facebook_form_name || "—",
      D(l.created_at),
      D(l.reuniao_agendada_em),
      D(l.fechado_em),
      l.valor_proposta != null ? BRL(l.valor_proposta) : "—",
      l.status === "ganho" && l.valor_proposta ? BRL(l.valor_proposta) : "—",
      l.status === "perdido" && l.valor_perdido ? BRL(l.valor_perdido) : "—",
    ]),
    didDrawPage: () => {
      pdf.setFontSize(8);
      pdf.setTextColor(150);
      pdf.text(`POSION · Relatório Comercial · ${new Date().toLocaleDateString("pt-BR")}`,
        M, H - 20);
      const page = (pdf as any).internal.getNumberOfPages();
      pdf.text(`pág. ${page}`, W - M, H - 20, { align: "right" });
    },
  });

  pdf.save(`relatorio_${scopeLabel.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0,10)}.pdf`);
}
