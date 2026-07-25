## Problema

Toda vez que o resubscribe roda, o webhook do DRMATHEUS (e potencialmente de outras instâncias) volta em um estado quebrado:
- às vezes com `webhookByEvents: true` (URL vira `/whatsapp-webhook/messages-upsert` etc., que a `whatsapp-webhook` rejeita como 404/wrong_path);
- às vezes com eventos "a mais" ligados (CHATS_DELETE/UPDATE/UPSERT, CONTACTS_UPSERT etc., como no print), gerando ruído sem MESSAGES_UPSERT confiável;
- às vezes com `?secret=` ausente ou trocado, fazendo o webhook responder 401.

Hoje o `evolution-resubscribe` só chama `POST /webhook/set` e confia no `200 OK` — nunca lê de volta o estado real, então uma variante aceita mas ignorada silenciosamente passa como "ok" e a instância continua quebrada.

## Objetivo

Fazer com que **toda** conexão validada pelo resubscribe termine em um estado provadamente correto:
1. URL exatamente `…/whatsapp-webhook?tenant=<slug>&secret=<webhook_secret do DB>`
2. `webhookByEvents: false` (uma URL única, sem sufixo de evento)
3. Lista de eventos = exatamente a lista canônica (nem faltando obrigatórios, nem sobrando os que não tratamos)
4. Se algo divergir após o `set`, corrigir automaticamente até bater — e só então marcar `ok: true` no DB.

## Mudanças

### 1. `supabase/functions/_shared/evolution-webhook.ts`
- Definir uma única `CANONICAL_EVENTS` (a lista atual de `EVOLUTION_EVENTS`) como fonte da verdade.
- Adicionar `verifyWebhookState(base, apiKey, instance, expected)` que:
  - chama `GET /webhook/find/<instance>`;
  - retorna `{ ok, url, webhookByEvents, events, extras, missing, reasons[] }` comparando com o esperado (URL exata via `validateWebhookUrl`, `webhookByEvents === false`, set de eventos idêntico à canônica — `extras` = ligados a mais, `missing` = obrigatórios faltando).
- Refatorar `configureWebhook` para, após qualquer variante aceitar, chamar `verifyWebhookState`; se o estado não bater:
  - repetir o `POST /webhook/set` forçando `webhookByEvents: false`, `byEvents: false`, `webhook_by_events: false`, `events: CANONICAL_EVENTS`;
  - até 3 tentativas totais antes de retornar `ok: false` com `reasons` detalhado.
- Passar a devolver `{ ok, verified, debug }` para o caller usar direto.

### 2. `supabase/functions/evolution-resubscribe/index.ts`
- Remover a lista `EVENTS` e o loop de attempts duplicado; usar `configureWebhook` + `verifyWebhookState` do shared.
- Só gravar `webhook_url` e considerar a instância "ok" se `verified.ok === true`.
- No response, incluir por conexão: `url_final`, `webhookByEvents`, `events_extras`, `events_missing`, `reasons[]`.
- Manter os `settings/set` bons (alwaysOnline, readMessages, syncFullHistory) sem reverter.

### 3. `supabase/functions/evolution-webhook-audit/index.ts`
- Usar o mesmo `verifyWebhookState` para diagnosticar; quando detectar `extras`/`missing`/`webhookByEvents:true`/URL inválida, disparar auto-heal chamando `configureWebhook` já do shared (não replicar lógica).
- Continuar rodando no cron diário 06:00 BRT em todos os tenants.

### 4. `TenantConfig.tsx` (painel WhatsApp)
- Após clicar "Reassinar", exibir o resultado retornado (verified ok/reasons), com badge verde "Webhook validado" ou vermelho listando o que ainda está errado. Sem mudar layout — só usar o payload novo.

## Não faz parte deste plano

- Reconectar/repair da sessão do WhatsApp (isso é fluxo separado do `evolution-reconnect`).
- Alterar a lista canônica de eventos (fica igual à de hoje).
- Mudanças de UI/UX além do bloco de resultado do reassinar.

## Como validar

1. Executar `evolution-resubscribe` para o DRMATHEUS → resposta deve trazer `verified.ok: true` e `webhookByEvents: false`.
2. No painel Evolution, os eventos ligados devem bater 1‑a‑1 com a lista canônica (nada a mais).
3. Enviar uma mensagem inbound real → aparece no chat sem 401/404 no log da `whatsapp-webhook`.
4. Rodar o audit para os demais tenants — deve normalizar todos automaticamente.
