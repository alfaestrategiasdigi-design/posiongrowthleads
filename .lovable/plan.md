
## Objetivo
Deixar todos os 9 KPIs do topo do /admin/relatorios e /app/relatorios batendo com a fonte da verdade que você definiu.

## 1. Valor Ganho — vira Kanban puro
Hoje: `sales.amount_paid + amount_pending` (tabela sales).
Novo: soma de `leads.valor_proposta` de todo lead com `status = 'ganho'` dentro do filtro/período.

- `aggregators.buildKpis`: trocar cálculo → `leads.filter(status==='ganho').sum(valor_proposta || 0)`.
- Remover dependência de `sales` no KPI (mantém a query só para a coluna da tabela detalhada, se útil, ou remove — ver seção 6).
- Tooltip do card: "Soma de valor_proposta dos leads na etapa Ganho do Kanban".

## 2. Investimento — soma de duas fontes
Hoje: só `campaign_insights.spend`.
Novo: `SUM(campaign_insights.spend) + SUM(campaign_spend.amount_spent)` no período, respeitando filtro de tenant/campanha.

- `queries.ts`: adicionar fetch de `campaign_spend` filtrando por `period_start <= to AND period_end >= from` (sobreposição de período), tenant e campanha (via `campaign_name` ou `campaign_id`).
- `aggregators.buildKpis`: `investimento = insights.spend + spendManual.amount_spent`.
- CPL = investimento / totalLeads; CAC = investimento / ganhos (fórmula não muda, mas agora usa fonte consolidada).
- Tooltip: "Meta Ads sincronizado + lançamentos manuais em Investimento".

## 3. Ocultar tenant Admin Master (`00000000-0000-0000-0000-000000000001`)
- Constante `ADMIN_MASTER_TENANT_ID` em `src/lib/relatorios/constants.ts`.
- `queries.fetchRelatorio`: em `scope==='admin'`, adicionar `.neq('tenant_id', ADMIN_MASTER)` em leads, appointments, sales e insights **quando** o usuário não selecionou explicitamente esse tenant (mas como ele nem vai aparecer no filtro, na prática sempre exclui).
- `queries.fetchFilterOptions`: `.neq('id', ADMIN_MASTER)` na lista de tenants disponíveis.

## 4. Comparecimento / No-show — mantém agenda
Sem mudança: continua vindo de `appointments.status` (`realizado`/`compareceu` vs `no_show`/`faltou`). Só ajusto o rótulo do card para "Comparecimento (agenda)".

## 5. Valor Perdido / demais KPIs — auditoria rápida
Confirmar e ajustar se preciso:
- Total Leads: `count(leads no período)` ✅
- Qualificados: leads com `mql OR sql_qualified OR status ∈ {qualificado, reuniao_agendada, compareceu, negociacao, ganho}` ✅
- Agendamentos: `count(appointments)` no período ✅
- Ganhos: `count(leads.status='ganho')` ✅ (coerente com novo Valor Ganho)
- Valor Perdido: `sum(leads.valor_perdido) WHERE status='perdido'` ✅
- Taxas: qualificação = qualif/total, comparecimento = compareceu/(compareceu+noShow), conversão = ganhos/total ✅

## 6. Limpeza consequente
- Query de `sales` pode ser removida do hook — não é mais usada em nenhum KPI. Se a tabela detalhada precisa de algum dado de venda, faço lookup pontual (mas hoje só usa dados do lead).
- Tipos em `types.ts`: remover `SaleRow` do payload.

## 7. Filtro multi-campanha
Já é multi-select (popover "Campanha" aceita várias). Sem mudança de comportamento — só adiciono microcopy "Selecione uma ou mais" dentro do popover para ficar óbvio.

## Arquivos afetados
- `src/lib/relatorios/constants.ts` (novo — ADMIN_MASTER_TENANT_ID)
- `src/lib/relatorios/queries.ts` (exclui admin master, adiciona campaign_spend, remove sales)
- `src/lib/relatorios/aggregators.ts` (Valor Ganho via leads.valor_proposta; Investimento consolidado)
- `src/lib/relatorios/types.ts` (tipo `SpendRow`; remover `SaleRow` do payload)
- `src/hooks/useRelatorioData.ts` (repassar novo payload)
- `src/components/relatorios/KpiSummary.tsx` (tooltips/rótulos)
- `src/components/relatorios/FiltersBar.tsx` (microcopy do popover Campanha)

## Fora de escopo
- Não vou migrar/apagar registros existentes no tenant Admin Master (só oculto do relatório).
- Não vou criar coluna `leads.valor_ganho` — você escolheu Kanban puro via `valor_proposta`.
- Não mexer em Facebook/CAPI/webhooks.
