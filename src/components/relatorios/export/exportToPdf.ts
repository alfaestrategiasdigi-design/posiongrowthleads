import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import html2canvas from "html2canvas";
import type { RelatorioData, RelatorioFilters } from "@/lib/relatorios/types";
import { STAGE_LABELS } from "@/lib/relatorios/aggregators";

// ---------- Formatação ----------
const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const PCT = (n: number) => `${(n * 100).toFixed(1)}%`;
const NUM = (n: number) => n.toLocaleString("pt-BR");
const D = (d: string | null) => d ? new Date(d).toLocaleDateString("pt-BR") : "—";

// ---------- Paleta dark ----------
const BG        = [11, 11, 18]    as const;   // #0B0B12
const SURFACE   = [20, 20, 31]    as const;   // #14141F
const SURFACE_2 = [26, 26, 36]    as const;   // #1A1A24
const BORDER    = [39, 39, 55]    as const;   // #272737
const TEXT      = [229, 231, 235] as const;   // #E5E7EB
const MUTED     = [156, 163, 175] as const;   // #9CA3AF
const DIM       = [107, 114, 128] as const;   // #6B7280
const AMBER     = [245, 158, 11]  as const;   // #F59E0B
const GREEN     = [16, 185, 129]  as const;   // #10B981
const RED       = [239, 68, 68]   as const;   // #EF4444

export interface PdfOptions {
  scopeLabel: string;
  filters: RelatorioFilters;
  data: RelatorioData;
  chartsRoot: HTMLElement | null;
}

