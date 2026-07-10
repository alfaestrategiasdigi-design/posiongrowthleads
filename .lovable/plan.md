## Diagnóstico

**1. KPIs de conversão errados (Agendamento, Comparecimento, No-show)**

O painel de Taxas do dashboard hoje só olha `leads.status`. Mas os eventos reais de agendamento e comparecimento vivem na tabela `appointments` (status: `agendado`, `realizado`, `no_show`, `cancelado`). O `leads.status` só é promovido para `reuniao_agendada` / `compareceu` quando o lead ainda está em `lead` ou `qualificado` (ver `AppointmentDialog.tsx` linhas 177‑182). Se o lead já estava em `negociacao` ou pulou etapas, o status nunca é atualizado — por isso Agendamento/Comparecimento aparecem 0.0% mesmo com reuniões cadastradas. O módulo Relatórios (`src/lib/relatorios/aggregators.ts`) já faz certo lendo `appointments`.

**Qualificação** também está incompleta: hoje só conta `status = qualificado`, ignorando os leads com flags `mql`/`sql_qualified` (que os Relatórios usam).

**2. Fonte única, replicada em vários locais**

As definições precisam ficar iguais no TenantDashboard, no Kanban (contador de cards por etapa) e no `KpiSummary` dos Relatórios, senão o usuário vê números diferentes para a mesma métrica.

**3. Espaço vazio no layout**

No hero em desktop (≥1024px) a coluna direita empilha 3 KpiPremium + painel de Taxas, ficando bem mais alta que o gráfico à esquerda. O `items-start` na grid e o `flex-1` do painel não conseguem esticar o gráfico. Em 320/768px o painel de Taxas fica esmagado em 3 colunas.

---

## Plano

### A. Corrigir e unificar o cálculo das taxas

Criar `src/lib/funnel-metrics.ts` com uma função pura:

```
computeFunnelMetrics({ leads, appointments, from, to })
  → { totalLeads, qualificados, agendados, compareceram, noShow, ganhos, decididos, rates }
```

Regras (mesmas do Relatórios, agora oficializadas):

| Métrica | Numerador | Denominador |
|---|---|---|
| Qualificação | leads com `mql`, `sql_qualified` ou status ∈ {qualificado, reuniao_agendada, compareceu, negociacao, ganho} (criados no período) | leads criados no período |
| Agendamento | leads distintos com pelo menos 1 appointment (status ≠ cancelado) cuja `date_time` cai no período | qualificados |
| Comparecimento | appointments com status `realizado` ou `compareceu` no período | compareceram + no_show do período |
| No-show | appointments com status `no_show`/`faltou` no período | compareceram + no_show do período |
| Fechamento | leads com `status = ganho` criados no período | compareceram |
| Conv. Geral | leads com `status = ganho` criados no período | leads criados no período |

Isso resolve o caso reportado: os appointments existentes passam a contar mesmo sem promover `leads.status`.

### B. Aplicar a nova fonte em todos os locais

1. **`src/pages/app/TenantDashboard.tsx`**
   - Buscar `appointments` do tenant (`id, lead_id, date_time, status`) além dos leads/vendas.
   - Substituir `computeFunnel` interno pela função nova, tanto para o período atual quanto para o período anterior (o comparativo "vs" continua funcionando).
   - Atualizar `STAGE_SETS` do drill-down: Agendamento e Comparecimento passam a listar leads via `appointment.lead_id`; No-show idem.

2. **`src/components/admin/KanbanBoard.tsx`** — verificar o contador exibido em cada coluna do funil e alinhar rótulos e agrupamento com o mesmo mapa de estágios.

3. **`src/components/relatorios/KpiSummary.tsx`** e `src/lib/relatorios/aggregators.ts` — apontar para a mesma função nova para garantir paridade (o cálculo já é equivalente; ficará DRY).

4. **`src/pages/admin/Dashboard.tsx`** — auditoria: se listar as mesmas taxas para o admin master, usar a mesma função somando por tenant.

### C. Reorganizar o hero para eliminar espaço vazio (todos breakpoints)

- **≥1024px**: mover o painel "Taxas de Conversão do Funil" para uma linha **full‑width abaixo do hero**. O hero fica em 2 colunas balanceadas (gráfico ~ 3 KPIs), sem sobra vertical. A linha das taxas usa `grid-cols-6` para as 6 métricas em uma faixa horizontal.
- **768px (tablet)**: `grid-cols-3` para as 6 taxas em 2 linhas, KpiPremium em `grid-cols-3` acima do gráfico.
- **<640px (mobile, 320px)**: tudo em `grid-cols-2` para as taxas (3 linhas × 2), KpiPremium 1 coluna. Remover `flex-1`/`h-full` que geram caixa vazia em stack.
- Adicionar `items-stretch` na grid do hero e usar `h-full` nos cards para as colunas empatarem quando ainda houver 2 colunas.

Depois de aplicar, validar via Playwright headless nos 4 breakpoints (320, 768, 1024, 1440) tirando screenshot e confirmando visualmente ausência de espaço vazio.

### D. Rótulos e tooltips coerentes

Atualizar os tooltips já existentes de cada taxa para refletir a nova fórmula (ex.: Agendamento agora é "Leads com reunião marcada ÷ Qualificados", Comparecimento "Appointments realizados ÷ (Realizados + No-show)").

---

## Fora do escopo

- Não vou mudar como `AppointmentDialog` promove `leads.status` (mantém compatibilidade com Kanban).
- Não vou tocar em regras de qualificação (`mql`/`sql_qualified`) — só passar a considerá‑las.
- Não vou mexer em vendas/faturamento/meta.
