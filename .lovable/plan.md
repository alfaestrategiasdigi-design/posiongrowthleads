# Redesign da página `/campanhas` (Tenant) — Meta Ads para Clínicas

Objetivo: transformar a página de campanhas do tenant em um cockpit completo de tráfego pago para clínicas, unindo (a) métricas nativas do Meta, (b) funil comercial da clínica (lead → agendamento → consulta → venda), e (c) drill‑down até o criativo com preview visual.

Baseado em pesquisa de mercado (Triple Whale, Northbeam, docs oficiais Meta v22, Wordstream 2025, benchmarks de agências BR — fiveperformance, elogrowth, triagefy).

---

## 1. Correção de nomenclatura (tenant view)

No contexto de clínica, "reunião" não faz sentido — o evento é **consulta / agendamento**.

- `Custo por Reunião` → **`Custo por Consulta`** (agendada)
- `Reuniões` → **`Consultas Agendadas`**
- Novo KPI: **`Custo por Consulta Realizada`** (usa `appointments.status IN ('compareceu','realizado','fechado')`)
- Novo KPI: **`Taxa de Show`** (Realizadas ÷ Agendadas)

Master view (agência) segue com "Reunião" onde couber.

---

## 2. Novos KPIs (linha de topo)

Cards agrupados em 3 blocos com sparkline:

**Mídia (Meta):** Investido · Impressões · CTR · CPM · Frequência
**Funil da clínica:** Leads · CPL · Consultas Agendadas · Custo/Consulta · Consultas Realizadas · Custo/Consulta Realizada · Taxa de Show
**Resultado:** Vendas · Ticket Médio · Receita · CAC (spend ÷ vendas) · ROAS real (receita CRM ÷ spend)

CAC e ROAS usam receita real do CRM (kanban ganho + `sales` do tenant), não o `purchase_value` do pixel.

---

## 3. Funil visual etapa‑a‑etapa

Componente novo `CampaignFunnel` acima dos cards de campanha:

```text
Leads → Contato WhatsApp → Consulta Agendada → Consulta Realizada → Venda
  562        420 (75%)         180 (43%)           126 (70%)      38 (30%)
```

Cada etapa mostra: absoluto, % vs etapa anterior, custo acumulado, badge vermelho quando abaixo do benchmark (show < 60%, fechamento < 20%).

---

## 4. Drill‑down em 3 níveis (Campanha → AdSet → Ad/Criativo)

Ao clicar num card de campanha, abre um **painel lateral (Sheet full‑height)** com abas:

1. **Visão Geral** — todos os KPIs da campanha + funil próprio + gráfico diário (spend/leads/consultas).
2. **AdSets** — tabela expansível; cada linha mostra spend, leads, CPL, público‑alvo, status. Ao expandir, lista os Ads.
3. **Criativos** — grid de cards com:
   - Thumbnail/preview do vídeo ou imagem (via `GET /{ad-id}/previews` + `image_url`/`thumbnail_url` do creative)
   - Hook Rate (video_p25 ÷ impressions), Hold Rate (thruplay ÷ p25), CTR, CPM
   - Custo por resultado do criativo isolado
   - Frequência isolada + idade em dias
   - Ranking de qualidade/engajamento/conversão do Meta
   - Badges automáticos: `🔥 Top`, `⚠️ Fadigado`, `📉 CTR caindo`
4. **Leads da Campanha** — tabela dos leads atribuídos (por `facebook_campaign_id` ou nome), status no kanban, valor, agendamentos, vendas. Export CSV.
5. **Insights** — alertas automáticos (ver §6).

Breadcrumb no topo do painel: `Conta > Campanha > AdSet > Ad`.

---

## 5. Preview de criativos (Meta Marketing API)

Nova função edge `tenant-campaign-detail` que, dado `campaign_id`:
- Lista adsets (`GET /{campaign_id}/adsets` — fields: `id,name,status,targeting,daily_budget,optimization_goal`)
- Lista ads (`GET /{adset_id}/ads` — fields: `id,name,status,creative,effective_status`)
- Para cada ad, busca creative (`GET /{creative_id}` — `object_story_spec,image_url,video_id,thumbnail_url,body,title,call_to_action_type,instagram_permalink_url`)
- Busca preview HTML (`GET /{ad_id}/previews?ad_format=MOBILE_FEED_STANDARD`) — retorna iframe embutível
- Insights por ad com `video_play_actions`, `video_p25/50/75/100_watched_actions`, `video_thruplay_watched_actions` para calcular Hook/Hold Rate

