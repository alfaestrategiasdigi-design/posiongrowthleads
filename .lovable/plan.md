## O que vai ser adicionado ao módulo de Relatórios

Vou complementar a tela **Relatórios** (a mesma que roda em `/app/{clinica}/relatorios` e `/admin/relatorios`) com as informações do seu Power BI antigo, mantendo a organização atual (KpiSummary no topo, Funil no meio, Charts embaixo). Nada muda no design nem no dashboard da clínica.

Todos os filtros já existentes (período, campanha, formulário, origem) continuam valendo e alimentam as novas seções.

---

### 1. Novos KPIs financeiros (bloco "Financeiro" no `KpiSummary`)

Calculados a partir de `sales` (janela filtrada por `sale_date`) e do que já existe no relatório:

| KPI | Fórmula |
|---|---|
| **Vendas** | soma de `sales.amount` + contagem de vendas |
| **Nova Venda** | vendas em `sales` onde `first_contact_date` está dentro do período (cliente novo) |
| **Monetização** | soma de `sales.amount` de vendas cujo `patient_id` já teve venda anterior (recompra) |
| **Meta** | `monthly_goals.goal_3` do mês corrente (ou goal_2/goal_1 como fallback) |
| **Não Realizado** | `Meta − Vendas` (só mostra se meta > vendas) |
| **Ticket Médio** | `Vendas / Qtd Vendas` |
| **CPA** | `investimento / qtd vendas` |
| **CPL** | já existe |
| **CPMQL** | `investimento / leads com mql=true` |
| **CPSQL** | `investimento / leads com sql_qualified=true` |

Investimento continua vindo de `campaign_insights` + `campaign_spend`, como hoje.

### 2. Funil de Vendas do BI (nova seção ao lado do funil atual)

Segundo funil com os 6 estágios do print, calculado sobre a `leads` filtrada:

`Leads → Leads QLF (mql/sql) → RA (reuniao_agendada_em) → RR (reuniao_realizada_em) → SQL (sql_qualified) → Vendas (status='ganho')`

Cada linha mostra a barra proporcional + % em relação à etapa anterior, igual ao print. Fica embaixo do funil de status atual, sem substituí-lo.

### 3. Ranking Closer e Ranking SDR (nova seção "Rankings")

Dois cards lado a lado:

- **Ranking Closer**: agrupa `sales` por `seller_name`, soma `amount`, ordena e mostra posição (1º, 2º, 3º…). Fonte: `sales.seller_name`.
- **Ranking SDR**: agrupa `leads` (status ganho) por `owner_user_id`, soma `valor_proposta`. Fonte: `leads.owner_user_id`. Mostra o id abreviado (padrão já usado em `availableOwners`) — se o campo estiver vazio, o card informa "Sem SDR atribuído".

### 4. Produto, Monetizados e Taxa por Canal (adicionados ao `ChartsGrid`)

Quatro gráficos novos:

- **Faturamento por Produto** (barras): agrupa `sales` por `product` (fallback `procedure_name`), soma `amount`.
- **Monetizados por Produto** (barras): mesma agregação mas restrito às vendas de recompra (mesma regra de "Monetização" acima).
- **Taxa Conversão / Canal** (donut): por `sales.channel_origin` (ou `channel`), % de vendas sobre leads do mesmo canal.
- **Taxa SQL / Canal** (donut): por `leads.origem`, % de `sql_qualified=true` no total do canal.

---

## Arquivos que serão alterados / criados

- `src/lib/relatorios/types.ts` — estender `Kpis` com os novos campos e `RelatorioData` com `rankings`, `bySalesProduct`, `byMonetizedProduct`, `channelConversion`, `channelSql`, `biFunnel`.
- `src/lib/relatorios/queries.ts` — passar a buscar também `sales` (janela por `sale_date`) e `monthly_goals` do tenant.
- `src/lib/relatorios/aggregators.ts` — novas funções `buildRankings`, `buildBiFunnel`, `buildProductBreakdown`, `buildChannelRates`, e ampliar `buildKpis` com Ticket, CPA, CPMQL, CPSQL, Nova Venda, Monetização, Meta, Não Realizado.
- `src/hooks/useRelatorioData.ts` — repassa os novos dados sem mudança de assinatura pública.
- `src/components/relatorios/KpiSummary.tsx` — adiciona bloco "Financeiro" com os KPIs novos.
- `src/components/relatorios/RankingsGrid.tsx` *(novo)* — cards Ranking Closer + SDR.
- `src/components/relatorios/BiFunnel.tsx` *(novo)* — funil do BI (Leads → Vendas).
- `src/components/relatorios/ChartsGrid.tsx` — 4 gráficos novos (Produto, Monetizados, Taxa Conv./Canal, Taxa SQL/Canal).
- `src/components/relatorios/RelatoriosContainer.tsx` — insere `<BiFunnel>` e `<RankingsGrid>` na ordem visual.
- `src/components/relatorios/export/exportToPdf.ts` — inclui as novas seções no PDF já existente, seguindo o mesmo estilo dark/gold.

Sem migração de banco. Se algum campo estiver vazio (ex.: `seller_name` ou `owner_user_id`), o card mostra "Sem dados" em vez de quebrar.
