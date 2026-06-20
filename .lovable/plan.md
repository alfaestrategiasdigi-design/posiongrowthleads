## Resumo
Três frentes paralelas no POSION OS: (1) inbox WhatsApp ligado direto à Evolution API v2, (2) KPIs Meta puxando dados reais por período, (3) sync automático de leads Meta a cada 15 min. Mantenho a identidade visual atual e adapto o schema do projeto (que já é multi-tenant com `tenants`, `conversations`, `messages`, `zapi_connections`) em vez de criar tabelas paralelas com nomes genéricos.

> Importante sobre o schema: o projeto usa `tenants` (não `organizations`), e já existem `conversations`, `messages` e `zapi_connections`. Vou estender essas tabelas em vez de criar `whatsapp_config`/`contacts`/`messages` novas — assim o WhatsApp inbox conversa com Kanban, Recall, Leads e o resto do app sem ilhas de dados. Se preferir tabelas novas e isoladas, me avise antes de implementar.

---

## Parte 1 — Inbox WhatsApp (Evolution API v2)

### Schema (migrations)
- `zapi_connections`: adicionar `provider='evolution'` como opção válida; já tem `instance_url`, `api_key`, `instance_name`. Adicionar `webhook_secret` (texto, opcional, para validar callbacks).
- `conversations`: adicionar `provider` (texto), `remote_jid` (texto), índice por `(tenant_id, remote_jid)`.
- `messages`: adicionar `direction` (`inbound`/`outbound`) derivado de `sender`, `wamid` (id da Evolution), `status` (`sent`/`delivered`/`read`/`failed`). Mantenho `sender`/`conteudo` para não quebrar a UI existente.
- Habilitar Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE messages, conversations;`

### Edge functions
- `evolution-connect` (POST): salva config em `zapi_connections`, chama `GET {instance_url}/instance/connect/{instanceName}` com header `apikey`, retorna `qrcode.base64` para a UI exibir.
- `evolution-status` (GET): chama `/instance/fetchInstances`, devolve `state` (`open`/`close`/`connecting`) e atualiza `status` no banco.
- `evolution-send` (POST): recebe `{conversation_id, body}`, busca config do tenant, chama `POST /message/sendText/{instance}` com `{number, text}`, insere em `messages` (`direction='outbound'`, `sender='usuario'`, `wamid` da resposta), atualiza `ultima_mensagem`/`ultima_interacao` na `conversations`.
- `whatsapp-webhook` (POST público, `verify_jwt=false`): recebe evento `messages.upsert` da Evolution. Extrai `remoteJid`, `pushName`, `message.conversation` ou `extendedTextMessage.text`. Resolve tenant via `instance` no payload → `zapi_connections.instance_name`. Faz upsert em `conversations` por `(tenant_id, remote_jid)`, insere mensagem `direction='inbound'` (`sender='cliente'`), incrementa `nao_lidas`. Idempotente por `wamid`.

### UI — `src/pages/admin/WhatsAppChat.tsx`
A página já existe com layout de 2 colunas. Refinar:
- Coluna esquerda 300px: busca por nome/número, lista ordenada por `ultima_interacao desc`, badge `nao_lidas`, prévia da `ultima_mensagem`, timestamp.
- Janela de chat: bolhas — outbound (direita, fundo `#c9a84c` accent, texto escuro), inbound (esquerda, fundo `#0d1426`). Input fixo no rodapé chamando `evolution-send`.
- Realtime subscription em `messages` filtrada pela `conversation_id` ativa; lista de conversas re-sorteia ao chegar nova mensagem.
- Ao abrir conversa: zerar `nao_lidas`, marcar `lida=true`.

### UI — Configuração (nova rota `/admin/whatsapp/config` ou aba dentro do WhatsAppChat)
- Form: URL base, API Key global, Nome da instância → salva em `zapi_connections` (provider=`evolution`).
- Botão **Conectar** → chama `evolution-connect`, exibe QR Code (img base64) com refresh a cada 30s até `status=open`.
- Indicador colorido de status (puxando `evolution-status` a cada 15s quando a aba está aberta).
- Bloco destacado **"Webhook URL"** com a URL completa da função `whatsapp-webhook` (montada a partir de `VITE_SUPABASE_URL`) + botão **Copiar** + instrução "Cole este webhook na sua instância Evolution em Settings → Webhooks, ativar evento `MESSAGES_UPSERT`".

