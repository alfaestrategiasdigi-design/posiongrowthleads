## Objetivo

Transformar **Campanhas Meta** num dashboard tipo UTM: cada card mostra os leads ganhos do Kanban vinculados por `utm_campaign`, `facebook_campaign` **ou nome do formulário** (fuzzy), inclusive quando a campanha está pausada. Permitir configurar uma **Ad Account por tenant** no Admin Master e espelhar essas campanhas dentro do painel de cada cliente. Disparar **Conversão Offline (CAPI)** automaticamente ao ganhar, com botão manual de reenvio.

## Etapa 1 — Banco (migração única)

- Nova tabela `tenant_ad_accounts` (tenant_id, ad_account_id, label, active). Um tenant pode ter várias contas.
- Nova tabela `campaign_lead_links` (campaign_id, agency_lead_id/lead_id, match_source: 'utm' | 'facebook_campaign' | 'form_name_fuzzy' | 'manual', confidence). Popular via job/RPC — evita recalcular fuzzy match a cada render.
- Nova coluna `agency_leads.campaign_id_manual` para vínculo manual.
- RPC `link_leads_to_campaigns(tenant_id uuid default null)` que roda o match (UTM > facebook_campaign > fuzzy do nome do formulário via `similarity()` do pg_trgm).
- Trigger em `agency_leads` e `leads` que chama a RPC para o lead alterado.
- Coluna `campaign_insights.offline_events_sent int default 0` para rastrear reenvios.

## Etapa 2 — Admin Master: página "Campanhas Meta" redesenhada

`src/pages/admin/CampanhasPage.tsx`:
- Filtro global de **Ad Account** (todas / por conta) — lista extraída de `campaign_insights` + `tenant_ad_accounts`.
- Cards agrupados: nome da campanha, status (ativa/pausada), gasto, leads Meta, **Leads ganhos (do Kanban)** com avatares (Alessandro, Cibele, Arielle…), receita, ROAS, badge "Tenant vinculado" se a ad_account estiver mapeada.
- Clicar no card abre um drawer com:
  - Lista de leads ganhos vinculados (com fonte do match).
  - Botão **"Enviar Conversão Offline"** por lead + **"Reenviar todas"**.
  - Ações: **Vincular a tenant** (cria/atualiza `tenant_ad_accounts`), **Vincular lead manual**.

## Etapa 3 — Painel do cliente: nova aba "Campanhas Meta"

- Rota `/app/:slug/campanhas` (sidebar do tenant).
- Só mostra campanhas das ad_accounts em `tenant_ad_accounts` daquele tenant.
- Mesmo layout de cards (leitura), sem edição de mapeamento — só o cliente vê o próprio funil de origem.
- Reaproveita `CampanhasPage` com prop `scope="tenant"`.

## Etapa 4 — Conversão Offline (CAPI)

- Edge function `facebook-capi-event` já dispara Purchase ao ganhar. Adicionar:
  - Envio para **offline_conversions** quando a campanha tem `ad_account_id` (usa `/act_XXX/events` do Marketing API com `upload_tag`).
  - Botão manual chama a mesma função com `force_resend: true`.
- Registrar em `facebook_capi_logs` + incrementar `offline_events_sent`.

## Etapa 5 — Pipeline do cliente (labels de clínica)

- Já existe `agency_leads` para Posion. Criar `clinic_leads_pipeline` view / reutilizar `leads` do tenant com o **mesmo Kanban visual**, apenas trocando labels: `reuniao_agendada → consulta_agendada`, `compareceu → compareceu`, resto igual.
- Componente `KanbanBoard` recebe `stageLabels` prop; usa labels de clínica quando `scope="tenant"`.

## Técnico

- Match fuzzy: `pg_trgm` extension + `similarity(campaign_name, form_name) > 0.35`.
- Realtime: canal `campaign_lead_links` para atualizar cards ao vivo quando lead vai para "ganho".
- CAPI offline usa `MP_ACCESS_TOKEN`? Não — precisa do `FACEBOOK_PAGE_ACCESS_TOKEN` já existente + `ad_account_id`.

## Entrega

Migração → CampanhasPage redesenhado → rota tenant → CAPI offline → labels de clínica. Tudo num turno; se algo falhar validamos por partes.