export async function exportRelatorioPdf({ scopeLabel, filters, data, chartsRoot }: PdfOptions) {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();   // 842
  const H = pdf.internal.pageSize.getHeight();  // 595
  const M = 32;
  const HEADER_H = 40;
  const FOOTER_H = 26;
  const CONTENT_TOP = HEADER_H + 12;
  const CONTENT_BOTTOM = H - FOOTER_H - 8;

  const periodStr = `${new Date(filters.from).toLocaleDateString("pt-BR")} — ${new Date(filters.to).toLocaleDateString("pt-BR")}`;
  const genStr = new Date().toLocaleString("pt-BR");

  const setFill = (c: readonly [number, number, number]) => pdf.setFillColor(c[0], c[1], c[2]);
  const setText = (c: readonly [number, number, number]) => pdf.setTextColor(c[0], c[1], c[2]);
  const setStroke = (c: readonly [number, number, number]) => pdf.setDrawColor(c[0], c[1], c[2]);

  function paintChrome() {
    // Fundo
    setFill(BG);
    pdf.rect(0, 0, W, H, "F");

    // Header
    setFill(SURFACE);
    pdf.rect(0, 0, W, HEADER_H, "F");
    setStroke(AMBER);
    pdf.setLineWidth(1);
    pdf.line(0, HEADER_H, W, HEADER_H);

    // Header text - esquerda
    setText(AMBER);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text("POSION", M, 18);
    setText(MUTED);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text("Relatório Comercial", M, 31);

    // Header text - direita
    setText(TEXT);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(scopeLabel, W - M, 18, { align: "right" });
    setText(MUTED);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(periodStr, W - M, 31, { align: "right" });

    // Footer
    setStroke(BORDER);
    pdf.setLineWidth(0.5);
    pdf.line(M, H - FOOTER_H, W - M, H - FOOTER_H);
    setText(DIM);
    pdf.setFontSize(7);
    pdf.text(`Gerado em ${genStr}`, M, H - 10);
    const pageNum = pdf.getNumberOfPages();
    pdf.text(`pág. ${pageNum}`, W - M, H - 10, { align: "right" });
  }

  function newPage() {
    pdf.addPage();
    paintChrome();
  }

  function card(x: number, y: number, w: number, h: number, r = 6) {
    setFill(SURFACE);
    setStroke(BORDER);
    pdf.setLineWidth(0.5);
    pdf.roundedRect(x, y, w, h, r, r, "FD");
  }

  function kpiCard(x: number, y: number, w: number, h: number, label: string, value: string, sub?: string, accent: readonly [number, number, number] = AMBER) {
    card(x, y, w, h);
    // faixa de accent
    setFill(accent);
    pdf.rect(x, y, 3, h, "F");

    setText(MUTED);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(label.toUpperCase(), x + 12, y + 16);

    setText(TEXT);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(h > 70 ? 22 : 16);
    pdf.text(value, x + 12, y + (h > 70 ? 46 : 40));

    if (sub) {
      setText(DIM);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.text(sub, x + 12, y + h - 10);
    }
  }

  // ============================================================
  // PÁGINA 1 — CAPA
  // ============================================================
  paintChrome();

  setText(AMBER);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.text("RELATÓRIO EXECUTIVO", M, CONTENT_TOP + 30);

  setText(TEXT);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(38);
  pdf.text("Relatório Comercial", M, CONTENT_TOP + 78);

  setText(MUTED);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(scopeLabel, M, CONTENT_TOP + 104);
  pdf.text(periodStr, M, CONTENT_TOP + 122);

  // Filtros aplicados (cartão à direita)
  const filtroX = W / 2 + 20;
  const filtroY = CONTENT_TOP + 20;
  const filtroW = W - M - filtroX;
  const filtroH = 150;
  card(filtroX, filtroY, filtroW, filtroH);
  setText(AMBER);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("FILTROS APLICADOS", filtroX + 14, filtroY + 20);
  setText(TEXT);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  let fy = filtroY + 40;
  const filtroLinhas: string[] = [
    `Período: ${periodStr}`,
    `Clínicas: ${filters.tenantIds.length === 0 ? "todas" : `${filters.tenantIds.length} selecionada(s)`}`,
    `Campanhas: ${filters.campaigns.length === 0 ? "todas" : `${filters.campaigns.length} selecionada(s)`}`,
    `Formulários: ${filters.forms.length === 0 ? "todos" : `${filters.forms.length} selecionado(s)`}`,
    `Responsáveis: ${filters.ownerIds.length === 0 ? "todos" : `${filters.ownerIds.length} selecionado(s)`}`,
    `Origem: ${filters.origem === "all" ? "Todas" : filters.origem === "paid" ? "Pago" : "Orgânico"}`,
  ];
  for (const l of filtroLinhas) {
    pdf.text(l, filtroX + 14, fy);
    fy += 15;
  }

  // 4 KPIs de destaque na parte inferior da capa
  const k = data.kpis;
  const highlights: Array<{ label: string; value: string; sub?: string; c: readonly [number, number, number] }> = [
    { label: "Leads no período", value: NUM(k.totalLeads), sub: `${PCT(k.taxaQualificacao)} qualificados`, c: AMBER },
    { label: "Leads ganhos", value: NUM(k.ganhos), sub: `${PCT(k.taxaConversao)} conversão`, c: GREEN },
    { label: "Valor ganho", value: BRL(k.valorGanho), sub: "Kanban · coluna Ganho", c: GREEN },
    { label: "Investimento", value: BRL(k.investimento), sub: `CPL ${BRL(k.cpl)} · CAC ${BRL(k.cac)}`, c: AMBER },
  ];
  const hlY = H - FOOTER_H - 130;
  const hlH = 95;
  const gap = 12;
  const hlW = (W - M * 2 - gap * 3) / 4;
  highlights.forEach((h, i) => {
    kpiCard(M + i * (hlW + gap), hlY, hlW, hlH, h.label, h.value, h.sub, h.c);
  });

  // ============================================================
  // PÁGINA 2 — PANORAMA (KPI grid 3x3 + Funil)
  // ============================================================
  newPage();

  setText(AMBER);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("PANORAMA", M, CONTENT_TOP + 8);
  setText(TEXT);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("Indicadores e Funil", M, CONTENT_TOP + 28);

  // Grid 3x3 KPI - metade superior
  const gridTop = CONTENT_TOP + 46;
  const gridBottom = CONTENT_TOP + 240;
  const gridH = gridBottom - gridTop;
  const rows = 3, cols = 3;
  const cellGap = 8;
  const cellW = (W - M * 2 - cellGap * (cols - 1)) / cols;
  const cellH = (gridH - cellGap * (rows - 1)) / rows;

  const kpis: Array<{ l: string; v: string; s?: string; c?: readonly [number, number, number] }> = [
    { l: "Total de leads",         v: NUM(k.totalLeads) },
    { l: "Qualificados",           v: NUM(k.qualificados), s: `${PCT(k.taxaQualificacao)} do total` },
    { l: "Agendamentos",           v: NUM(k.agendamentos) },
    { l: "Compareceu",             v: NUM(k.compareceu),  s: `${PCT(k.taxaComparecimento)} de comparecimento`, c: GREEN },
    { l: "No-show",                v: NUM(k.noShow),      c: RED },
    { l: "Ganhos",                 v: NUM(k.ganhos),      s: `${PCT(k.taxaConversao)} de conversão`,             c: GREEN },
    { l: "Valor ganho",            v: BRL(k.valorGanho),  s: "leads.valor_proposta · status Ganho",              c: GREEN },
    { l: "Valor perdido",          v: BRL(k.valorPerdido),s: "leads.valor_perdido · status Perdido",             c: RED },
    { l: "Investimento",           v: BRL(k.investimento),s: `CPL ${BRL(k.cpl)} · CAC ${BRL(k.cac)}`,             c: AMBER },
  ];
  for (let i = 0; i < kpis.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    const x = M + c * (cellW + cellGap);
    const y = gridTop + r * (cellH + cellGap);
    kpiCard(x, y, cellW, cellH, kpis[i].l, kpis[i].v, kpis[i].s, kpis[i].c ?? AMBER);
  }

  // Funil - metade inferior
  const funY = gridBottom + 20;
  setText(AMBER);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("FUNIL", M, funY);
  setText(TEXT);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("Conversão por etapa", M, funY + 18);

  const funChartY = funY + 32;
  const funChartH = CONTENT_BOTTOM - funChartY - 10;
  const stages = data.funil.filter(s => s.id !== "perdido" && s.id !== "no_show");
  const stageMax = Math.max(...stages.map(s => s.count), 1);
  const rowH = Math.min(28, (funChartH - 8) / stages.length);
  const labelW = 130;
  const barMax = W - M * 2 - labelW - 180;
  stages.forEach((s, i) => {
    const y = funChartY + i * (rowH + 4);
    // label
    setText(TEXT);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.text(s.label, M + 4, y + rowH / 2 + 3);
    // bar bg
    setFill(SURFACE_2);
    pdf.roundedRect(M + labelW, y, barMax, rowH, 3, 3, "F");
    // bar fill
    const w = (s.count / stageMax) * barMax;
    setFill(AMBER);
    pdf.roundedRect(M + labelW, y, Math.max(w, 2), rowH, 3, 3, "F");
    // count
    setText(TEXT);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.text(NUM(s.count), M + labelW + barMax + 10, y + rowH / 2 + 3);
    // % total / % anterior
    setText(MUTED);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const pctTxt = `${PCT(s.pctTotal)} do total${s.pctPrev != null ? ` · ${PCT(s.pctPrev)} da etapa anterior` : ""}`;
    pdf.text(pctTxt, M + labelW + barMax + 50, y + rowH / 2 + 3);
  });

  // ============================================================
  // PÁGINA 3 — FINANCEIRO + FUNIL DE VENDAS (BI) + RANKINGS
  // ============================================================
  newPage();
  setText(AMBER);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("FINANCEIRO", M, CONTENT_TOP + 8);
  setText(TEXT);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("Vendas, Meta e Custos", M, CONTENT_TOP + 28);

  // Grid financeiro 5 x 2
  const finKpis: Array<{ l: string; v: string; s?: string; c?: readonly [number, number, number] }> = [
    { l: "Vendas",        v: BRL(k.vendasTotal), s: `${NUM(k.vendasQtd)} venda(s)`,          c: GREEN },
    { l: "Nova venda",    v: BRL(k.novaVenda),   s: "1º contato no período" },
    { l: "Monetização",   v: BRL(k.monetizacao), s: "Recompra do paciente" },
    { l: "Meta",          v: BRL(k.meta),        s: k.meta > 0 ? `${PCT(k.vendasTotal / k.meta)} atingido` : "Sem meta cadastrada", c: AMBER },
    { l: "Não realizado", v: BRL(k.naoRealizado),s: "Meta − Vendas",                          c: k.naoRealizado > 0 ? RED : GREEN },
    { l: "Ticket médio",  v: BRL(k.ticketMedio) },
    { l: "CPA",           v: BRL(k.cpa),         s: "Invest. / vendas" },
    { l: "CPL",           v: BRL(k.cpl) },
    { l: "CPMQL",         v: BRL(k.cpmql),       s: "Invest. / MQL" },
    { l: "CPSQL",         v: BRL(k.cpsql),       s: "Invest. / SQL" },
  ];
  const fRows = 2, fCols = 5;
  const fGap = 8;
  const fTop = CONTENT_TOP + 46;
  const fH = 82;
  const fCellW = (W - M * 2 - fGap * (fCols - 1)) / fCols;
  for (let i = 0; i < finKpis.length; i++) {
    const r = Math.floor(i / fCols), c = i % fCols;
    const x = M + c * (fCellW + fGap);
    const y = fTop + r * (fH + fGap);
    kpiCard(x, y, fCellW, fH, finKpis[i].l, finKpis[i].v, finKpis[i].s, finKpis[i].c ?? AMBER);
  }

  // Funil BI + Rankings lado a lado
  const secY = fTop + fRows * (fH + fGap) + 14;
  const secH = CONTENT_BOTTOM - secY - 10;
  const halfW = (W - M * 2 - 16) / 2;

  // Bi Funnel (esquerda)
  card(M, secY, halfW, secH);
  setText(AMBER); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
  pdf.text("FUNIL DE VENDAS", M + 14, secY + 18);
  setText(TEXT); pdf.setFont("helvetica", "bold"); pdf.setFontSize(11);
  pdf.text("Leads → Vendas", M + 14, secY + 34);
  const biStages = data.biFunnel;
  const biMax = Math.max(...biStages.map(s => s.count), 1);
  const biRowH = Math.min(24, (secH - 50) / biStages.length);
  const biLabelW = 82;
  const biBarMax = halfW - 40 - biLabelW - 70;
  biStages.forEach((s, i) => {
    const y = secY + 46 + i * (biRowH + 4);
    setText(TEXT); pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
    pdf.text(s.label, M + 14, y + biRowH / 2 + 3);
    setFill(SURFACE_2);
    pdf.roundedRect(M + 14 + biLabelW, y, biBarMax, biRowH, 3, 3, "F");
    const bw = (s.count / biMax) * biBarMax;
    setFill(AMBER);
    pdf.roundedRect(M + 14 + biLabelW, y, Math.max(bw, 2), biRowH, 3, 3, "F");
    setText(TEXT); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
    pdf.text(NUM(s.count), M + 14 + biLabelW + biBarMax + 6, y + biRowH / 2 + 3);
    setText(MUTED); pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
    pdf.text(s.pctPrev != null ? PCT(s.pctPrev) : "—", M + 14 + biLabelW + biBarMax + 40, y + biRowH / 2 + 3);
  });

  // Rankings (direita) — closer em cima, sdr embaixo
  const rx = M + halfW + 16;
  const rankH = (secH - 12) / 2;
  const drawRanking = (title: string, subtitle: string, items: typeof data.rankingClosers, y: number) => {
    card(rx, y, halfW, rankH);
    setText(AMBER); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
    pdf.text(title.toUpperCase(), rx + 14, y + 18);
    setText(MUTED); pdf.setFont("helvetica", "normal"); pdf.setFontSize(7);
    pdf.text(subtitle, rx + 14, y + 30);
    if (items.length === 0) {
      setText(DIM); pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
      pdf.text("Sem dados no período", rx + 14, y + rankH / 2);
      return;
    }
    const top = items.slice(0, 6);
    const rowH = Math.min(18, (rankH - 44) / top.length);
    top.forEach((it, i) => {
      const yy = y + 44 + i * rowH;
      setText(i === 0 ? AMBER : TEXT); pdf.setFont("helvetica", "bold"); pdf.setFontSize(8);
      pdf.text(`${i + 1}º`, rx + 14, yy + 10);
      setText(TEXT); pdf.setFont("helvetica", "normal"); pdf.setFontSize(9);
      pdf.text(it.name.length > 24 ? it.name.slice(0, 24) + "…" : it.name, rx + 34, yy + 10);
      setText(GREEN); pdf.setFont("helvetica", "bold"); pdf.setFontSize(9);
      pdf.text(BRL(it.total), rx + halfW - 14, yy + 10, { align: "right" });
    });
  };
  drawRanking("Ranking Closer", "Faturamento por vendedor", data.rankingClosers, secY);
  drawRanking("Ranking SDR", "Leads ganhos por responsável", data.rankingSdrs, secY + rankH + 12);
  // PÁGINAS 3+ — GRÁFICOS (2 por página, horizontal)
  // ============================================================
  if (chartsRoot) {
    const cards = Array.from(chartsRoot.querySelectorAll("[data-chart-id]")) as HTMLElement[];
    const rendered: Array<{ title: string; dataUrl: string; w: number; h: number }> = [];
    for (const cardEl of cards) {
      try {
        const canvas = await html2canvas(cardEl, { backgroundColor: "#14141F", scale: 2, logging: false });
        rendered.push({
          title: cardEl.querySelector("h4")?.textContent ?? "Gráfico",
          dataUrl: canvas.toDataURL("image/png"),
          w: canvas.width,
          h: canvas.height,
        });
      } catch (e) {
        console.warn("chart render failed", e);
      }
    }

    for (let i = 0; i < rendered.length; i += 2) {
      newPage();
      setText(AMBER);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(8);
      pdf.text("GRÁFICOS", M, CONTENT_TOP + 8);
      setText(TEXT);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text("Análise visual", M, CONTENT_TOP + 28);

      const slotY = CONTENT_TOP + 46;
      const slotH = CONTENT_BOTTOM - slotY - 20;
      const slotW = (W - M * 2 - 16) / 2;

      for (let j = 0; j < 2 && i + j < rendered.length; j++) {
        const r = rendered[i + j];
        const x = M + j * (slotW + 16);
        card(x, slotY, slotW, slotH);
        setText(AMBER);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(9);
        pdf.text(r.title, x + 14, slotY + 20);
        // imagem
        const imgAreaTop = slotY + 32;
        const imgAreaH = slotH - 42;
        const imgAreaW = slotW - 24;
        const ratio = r.w / r.h;
        let iw = imgAreaW;
        let ih = iw / ratio;
        if (ih > imgAreaH) { ih = imgAreaH; iw = ih * ratio; }
        const ix = x + 12 + (imgAreaW - iw) / 2;
        const iy = imgAreaTop + (imgAreaH - ih) / 2;
        pdf.addImage(r.dataUrl, "PNG", ix, iy, iw, ih);
      }
    }
  }

  // ============================================================
  // PÁGINAS FINAIS — TABELA DETALHADA
  // ============================================================
  newPage();
  setText(AMBER);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("DETALHAMENTO", M, CONTENT_TOP + 8);
  setText(TEXT);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text(`${NUM(data.leads.length)} leads`, M, CONTENT_TOP + 28);

  autoTable(pdf, {
    startY: CONTENT_TOP + 42,
    margin: { left: M, right: M, top: CONTENT_TOP + 4, bottom: FOOTER_H + 16 },
    theme: "plain",
    styles: {
      fontSize: 7,
      cellPadding: 4,
      textColor: [TEXT[0], TEXT[1], TEXT[2]],
      lineColor: [BORDER[0], BORDER[1], BORDER[2]],
      lineWidth: 0.2,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [SURFACE_2[0], SURFACE_2[1], SURFACE_2[2]],
      textColor: [AMBER[0], AMBER[1], AMBER[2]],
      fontStyle: "bold",
      fontSize: 7,
      halign: "left",
    },
    alternateRowStyles: {
      fillColor: [SURFACE[0], SURFACE[1], SURFACE[2]],
    },
    bodyStyles: {
      fillColor: [BG[0], BG[1], BG[2]],
    },
    columnStyles: {
      0: { cellWidth: 105 },  // Nome
      1: { cellWidth: 70 },   // Whats
      2: { cellWidth: 60 },   // Status
      3: { cellWidth: 90 },   // Campanha
      4: { cellWidth: 85 },   // Form
      5: { cellWidth: 55 },   // Criado
      6: { cellWidth: 55 },   // Agendado
      7: { cellWidth: 55 },   // Fechado
      8: { cellWidth: 55, halign: "right" },   // Valor prop
      9: { cellWidth: 55, halign: "right" },   // Valor ganho
      10:{ cellWidth: 55, halign: "right" },   // Valor perd
    },
    head: [["Nome","WhatsApp","Status","Campanha","Formulário","Criado","Agendado","Fechado","Valor prop.","Ganho","Perdido"]],
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
      // O autoTable cria páginas novas automaticamente — precisamos pintar o chrome nelas
      paintChrome();
    },
  });

  // ============================================================
  // NUMERAÇÃO FINAL (pág X / Y) — repinta rodapé com total
  // ============================================================
  const total = pdf.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    pdf.setPage(p);
    // limpa a área de "pág. X" antiga
    setFill(BG);
    pdf.rect(W - M - 80, H - 22, 80, 16, "F");
    setText(DIM);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text(`pág. ${p} / ${total}`, W - M, H - 10, { align: "right" });
  }

  pdf.save(`relatorio_POSION_${scopeLabel.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0,10)}.pdf`);
}
