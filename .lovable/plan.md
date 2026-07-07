## Objetivo

Deixar os cards do Dashboard mais legíveis e sofisticados em fundo preto, evitando o "bleed" dourado atual (halos, gradientes amber sobrepostos, bordas âmbar em texto). Introduzir uma paleta semântica de 4 cores para organizar os gráficos e indicadores, reduzindo o excesso de dourado.

## Paleta oficial (4 cores)

| Papel | Uso | Hex |
|---|---|---|
| **Dourado (marca)** | Títulos de seção, ícones de destaque, KPI hero, meta atingida | `#E8C468` |
| **Branco quente** | Números principais, linhas primárias de gráfico, labels de dados | `#F5F5F5` |
| **Verde** | Ganhos, valores positivos, variação ▲, status "ativo" | `#4ADE80` |
| **Vermelho** | Perdas, variação ▼, status "perdido" | `#F87171` |

Cinzas neutros (`#A1A1AA`, `#71717A`) ficam reservados para labels secundárias e eixos — nunca dourado enfraquecido.

## Ajustes nos cards (equilíbrio elegante)

**Sombra e borda**
- Reduzir o glow dourado no hover dos `.premium-card` e `.premium-hero` (trocar `rgba(201,162,39,0.30)` por `rgba(0,0,0,0.6)` + hairline dourado estático mais firme `rgba(201,162,39,0.22)`).
- Remover o `radial-gradient` dourado do fundo do `.premium-card` — fica só o preto profundo + hairline; o dourado aparece só como fio superior interno de 1px.
- Aumentar a profundidade da sombra externa (`0 24px 48px -20px rgba(0,0,0,0.9)`) para os cards "flutuarem" sem depender de brilho colorido.

**Tipografia dos cards**
- Números principais (`text-2xl`, `text-4xl`): `#F5F5F5` puro, não mais gradiente amber.
- Labels de topo (`RECEITA TOTAL COMBINADA`, `LEADS (PERÍODO)`, etc.): dourado suave `#E8C468/70` — mantém a assinatura editorial.
- Sublabels (`Agência R$ 88.000 + SaaS MRR…`, `4 leads`, `0 assinaturas`): cinza neutro `#A1A1AA`, não mais `text-muted-foreground` (que hoje puxa levemente dourado).
- Títulos de seção (`Pipeline & Agência`, `Clientes POSION`): branco `#F5F5F5`; só o ícone e a régua ficam dourados.

**Ícones dos KPIs**
- Trocar o quadrado dourado saturado dos KPIs (Em negociação, Contratos, Ticket, MRR) por um quadrado preto com hairline dourado fino e ícone branco. Reserva o dourado sólido só para o ícone hero de `Receita Total Combinada`.

## Ajustes nos gráficos

**Timeline de Receita (LineChart do hero)**
- Linha principal (`receita`) passa a ser **branca `#F5F5F5`** com strokeWidth 2.
- Área sob a linha ganha gradiente dourado bem sutil (`rgba(232,196,104,0.18) → transparent`) para manter identidade sem competir com a linha.
- Grid mais discreto (`stroke rgba(255,255,255,0.06)`), ticks em cinza `#71717A`.
- Ponto ativo (tooltip): círculo dourado 4px sobre a linha branca.

**Sparklines (Leads / Ganhos / Conversão)**
- Todas as três sparklines passam para **branco `#F5F5F5`** com preenchimento inferior em amber 0.12.
- Cor da linha só muda se houver semântica: em "Conversão", se a variação vs. anterior for negativa, a linha fica vermelha `#F87171`; positiva, branca.

**Distribuição do funil**
- Barras deixam de usar as cores fixas antigas (`STAGE_COLORS` com cyan/indigo/violeta). Nova regra:
  - `Ganho` → verde `#4ADE80`
  - `Perdido` → vermelho `#F87171`
  - Demais etapas (Lead, Qualificado, Reunião, Proposta, Negociação) → branco `#F5F5F5` com opacidade escalonada (0.45 → 0.9 conforme avança no funil), reforçando progressão.
- Label do estágio: branco; contador: branco `tabular-nums`.

**Origem dos leads**
- Barras trocam do gradiente dourado por **branco sólido** com opacidade proporcional ao ranking (mais leads = mais opaco).
- A origem #1 (top) ganha destaque dourado `#E8C468`. Só uma barra dourada por vez.

**Movimentação (tabs Ganhos / Perdas / Atividade)**
- Ganhos: valor à direita em verde `#4ADE80` (já é hoje, manter).
- Perdas: data em vermelho `#F87171` em vez do rose atual.
- Atividade: timestamp em branco `#F5F5F5/70` em vez de amber.
- Tab ativo: fundo `rgba(232,196,104,0.12)` + texto dourado; inativos em cinza neutro.

**DeltaBadge (▲/▼ vs. período anterior)**
- Positivo: verde `#4ADE80`
- Negativo: vermelho `#F87171`
- Neutro: cinza `#71717A`
- (Já é assim hoje, só padronizar hex exato para bater com a paleta.)

## Onde as mudanças acontecem

- `src/index.css` — ajustar `.premium-card`, `.premium-hero`, `.premium-section-icon` (sombras mais escuras, remover halos dourados, hairline mais firme).
- `src/pages/admin/Dashboard.tsx`:
  - Constante nova `PALETTE = { gold, white, green, red, muted }` no topo.
  - Substituir `STAGE_COLORS` pela nova regra (verde/vermelho + tons de branco).
  - Ajustar `LineChart` (linha branca, grid neutro, ticks neutros).
  - Ajustar `Sparkline` (stroke branco, gradiente dourado suave; aceita prop `tone: "positive" | "negative" | "neutral"`).
  - `KPI`, `MetricCard`, `SectionTitle`: trocar `text-muted-foreground` por cinza fixo, número em branco, ícone com hairline dourado + glyph branco.
  - `DeltaBadge`: cores fixas da paleta.
  - Barras em "Distribuição do funil" e "Origem dos leads": cores da paleta em vez do gradiente amber.

## Fora do escopo

- Não alteramos dados, queries, layout, estrutura de seções, tabs, filtros de período, ou funcionalidade.
- Não mexemos em outras páginas do sistema — só o Dashboard (`/admin`).
- Fontes atuais permanecem; nenhuma instalação nova.
