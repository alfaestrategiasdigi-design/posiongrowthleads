## Diagnóstico READ-ONLY — Métricas Meta erradas

Confirmei lendo `supabase/functions/tenant-campaigns/index.ts`, `supabase/functions/tenant-campaign-detail/index.ts` e `src/pages/app/TenantCampaigns.tsx`. Não alterei nada.

### 1. Fluxo atual

- Frontend monta `since = daysAgoISO(period)` e `until = todayISO()` e chama a edge `tenant-campaigns`.
- `daysAgoISO` / `todayISO` fazem `new Date().toISOString().slice(0,10)` → **data em UTC**.
- Edge envia `time_range: { since, until }` para `GET /{campaign_id}/insights` com `level=campaign` e `time_increment=1` (uma linha por dia).
- Cada linha diária vira `daily[]` (o "gasto no dia") e é somada em `agg` (spend, impressions, clicks, leads, purchases, purchase_value, messaging, link_clicks, video_p25, video_thruplay). CPL/CTR/CPC/CPM/ROAS/CPA são derivados desses agregados.

### 2. Métricas erradas encontradas (com causa concreta)

**A. "Gasto no dia" e todo recorte diário — janela de datas em UTC vs conta em BRT** ← causa principal do sintoma relatado

- `todayISO()` retorna a data em UTC. No Brasil (UTC−3), das 21:00 às 23:59 BRT o `toISOString()` já devolve o **dia seguinte**; da 00:00 às 02:59 BRT ainda devolve o dia anterior teoricamente não (é o mesmo), mas para `daysAgoISO(1)` (opção "hoje") o `since` sai como "ontem UTC" em qualquer horário BRT antes das 21:00.
- A conta de anúncios da Meta usa fuso próprio (as contas brasileiras normalmente America/Sao_Paulo). O parâmetro `time_range` é interpretado no fuso da conta. Ao enviar datas UTC, a janela consultada não bate com o dia local do usuário → aparece gasto "do dia errado", "hoje" mostrando gasto de ontem, e o último bucket do gráfico com valor parcial/vazio.
- Efeito por período:
  - `period=1` ("hoje"): `since` frequentemente é ontem BRT → gasto exibido é de ontem.
  - `period=7/30/90`: o `until` some/ganha 1 dia dependendo da hora → totais e "gasto no dia" (último ponto do sparkline / `daily[]`) desalinhados.
- Também não passamos `time_range[timezone]` nem consultamos `account_timezone_name`, então dependemos 100% da interpretação padrão da Meta.

**B. "Uso do orçamento" (barra `spendPct`) — denominador errado** (`TenantCampaigns.tsx:841`)

- `spendPct = spend / (dailyBudget * period) * 100`, usando o `period` selecionado (1/7/14/30/90). Se a campanha começou depois, ficou pausada, ou é `lifetime_budget` (não `daily_budget`), o denominador está fora de escala → percentual exibido não representa uso real. `daily_budget` também vem em centavos (dividido por 100 ok), mas contas em USD apareceriam divididas como se fossem reais.

**C. ROAS / Faturamento — mistura duas fontes** (`TenantCampaigns.tsx:369-376`)

- `totalRev = s.revenue (Meta purchase_value) + globalStats.revenue (CRM wins do tenant no período)`.
- `globalStats.revenue` é a receita de **todos** os leads ganhos do tenant no período, não apenas os atribuídos a campanhas Meta. Resultado: em tenants com vendas orgânicas / outros canais, ROAS fica inflado; se o Pixel também registra as mesmas compras, há **dupla contagem**.
- `ROAS = totalRev / s.spend` herda o mesmo viés.

**D. Frequência da campanha — pega só o último dia** (`tenant-campaigns/index.ts:147`)

- `last_frequency = Number(row?.frequency ?? last_frequency)` — a cada linha diária sobrescreve; ao final, é a frequência do último dia do intervalo, não a frequência do período (que deveria ser `impressions/reach`). O KPI global no front recomputa como `impressions/reach` (correto), mas cada card de campanha exibe o valor do último dia — inconsistente e usado nos alertas de "frequência alta".

**E. Reach agregado — soma diária, não deduplicado** (`tenant-campaigns/index.ts:140`)

- `agg.reach += row.reach` soma o alcance de cada dia. Alcance da Meta é único por período; somando dias, superestima o reach (pode ficar > impressions em casos raros, e a `frequency = impressions/reach` calculada no front vira artificialmente baixa). O correto é pedir a linha agregada do período (`time_increment` omitido) e usar o `reach` de lá, ou pedir `unique_reach` em janela.

