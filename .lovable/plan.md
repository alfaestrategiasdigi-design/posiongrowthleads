
## Objetivo

1. Tornar o `/admin` (Dashboard) **100% comercial**: leads, funil, performance de campanhas Facebook Ads — sem MRR/contratos.
2. Mover métricas financeiras (MRR, ARR, Churn, contratos ativos) para a aba **Contratos** (`/admin/contracts`).
3. Em `/admin/leads`: novo bloco "Origem Facebook" com contagem por formulário e por status, e link para diagnóstico.
4. **Tudo automático**: importação de leads + leitura de campanhas do Facebook (Ad Account) com sincronização periódica.
5. Sidebar "Campanhas" continua como hoje — mas alimentada automaticamente.

---

## 1. Backend: credenciais Ad Account + auto-sync

### 1.1 Schema (migração)
Adicionar à `facebook_webhook_config`:
- `ad_account_id` (text, ex.: `act_1234567890`)
- `last_campaigns_sync_at` (timestamptz)
- `last_leads_sync_at` (timestamptz)

Atualizar `get_facebook_config_meta()` para expor `ad_account_id`, `last_campaigns_sync_at`, `last_leads_sync_at`.

### 1.2 Reconexão Facebook com `ads_read`
Atualizar `facebook-oauth-exchange` para solicitar escopo `ads_read,ads_management,business_management` além dos já existentes (`leads_retrieval`, `pages_show_list`, etc.). O usuário precisa **reconectar 1×** após o deploy para receber o token com permissão Marketing API.

### 1.3 Nova Edge Function: `facebook-campaigns-sync`
- Lê `ad_account_id` + `page_access_token` (ou env fallback) de `facebook_webhook_config`.
- Chama `GET /{ad_account_id}/campaigns?fields=id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time`.
- Para cada campanha, chama `GET /{campaign_id}/insights?fields=spend,impressions,clicks,actions&date_preset=last_30d` (ou range customizado).
- Faz **upsert** em `campaign_spend` (chave: `tenant_id + campaign_id + period_start`):
  - `channel = 'meta_ads'`
  - `campaign_id`, `campaign_name`, `amount_spent`, `impressions`, `clicks`
  - `leads_generated` = count das ações `lead`/`onsite_conversion.lead_grouped`
  - `period_start/period_end` = janela do insight (rolling 30d ou day-by-day)
- Atualiza `last_campaigns_sync_at`.
- Endpoint admin-only (verifica `has_role`).

### 1.4 Auto-cron (pg_cron + pg_net)
Agendar via `supabase--insert` (não migration):
- `facebook-campaigns-sync` a cada **15 min**
- `facebook-backfill-leads` a cada **5 min** (incremental — só formulários da página)
- Ambos com `apikey` anon header + JWT de service (chamada server-to-server via header customizado validado dentro da function por shared secret env var `INTERNAL_CRON_SECRET`).

### 1.5 Tenant mapping
- Como hoje só existe 1 página conectada globalmente, `campaign_spend.tenant_id` para campanhas auto-importadas usa o `tenant_id` configurado em `facebook_webhook_config` (novo campo `default_tenant_id`, FK `tenants.id`, nullable). Se nulo, salva com `tenant_id = NULL` e exibe agregado em "Todas as clínicas".

---

## 2. Frontend: Dashboard `/admin` comercial

Reescrever `src/pages/admin/Dashboard.tsx`:

**KPIs topo (cards animados):**
- Leads totais (período)
- Leads Facebook Ads
- Qualificados / Tx qualificação
- Agendados
- Fechados / Tx conversão
- Investido / CPL / ROI (vindo de `campaign_spend`)

**Gráficos:**
- Linha: Leads por dia (últimos 7/30/90d)
- Área: Investido × Receita
- Pizza: Origem dos leads (`facebook_ads`, `site`, `whatsapp`, etc.)
- Barras: Top 5 campanhas Facebook por leads

**Filtros:** período (7/30/90/todos) + clínica (tenant).

**Realtime:** assinar `leads` table → recarrega contadores quando chega lead novo.

## 3. `/admin/leads` — bloco "Origem Facebook"

Em `src/pages/admin/LeadsPage.tsx`, adicionar acima da tabela:
- Card "Resumo Facebook Ads"
  - Total de leads por `facebook_form_id` (com `facebook_form_name`)
  - Breakdown por `status` (novo, qualificado, agendado, etc.) — barras horizontais
  - Botão "Ver diagnóstico" → navega para `/admin/facebook` (aba diagnóstico)
  - Indicador "Última importação: há X min" (de `last_leads_sync_at`)

## 4. `/admin/campanhas` — auto-leitura

Em `src/pages/admin/CampanhasPage.tsx`:
- Botão "Sincronizar agora" → invoca `facebook-campaigns-sync`.
- Indicador "Última sincronização" + auto-refresh a cada 60s.
- Manter o botão "Novo investimento" para canais não-Meta (Google, TikTok).
- Tabela de campanhas passa a exibir tag "Auto" para linhas vindas da Marketing API.

## 5. `/admin/contracts` — receber MRR/ARR

Mover blocos de MRR, ARR, Churn, Plan Mix e MRR Trend do Dashboard atual para o topo de `ContractsPage.tsx`.

---

## Detalhes técnicos

**Tabelas tocadas:** `facebook_webhook_config` (alter), `campaign_spend` (upsert), `leads` (read), `posion_contracts` (read em Contracts).

**Edge functions:**
- nova: `supabase/functions/facebook-campaigns-sync/index.ts`
- alterada: `supabase/functions/facebook-oauth-exchange/index.ts` (escopo)

**Secret novo:** `INTERNAL_CRON_SECRET` (para chamadas pg_cron→edge).

**Permissões Meta extras necessárias no App:** `ads_read` (App Review pode ser exigida para produção; em modo dev funciona com o token do admin do Business).

---

## Sequência de execução

1. Migração schema (`ad_account_id`, sync timestamps, `default_tenant_id` + RPC).
2. Criar `facebook-campaigns-sync` + atualizar `facebook-oauth-exchange`.
3. Agendar cron (campaigns 15m, leads 5m).
4. Reescrever Dashboard.tsx (comercial).
5. Adicionar bloco Facebook em LeadsPage.tsx.
6. Adicionar auto-sync UI em CampanhasPage.tsx.
7. Mover MRR/ARR para ContractsPage.tsx.
8. Pedir ao usuário: reconectar Facebook + informar Ad Account ID em `/admin/facebook`.