---

## Parte 2 — KPIs Meta Ads com dados reais

### Diagnóstico
Os cards existem mas a função `facebook-campaigns-sync` salva por janela fixa (`days`) e os componentes leem do banco sem filtrar pelo seletor de período da UI.

### Mudanças
- `facebook-campaigns-sync`: aceitar `{since, until}` (YYYY-MM-DD) no body, montar `time_range={'since','until'}` na URL de insights, e gravar `period_start/period_end` exatos em `campaign_spend`. Garantir os campos `spend, impressions, clicks, ctr, cpc, actions, cost_per_action_type, account_currency` no `fields`.
- Cálculo de leads: somar `actions[].value` onde `action_type in ('lead','onsite_conversion.lead_grouped','offsite_conversion.fb_pixel_lead')`.
- UI Dashboard / CampanhasPage: ao mudar o seletor de período, disparar `facebook-campaigns-sync` com as datas e refazer queries em `campaign_spend` filtrando por `period_start>=since AND period_end<=until`.
- Período padrão: últimos 30 dias.
- Card de campanha: adicionar badge **AO VIVO** quando `status=ACTIVE` (campo `effective_status` da Graph API, salvo em coluna nova `campaign_status` em `campaign_spend`).

### KPIs derivados (CRM)
- Receita = `SUM(valor_proposta)` em `leads` onde `status='fechado'` e `fechado_em` no período. (`leads` não tem coluna `valor` genérica — uso `valor_proposta`. Se preferir outro campo me avise.)
- CAC = Investido / nº de leads `status='fechado'` no período.
- ROI = (Receita − Investido) / Investido × 100.
- Ticket Médio, Tx Qualificação (`mql=true`), Tx Conversão (`fechado/total`) — todos derivados de `leads` no período.

---

## Parte 3 — Sync automático de leads Meta

### Migration
Mapear para colunas existentes em `leads`:
- `facebook_lead_id` já existe e é único (vou adicionar `UNIQUE` se faltar) → equivale ao `meta_lead_id`.
- `facebook_form_id`, `facebook_campaign` já existem.
- Adicionar `facebook_ad_id`, `facebook_adset_id` (faltam).

### Edge function `sync-meta-leads`
- Lê `facebook_webhook_config` (ad_account_id, page_access_token).
- Pagina `GET /act_{adAccountId}/leads?fields=id,created_time,field_data,form_id,ad_id,adset_id,campaign_id&limit=100` seguindo `paging.next`.
- Para cada lead: skip se `facebook_lead_id` já existe; senão insere em `leads` com `origem='facebook_ads'` e em `conversations` (upsert por `(tenant_id, remote_jid)` onde `remote_jid` = phone+`@s.whatsapp.net`) para aparecer no inbox.
- `default_tenant_id` da `facebook_webhook_config` define o tenant.

### Agendamento (pg_cron)
- Cron `*/15 * * * *` chamando `sync-meta-leads` via `net.http_post` com `Authorization: Bearer SERVICE_ROLE`. (Segue o padrão já usado no projeto — ativar `pg_cron` e `pg_net` se ainda não estiverem.)

### Landing page externa
Edge function `landing-lead-webhook` já recebe leads de site externo (se não existir, crio). Ao inserir em `leads`, fazer upsert em `conversations` para o telefone aparecer no inbox imediatamente.

---

## Confirmações antes de implementar
1. **Schema**: ok adaptar a `tenants`/`conversations`/`messages`/`zapi_connections` existentes (recomendado) ou prefere tabelas novas `whatsapp_config`/`contacts`/`messages` em paralelo?
2. **Receita**: usar `valor_proposta` como base do faturamento fechado, ou existe outro campo/tabela (`sales`?) que devo somar?
3. **Tenant da Evolution**: uma instância por tenant (admin de cada clínica configura a dele) ou uma instância global Posion?
