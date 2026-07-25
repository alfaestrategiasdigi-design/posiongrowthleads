## O que vou fazer no Dashboard da Agência (`/admin/tenants`)

### 1. Trazer o hero "Receita Total Combinada" de volta pro topo
Hoje ele desceu pra baixo do Pipeline. Vou colocá-lo **logo abaixo do header** de novo — grande, com o valor faturado (Agência + SaaS MRR), meta mensal editável, sparkline de receita, e 3 mini-KPIs à direita (Clínicas interessadas, Ganhos, Conversão) exatamente como estava antes.

Ordem final da página passa a ser:
1. Header + DateRangePicker
2. **Hero de Receita + mini-KPIs** ← volta pro topo
3. Pipeline & Agência (5 KPIs tintados + Distribuição do funil / Origem / Movimentação)
4. **Novas seções ricas** (item 2 abaixo)
5. Clientes POSION

### 2. Replicar a "riqueza" dos Relatórios dentro do Dashboard
Os componentes que você mostrou no print (Funil de Conversão cumulativo, Rankings, Leads por dia, Origem donut, Top campanhas) já existem prontos em `src/components/relatorios/` e são alimentados pelo hook `useRelatorioData(filters, "admin", null)`, que já sabe consolidar dados de todas as clínicas.

Vou plugar esses mesmos componentes no Dashboard, dentro de uma nova seção **"Performance consolidada"**, respeitando o mesmo período do `DateRangePicker` do Dashboard:

- **`<FunilVisual>`** — funil com barra proporcional, % do total e % da etapa anterior, mais os cards "Perdido" e "Não comparecimento" abaixo (idêntico ao print).
- **`<RankingsGrid>`** — Ranking Closer (faturamento por vendedor) + Ranking SDR (leads ganhos por responsável), lado a lado.
- **`<ChartsGrid>`** — Leads por dia (área), Origem (donut pago vs. orgânico), Top campanhas (barras horizontais), Formulários (donut), Comparecimento por dia da semana, Faturamento por produto, Monetizados por produto, Taxa Conversão/Canal, Taxa SQL/Canal.

Como são os mesmos componentes usados em `/admin/relatorios`, o visual e o comportamento (tooltips, cores douradas, responsividade) ficam automaticamente consistentes com o resto do sistema.

### 3. Ligação com o filtro de data existente
O `DateRangePicker` do Dashboard vira a fonte única do período: convertemos `range.from`/`range.to` para o formato `yyyy-MM-dd` que o `useRelatorioData` espera e alimentamos tudo (hero, pipeline, funil rico, rankings, charts) com o mesmo intervalo. Sem filtro duplicado, sem confusão.

### 4. Detalhes técnicos
- Arquivo tocado: `src/pages/admin/Dashboard.tsx` (só reordenação + imports novos).
- Sem migração de banco, sem edge function, sem mudança de schema.
- Sem novos componentes — reaproveita `FunilVisual`, `RankingsGrid`, `ChartsGrid`, `useRelatorioData`.
- Loading state: mostra spinner só nas seções ricas enquanto `useRelatorioData` carrega, sem bloquear o resto do Dashboard.
- Se `useRelatorioData` retornar erro, mostro um aviso discreto na seção rica sem quebrar a página.

### O que **não** vou mexer
- Estilo/identidade (dark + gold) permanece.
- Sidebar, header, tema claro/escuro — nada.
- Página `/admin/relatorios` continua existindo do jeito que está (só passa a compartilhar componentes com o Dashboard).