Cache TTL de 5–10 min por campanha.

---

## 6. Alertas automáticos

Painel `CampaignInsights` (Card lateral ou dialog dedicado) com regras client‑side sobre os dados carregados:

- **Fadiga criativa**: Frequência > 3,5 nos últimos 7d **e** CTR caiu >20% vs média 14d
- **CPM inflando**: CPM subiu >20% vs 7d anteriores
- **Adset ocioso**: gasto < 20% do daily_budget em 3 dias
- **Learning travado**: menos de 50 eventos de otimização/semana
- **Vazamento no funil**: show‑rate < 60% ou fechamento < 20%
- **CPL bom, CPA ruim**: CPL abaixo da mediana mas custo por agendamento acima → problema comercial, não de mídia

Cada alerta com severidade (info/warn/critical), campanha/adset afetado e sugestão de ação.

---

## 7. Atribuição corrigida (backend)

Problema atual: lead da Andreia guarda `facebook_campaign = '52565356266108'` (ID puro) porque o webhook não conseguiu buscar o `campaign_name` no Graph. Isso quebra a atribuição por nome.

Correções:
- **Migração**: adicionar coluna `facebook_campaign_id text` em `leads` (persistir explicitamente o ID). Backfill: mover valores 100% numéricos de `facebook_campaign` para `facebook_campaign_id`.
- **Webhook `facebook-leads-webhook`**: salvar sempre `facebook_campaign_id`, `facebook_adset_id`, `facebook_ad_id` além dos nomes; preferir nome do Graph, cair para ID somente quando faltar.
- **Frontend `TenantCampaigns`**: atribuição por `facebook_campaign_id === c.id` (primário) OU nome case‑insensitive (fallback) OU `utm_campaign`.

---

## 8. Eventos offline / CAPI (fase 2, opcional nesta iteração)

Estender `facebook-capi-event` para disparar quando:
- `appointments.status` vira `compareceu` → evento `Schedule` / custom `AppointmentCompleted`
- `sales` insert com `amount > 0` → `Purchase` com valor real

Isso permite otimizar campanhas por receita real e não por lead. Fica pronto para ligar via toggle em `Configurações → Meta CAPI`.

---

## 9. Detalhamento técnico

**Frontend**
- `src/pages/app/TenantCampaigns.tsx` — refactor: 3 grupos de KPIs, funil, cards com botão "Analisar" que abre Sheet.
- Novo: `src/components/campaigns/CampaignFunnel.tsx`
- Novo: `src/components/campaigns/CampaignDetailSheet.tsx` (abas: Overview | AdSets | Criativos | Leads | Insights)
- Novo: `src/components/campaigns/CreativeCard.tsx` (thumbnail + hook/hold + badges)
- Novo: `src/components/campaigns/AlertsPanel.tsx`
- Reusar `Sheet`, `Tabs`, `Table`, `Badge` do shadcn.

**Backend (edge functions)**
- Refactor `supabase/functions/tenant-campaigns/index.ts`: adicionar `reach`, `frequency`, `video_*_watched_actions`, `quality_ranking`, `engagement_rate_ranking`, `conversion_rate_ranking` aos fields de insights.
- Nova: `supabase/functions/tenant-campaign-detail/index.ts` — dado `tenant_id` + `campaign_id`, retorna adsets, ads, creatives com preview, insights por ad.
- Update `supabase/functions/facebook-leads-webhook/index.ts` — persistir `facebook_campaign_id/adset_id/ad_id`.

**Banco**
- Migração: `ALTER TABLE leads ADD COLUMN IF NOT EXISTS facebook_campaign_id text, ADD COLUMN IF NOT EXISTS facebook_adset_id text, ADD COLUMN IF NOT EXISTS facebook_ad_id text` — já existem `facebook_adset_id`/`facebook_ad_id`; só falta `facebook_campaign_id`. Backfill dos numéricos.
- Índice em `leads(facebook_campaign_id)` para atribuição rápida.

**Fase 2 (não incluída na primeira entrega, sinalizada como próximo passo)**
- CAPI de eventos offline (agendamento/venda).
- Persistir snapshot histórico de insights por ad (`campaign_insights_breakdown` já existe) para permitir comparações temporais de criativos.

---

## 10. Escopo desta entrega

Nesta iteração entregarei §1, §2, §3, §4, §5, §6, §7, §9 (frontend + backend + migração).
§8 (CAPI offline) fica documentado como próxima fase — envolve mudança de trigger e toggle de configuração que merecem ciclo próprio.
