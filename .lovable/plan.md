# Dashboard da Agência — filtro de data global e layout compacto

## Problemas confirmados no código

1. **KPIs de topo ignoram o período.** Em `src/pages/admin/Dashboard.tsx`, o resumo devolve `leadsPeriodo: leads.length` — ou seja, o total acumulado de leads, não os do intervalo. Por consequência "Clínicas interessadas no pipeline", "Ativos no pipeline" e a taxa de "Conversão" saem erradas.
2. **Cards de pipeline usam a base inteira.** `kanbanLeads`, `emNegociacao`, o valor "Em negociação" e a "Distribuição do funil" (`stageData`) são calculados sobre todos os `agency_leads` carregados, sem recorte de data.
3. **Funil de Conversão consolidado vem acumulado.** Em `src/lib/relatorios/queries.ts`, na visão admin master a consulta de leads aplica apenas `.in("id", masterSourceIds)` e **não** aplica `created_at >= from / <= to` (o recorte existe só nos ramos tenant e multi-tenant). Por isso o funil, rankings e gráficos mostram tudo desde sempre.
4. **"Movimentação" (aba Ganhos) não filtra.** A lista usa `agencyContracts.slice(0, 8)` sobre todos os contratos, não os do período.
5. **Layout muito longo:** seções empilhadas verticalmente (Hero, Pipeline & Agência, Performance consolidada, Clientes) somando ~700 linhas de UI em coluna única.

## O que será feito

### 1. Recorte de data único e obrigatório
- Corrigir a consulta admin master em `queries.ts` para aplicar `created_at` entre início e fim do período também quando há `masterSourceIds` — garantindo que funil, rankings e gráficos respeitem o filtro.
- Em `Dashboard.tsx`, derivar todos os números de uma única lista `leadsPeriodo` já filtrada por `created_at` dentro do intervalo, e usar essa lista em: contagem de leads, ativos no pipeline, em negociação (contagem e valor), distribuição do funil, origem dos leads e conversão.
- "Ganhos", "Ticket médio" e "Receita" continuam vindo de `agencyContracts` já filtrados por `data_assinatura` no período; a aba "Ganhos" da Movimentação passa a usar essa lista filtrada.
- "Ativos no pipeline" passa a ser contagem real de leads do período em estágios abertos (não `total − ganhos − perdas`).

### 2. Comparação com período anterior
Manter os deltas atuais, agora consistentes: período atual vs. janela imediatamente anterior de mesmo tamanho (já calculada em `prevFrom`/`prevTo`).

### 3. Layout compacto
- Cabeçalho fixo com o seletor de datas visível ao rolar, mostrando o período ativo.
- Reduzir para uma estrutura em abas dentro de um único bloco:
  - **Visão geral**: hero de receita + meta + KPIs em grid denso (2 linhas).
  - **Pipeline**: distribuição do funil, origem dos leads e movimentação lado a lado.
  - **Performance**: funil consolidado, rankings e gráficos.
  - **Clientes**: contadores de tenants/SaaS.
- Cards com alturas padronizadas e listas com rolagem interna, eliminando a rolagem vertical infinita da página.

```text
┌──────────────── Header + DateRangePicker (sticky) ────────────────┐
│ [Visão geral] [Pipeline] [Performance] [Clientes]                 │
├───────────────────────────────────────────────────────────────────┤
│  Hero receita + meta      │ KPI │ KPI │ KPI │ KPI │ KPI           │
└───────────────────────────────────────────────────────────────────┘
```

### 4. Alinhamento das seções de apoio
Movimentação (Ganhos/Perdas/Atividade), Origem dos Leads, Rankings e Gráficos passam a consumir exclusivamente dados já recortados pelo período; nenhuma seção usa lista acumulada.

## Detalhes técnicos
- Arquivos alterados: `src/lib/relatorios/queries.ts` (filtro de data na visão admin master), `src/pages/admin/Dashboard.tsx` (memos de agregação + reestruturação do layout em abas).
- Sem mudanças de banco de dados nem de RLS.
- `useRelatorioData` já recebe `from`/`to` do `DateRangePicker`; a correção da query faz o cache do React Query invalidar corretamente a cada mudança de intervalo.
