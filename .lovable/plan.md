# Bloco de performance na aba Visão geral

Hoje o bloco completo (KPIs financeiros, funil BI, funil de etapas, rankings e gráficos) existe apenas na aba "Performance" do Dashboard da Agência. Vamos trazê-lo para a primeira aba, "Visão geral".

## O que muda

- Na aba **Visão geral**, abaixo do bloco de Receita total combinada e dos cards laterais, passa a aparecer:
  - KPIs: Vendas, Investimento, Ticket médio, CPA, CPL, CPMQL, CPSQL, Meta / Não realizado
  - Funil BI: Leads → QLF → RA → RR → SQL → Vendas, lado a lado com o funil de etapas do pipeline
  - Rankings de Closers e SDRs
  - Gráficos consolidados
- Tudo continua respeitando o filtro de data global do topo (o mesmo já usado hoje).
- Estados de carregando/erro preservados, para a aba não quebrar enquanto os dados chegam.
- A aba **Performance** deixa de duplicar o conteúdo: ela passa a concentrar apenas os gráficos consolidados e rankings detalhados, evitando página duplicada e rolagem excessiva.

## Detalhes técnicos

- Arquivo: `src/pages/admin/Dashboard.tsx`.
- Mover o bloco `KpiSummary` + `BiFunnel`/`FunilVisual` + `RankingsGrid` do `TabsContent value="perf"` para o final do `TabsContent value="overview"`, mantendo `relatorioQuery.isLoading` / `isError` guards e a mesma fonte de dados (`relatorio`, já filtrada por período).
- `ChartsGrid` permanece na aba Performance para não sobrecarregar a Visão geral.
- Sem mudanças de banco de dados ou de queries.