**F. "Impressões" KPI — condicionado ao gasto** (`TenantCampaigns.tsx:600`)

- `NUM(kpis.spend > 0 ? impressões : 0)`. Se por qualquer motivo `spend` vier 0 (ex.: linha de insights truncada por permissão) o card mostra impressões zeradas mesmo quando a campanha teve entrega.

**G. Moeda não validada**

- Nem `tenant-campaigns` nem o detail pedem `account_currency`. Todo `spend` é formatado como BRL (`Intl.NumberFormat pt-BR / BRL`). Contas em USD/outra moeda aparecem como reais com o mesmo número → valor exibido está errado. A função de sync antiga (`facebook-campaigns-sync`) até pede `account_currency`, mas as reais em uso (`tenant-campaigns`, `tenant-campaign-detail`) não.

**H. "Resultado" / cost_per_result para MESSAGES** (`tenant-campaigns/index.ts:159`)

- Se `objective` inclui `MESSAG` e `messaging === 0`, cai em `messaging` mesmo com leads > 0 → `result_value=0` e o "Custo/Conv" exibido é 0, escondendo resultado real.

### 3. Métricas que estão corretas (dado o input)

- `spend`, `impressions`, `clicks` totais do período: soma direta e válida (assumindo janela correta e moeda BRL).
- `ctr = clicks/impressions*100`, `cpc = spend/clicks`, `cpm = spend/impressions*1000`, `cpl = spend/leads`: fórmulas certas.
- Extração de `leads`, `purchases`, `link_clicks`, `messaging` a partir de `actions`: mapeamento coerente com a documentação da Meta.
- `hook_rate = video_p25/impressions*100`, `hold_rate = thruplay/video_p25*100`: convenção padrão.

### 4. Correção proposta (a implementar depois da sua aprovação)

1. **Fuso horário (fix mais importante — resolve o "gasto no dia" e todo o gráfico diário)**
   - Na edge `tenant-campaigns` (e `tenant-campaign-detail`): buscar `timezone_name` da conta de anúncios (`GET /{act_id}?fields=timezone_name,account_currency,currency`), cachear, e:
     - calcular `since`/`until` **naquele fuso** quando o cliente não enviar (usar `Intl.DateTimeFormat` com `timeZone: tz` para derivar `YYYY-MM-DD`);
     - repassar `time_range: { since, until }` já no fuso da conta;
   - No frontend, `daysAgoISO`/`todayISO` deixam de mandar UTC — passam a delegar a data para a edge (ou usam `America/Sao_Paulo` como fallback, com override por conta).
   - Aceitação: `period=1` mostra o gasto do dia local; último bucket do sparkline bate com o Ads Manager na mesma janela.

2. **Moeda**: expor `account_currency` na resposta por conta e por campanha; formatar `spend/cpl/cpm/ROAS` na moeda correta (default BRL). Bloquear soma cross-currency (ou converter usando última cotação — decisão que preciso confirmar com você).

3. **Frequência**: parar de usar `last_frequency`; calcular `frequency = impressions / reach` no servidor a partir dos totais.

4. **Reach**: pedir uma segunda chamada por campanha **sem** `time_increment` só para obter `reach` real do período (uma request extra por campanha; usar o cache existente de 3 min).

5. **`spendPct` (uso do orçamento)**: usar `Math.max(1, dias_com_gasto_no_período)` no denominador, e desligar a barra quando a campanha for `lifetime_budget`.

6. **ROAS**: separar em dois indicadores — "ROAS Meta (Pixel)" `= purchase_value/spend` e "ROAS CRM" `= wins_atribuídos_a_campanhas/spend` (usando `crmStats[campId].revenue`, não `globalStats.revenue`). Elimina dupla contagem e receita orgânica no numerador.

7. **KPI "Impressões"**: remover a condicional em `spend > 0`; sempre exibir a soma de impressões.

8. **Result_kind MESSAGES**: se `messaging === 0` e `leads > 0`, exibir "Leads" em vez de "Conversas 0".

### 5. Perguntas antes de implementar

- **ROAS**: você quer manter um único ROAS (qual fonte prevalece?) ou expor os dois separados (Meta Pixel × CRM)?
- **Moeda**: alguma conta em USD/outra moeda? Se sim, converto para BRL (com cotação diária) ou mostro cada bloco na moeda nativa da conta?
- **Fuso**: assumo `America/Sao_Paulo` como padrão quando a Meta não devolver `timezone_name`, ok?

Sem tocar em dashboard, agendamento, formulários, webhook ou automações.