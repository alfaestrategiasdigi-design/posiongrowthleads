## Análise: conformidade com o guia oficial Meta Webhooks for Leadgen

Comparei o guia que você colou com a implementação atual do projeto. Resumo do que **já está correto** e do que **precisa ser ajustado**.

---

### ✅ O que já está conforme o guia

| Requisito Meta | Status no projeto | Onde |
|---|---|---|
| Endpoint público de Webhook (GET challenge + POST eventos) | OK | `facebook-leads-webhook/index.ts` |
| Verify Token (hub.verify_token) | OK | comparação contra `facebook_webhook_config.verify_token` |
| Validação HMAC `x-hub-signature-256` com App Secret | OK | `verifyHubSignature()` |
| Buscar lead na Graph API via `leadgen_id` | OK | `fetchLeadFromGraph()` v21.0 |
| Page Access Token armazenado no banco | OK | `facebook_webhook_config.page_access_token` |
| Subscribe automático do app à Página no campo `leadgen` | OK | `facebook-oauth-save-page` chama `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` |
| Persistência do lead + dedupe por `facebook_lead_id` | OK | `insertLead()` |
| Escopos OAuth | Parcial — já solicita `leads_retrieval`, `pages_show_list`, `pages_manage_metadata`, `pages_read_engagement`, `ads_read`, `ads_management`, `business_management` |

---

### ⚠️ Lacunas frente ao guia (o que falta ou precisa de hardening)

**1. Verificação se o app está realmente inscrito na Página**
O guia recomenda um `GET /{page-id}/subscribed_apps` para confirmar a inscrição. Hoje fazemos o POST no `save-page` mas não temos UI que mostre se a inscrição continua ativa (a Meta pode revogar silenciosamente). Falta:
- Botão "Verificar inscrição da Página" em `/admin/facebook` que chama `GET /{page-id}/subscribed_apps` e mostra o resultado.
- Botão "Reinscrever" que refaz o POST se o app sumiu da lista.

**2. Validação das 5 permissões exigidas pelo guia**
Hoje só validamos `ads_read`. O guia exige confirmar também `leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_management`. Falta:
- Estender `facebook-campaigns-sync` (modo `check_permissions`) ou criar `facebook-permissions-check` que retorne o status de **todas** as 5 permissões + `ads_read`.
- UI em `/admin/facebook` com check-list verde/vermelho por permissão.

**3. Diagnóstico do ciclo completo do webhook**
O guia mostra que cada evento traz `leadgen_id, page_id, form_id, ad_id, created_time`. Hoje logamos via `console.log` mas não há tabela de auditoria. Útil ter:
- Tabela `facebook_webhook_events` (raw payload, signature_ok, leadgen_id, processed_at, lead_id resultante, error).
- Painel "Últimos eventos recebidos" em `/admin/facebook` mostrando os 50 mais recentes — facilita debug quando a Meta envia mas o lead não aparece.

**4. Page token longevidade**
Tokens de Página derivados de long-lived user token normalmente não expiram, mas o guia recomenda monitorar. Hoje gravamos `token_expires_at = now + 60d` artificialmente. Melhor:
- Chamar `GET /debug_token` periodicamente e gravar o `expires_at` real.
- Endpoint `facebook-token-debug` + indicador na UI.

**5. Reentrega / retries**
A Meta reenvia eventos por até 36h se receber não-2xx. Hoje retornamos 200 mesmo quando `insertLead` falha (resposta `{ received, results }`). Isso é correto para evitar tempestade de retry, mas perdemos eventos com erro. Falta:
- Salvar todo evento bruto (item 3) antes de processar, para que erros possam ser reprocessados manualmente via `facebook-backfill-leads`.

---

### Plano de implementação proposto

**Fase 1 — Auditoria visível (alta prioridade)**
1. Migration: criar `facebook_webhook_events` (raw_body jsonb, signature_valid bool, leadgen_id text, form_id text, page_id text, processed bool, lead_id uuid null, error text, received_at). GRANTs + RLS admin-only.
2. Editar `facebook-leads-webhook/index.ts` para inserir 1 linha por `change` antes de processar, e atualizar com `lead_id`/`error` depois.
3. Nova Edge Function `facebook-permissions-check` — retorna status das 6 permissões (`leads_retrieval`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement`, `ads_management`, `ads_read`).
4. Nova Edge Function `facebook-page-subscription-check` — chama `GET /{page-id}/subscribed_apps`, retorna se nosso app está na lista; ação "Reinscrever" disponível.

**Fase 2 — UI em `/admin/facebook`**
5. Bloco "5. Permissões da Página" com checklist verde/vermelho das 6 permissões + botão Revalidar.
6. Bloco "6. Inscrição da Página" mostrando se nosso app está em `subscribed_apps`, com botão Reinscrever.
7. Bloco "7. Últimos eventos do Webhook" — tabela com os 50 eventos mais recentes da nova tabela (status, leadgen_id, lead resultante, erro).

**Fase 3 — Robustez do token (opcional, pode ficar para depois)**
8. Edge Function `facebook-token-debug` chamando `GET /debug_token` e atualizando `token_expires_at` real.

---

### Detalhes técnicos

- **Schema novo**: `facebook_webhook_events` com índice em `received_at desc` e `leadgen_id`.
- **Edge functions novas**: `facebook-permissions-check`, `facebook-page-subscription-check`, `facebook-token-debug` (Fase 3).
- **Edge function alterada**: `facebook-leads-webhook` (passa a gravar evento bruto antes de processar; mantém retorno 200 sempre).
- **Frontend alterado**: `src/pages/admin/FacebookConfigPage.tsx` (3 blocos novos).
- **Sem mudança de escopos OAuth** — todos os 6 já estão sendo solicitados em `facebook-oauth-exchange`.

---

### Pergunta para você

Quer que eu execute o plano completo (Fases 1+2+3) ou só **Fase 1+2** (auditoria + UI), deixando o monitoramento de token para depois?
