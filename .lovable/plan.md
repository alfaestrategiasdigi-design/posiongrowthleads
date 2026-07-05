
# Plano: Correção da sincronização de mensagens WhatsApp (Evolution API)

## Objetivo
Eliminar os 3 pontos de descarte silencioso no `whatsapp-webhook` que fazem mensagens enviadas pelo celular sumirem no painel, sem quebrar a deduplicação já existente.

---

## Etapa 1 — Diagnóstico (leitura, sem alteração)

1. Puxar logs da função `whatsapp-webhook` (últimos 7 dias) via `supabase--edge_function_logs` filtrando por:
   - `unresolved_lid_dropped`
   - `unknown_instance`
2. Agrupar ocorrências por `instance_name` / tenant (parse do payload dos logs) para identificar clínicas afetadas.
3. Listar `zapi_connections` ativas (`provider='evolution'`) via `supabase--read_query`.
4. Para cada instância ativa, chamar `GET {instance_url}/webhook/find/{instance_name}` (com header `apikey`) e verificar se `MESSAGES_UPSERT` e `SEND_MESSAGE` estão inscritos. Essa varredura será feita por uma nova edge function utilitária `evolution-webhook-audit` (invocada uma vez, resultado logado e retornado como JSON).

## Etapa 2 — Correções em `supabase/functions/whatsapp-webhook/index.ts`

### 2.1 `unknown_instance` (≈ linhas 190-216)
Mudar de "descarta se `instance_name` não bate em `zapi_connections`" para:
- Resolver conexão primeiro por `instance_name`.
- Se falhar, tentar resolver pelo `tenant` da URL (`?tenant=<slug>` ou `?tenant_id=<uuid>`) e pegar a conexão daquele tenant.
- Só descartar (`unknown_instance`) se **ambos** falharem.
- Quando resolver pelo tenant, atualizar `zapi_connections.instance_name` para o valor recebido (auto-heal), logando `instance_name_updated`.

### 2.2 `unresolved_lid_dropped` (≈ linhas 342-345)
- Remover o `continue` do bloco `if (!remoteJid || unresolvedLid)`.
- Novo comportamento:
  - Se `remoteJid` estiver ausente → continuar `continue` (sem JID não há como criar conversa).
  - Se `remoteJid` for `<id>@lid` sem alias resolvido → **manter** o `@lid` bruto como `remote_jid` provisório e prosseguir com criação/lookup de conversa por esse JID. Marcar a mensagem com `metadata.pending_lid_resolution = true` (coluna JSONB `metadata` em `messages` — adicionar migration se não existir).
- Adicionar handler pós-inserção: sempre que `whatsapp_jid_aliases` receber um novo mapeamento `lid → s.whatsapp.net` (via `contacts.update`/`upsert` no próprio webhook), rodar um `UPDATE` em `conversations` e `messages` trocando o `remote_jid` antigo pelo canônico e mesclando conversas duplicadas (a antiga `@lid` recebe `merged_into_id`, mensagens são reapontadas para a canônica).

### 2.3 Reforçar inscrição de eventos
Extrair a lista `EVENTS` e a função `configureWebhook` (hoje em `evolution-connect` e `evolution-resubscribe`) para um módulo compartilhado `supabase/functions/_shared/evolution-webhook.ts`. A nova função `evolution-webhook-audit` (Etapa 1.4):
- Para cada `zapi_connection` ativa, chama `GET /webhook/find/<instance>`.
- Se `MESSAGES_UPSERT` ou `SEND_MESSAGE` faltarem, chama `configureWebhook` compartilhada com a lista completa.
- Retorna JSON com `{instance, missing_before, fixed, ok}`.

### 2.4 O que NÃO mudar
- Dedup por `wamid` (linhas ~501-505).
- Dedup por janela de 15s para `fromMe && text` (linhas ~506-522).

## Etapa 3 — Migration
Nova migration:
- `ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;` (se ainda não existir — confirmar com `read_query` antes).
- Índice parcial `CREATE INDEX IF NOT EXISTS idx_messages_pending_lid ON public.messages ((metadata->>'pending_lid_resolution')) WHERE metadata->>'pending_lid_resolution' = 'true';`

## Etapa 4 — Validação
1. Redeploy de `whatsapp-webhook`, `evolution-connect`, `evolution-resubscribe`, `evolution-webhook-audit`.
2. Executar `evolution-webhook-audit` e anexar output ao relatório.
3. Re-puxar logs por 10 min e confirmar ausência de novos `unresolved_lid_dropped` / `unknown_instance`.

## Etapa 5 — Cenários de teste manual (documentados no relatório)
- **unknown_instance**: renomear temporariamente `zapi_connections.instance_name` de um tenant e enviar uma mensagem — antes: descartada; depois: resolvida via `?tenant=` e `instance_name` auto-atualizado.
- **unresolved_lid_dropped**: enviar mensagem do celular para contato novo cujo JID chega como `@lid` sem alias — antes: sumia; depois: aparece no painel como conversa `@lid` provisória e é mesclada quando o alias resolver.
- **webhook incompleto**: via API Evolution, `POST /webhook/set` removendo `MESSAGES_UPSERT`. Rodar `evolution-webhook-audit` — deve detectar e reinscrever.

## Relatório final
Após execução, entregar em uma única mensagem:
- Causa raiz por tenant (contagem de logs + auditoria de webhooks).
- Diff resumido das 3 correções (arquivo + linhas).
- Output do `evolution-webhook-audit` pós-correção.
- Passo-a-passo dos 3 cenários de teste manual.

---

## Arquivos afetados
- `supabase/functions/whatsapp-webhook/index.ts` (edições nas 3 zonas)
- `supabase/functions/_shared/evolution-webhook.ts` (novo — EVENTS + configureWebhook)
- `supabase/functions/evolution-connect/index.ts` (passa a importar do shared)
- `supabase/functions/evolution-resubscribe/index.ts` (passa a importar do shared)
- `supabase/functions/evolution-webhook-audit/index.ts` (novo)
- Nova migration para coluna `metadata` + índice em `messages`
