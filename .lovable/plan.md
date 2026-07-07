
## Objetivo
Refazer o PDF do Relatório: acabar com páginas em branco quase vazias, unificar o visual dark sofisticado (mesma linguagem dos gráficos do app) e aumentar densidade útil por página.

## Diagnóstico do PDF atual
- Capa dark → páginas seguintes todas brancas (quebra visual).
- Um gráfico por página, imenso, no meio do branco → 5 páginas gastas só com gráficos.
- KPIs em tabela vertical de 2 colunas → desperdiça espaço horizontal.
- Rodapé só na tabela final.

## Redesign do PDF (mesma função `exportRelatorioPdf`, sem mudar dados)

### Formato base
- Orientação **paisagem** A4 (842×595pt) — melhor para gráficos lado a lado e tabela larga.
- Fundo dark `#0B0B12` em **todas** as páginas (pintado no `didDrawPage`).
- Tipografia: Helvetica (nativa jsPDF), pesos e tamanhos hierarquizados.
- Paleta: âmbar `#F59E0B` (accent), verde `#10B981` (positivo), vermelho `#EF4444` (negativo), cinzas `#E5E7EB`/`#9CA3AF`/`#374151`.
- Header fixo em cada página: "POSION · Relatório Comercial" à esquerda, escopo + período à direita, régua âmbar 1pt.
- Rodapé fixo: data de geração + `pág. X / Y`.

### Página 1 — Capa executiva
- Título grande "Relatório Comercial", escopo, período, gerado em.
- Bloco "Filtros aplicados" em cartão translúcido.
- **4 KPIs de destaque** já na capa (Leads, Ganhos, Valor Ganho, Investimento) em cards grandes com número em âmbar.

### Página 2 — Panorama (KPI grid + Funil)
- Grid **3×3 de KPI cards** (9 indicadores) cobrindo metade superior — cada card com label pequeno em cinza, número grande, sublabel (% ou razão).
- Metade inferior: **Funil visual** desenhado com barras horizontais decrescentes (retângulos com % ao lado), não tabela.

### Páginas 3–4 — Gráficos, 2 por página
- Renderizo cada `[data-chart-id]` com `html2canvas` mantendo fundo `#0B0B12`, e coloco **2 gráficos por página** em grid 2 colunas (ou 1 em cima + 2 embaixo, dependendo do aspect ratio).
- Título de cada gráfico em cima do respectivo card, âmbar.

### Página 5+ — Detalhamento
- Tabela `autoTable` com tema custom: header âmbar sobre fundo `#1A1A24`, linhas alternadas `#0F0F18`/`#14141F`, texto `#E5E7EB`, borda `#1F1F2A`.
- Colunas mais compactas aproveitando paisagem (12 colunas cabem confortavelmente).
- Zebra sutil, sem grid pesado.
- Quebra automática de página mantém header repetido.

## Detalhes técnicos
- `didDrawPage` global: pinta fundo dark + desenha header/rodapé em toda página nova (inclusive as do autoTable).
- KPI cards e Funil desenhados via primitivas do jsPDF (rect arredondado com `roundedRect`, `setFillColor`, `setTextColor`) — não precisa de html2canvas para esses blocos.
- Gráficos continuam via html2canvas com `backgroundColor: "#0B0B12"` e `scale: 2`.
- Não muda nada em `useRelatorioData`, `aggregators`, `queries` — só o arquivo `exportToPdf.ts`.

## Arquivos afetados
- `src/components/relatorios/export/exportToPdf.ts` (reescrita completa).

## Fora de escopo
- CSV, filtros, KPIs, gráficos da tela — nada muda.
- Não adiciona novas seções nem novos dados; só reorganiza e reveste o PDF.
- Não muda a página de Relatórios em tela (só o export).
