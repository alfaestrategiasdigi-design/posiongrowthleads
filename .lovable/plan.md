# Teste E2E: outbound de outro dispositivo sem alias

## Objetivo

Congelar a correção do "chat paralelo" com um teste determinístico que cobre os 5 cenários pedidos, usando o mesmo framework já em uso (`Deno.test` em `supabase/functions/whatsapp-webhook/*_test.ts`), sem introduzir dependências novas e sem tocar a Evolution real.

## Estratégia

Dois níveis, ambos no mesmo arquivo de teste:

1. **Nível puro** (rápido, sem I/O) — exercita `routing.ts`, `_shared/phone-jid.ts` e `decideAliasFromSameKey` para provar as invariantes que vivem em código puro (cenários 1, 2, 5 em grande parte).
2. **Nível handler** — invoca o loop de processamento de `messages.upsert` do webhook com:
   - um **mock in-memory do client Supabase** (implementa apenas os métodos usados: `from().select/insert/update/upsert/delete/.eq/.or/.like/.limit/.maybeSingle/.single`) — mantém tabelas `conversations`, `messages`, `whatsapp_jid_aliases`, `whatsapp_connections`, `leads`, `facebook_webhook_events` em `Map`s.
   - um **fetcher da Evolution mockado** (função injetada) que devolve respostas controladas para `chat/findChats` / `contacts/find` etc.
   - payloads de webhook construídos à mão a partir de amostras reais (`fromMe:true`, `remoteJid:<lid>@lid`, sem alias, sem par no mesmo `key`).

Para viabilizar o nível handler **sem alterar comportamento de produção**, faço uma extração puramente estrutural em `whatsapp-webhook/index.ts`: mover o corpo do handler de `messages.upsert` para uma função exportada `export async function handleMessagesUpsert(deps, body)` onde `deps = { admin, evolutionLookup, ownJidsResolver, now }`. `Deno.serve` continua chamando essa função com as deps reais. Nenhuma regra de negócio muda; só o ponto de entrada fica testável. Se durante a implementação essa extração revelar risco, os cenários 3 e 4 caem para follow-up e ficam marcados como `Deno.test.ignore` com nota — os cenários 1, 2 e 5 continuam cobertos no nível puro.

## Arquivos

- **Novo**: `supabase/functions/whatsapp-webhook/outbound_integration_test.ts`
  - Helpers: `makeSupabaseMock()`, `makeEvolutionMock()`, `buildOutboundLidPayload({ instance, ownJid, lidJid, tenantId, text })`, `buildContactsUpdatePayload({ lidJid, phoneJid, tenantId })`.
  - Blocos `Deno.test` por cenário (ver abaixo).
- **Novo**: `supabase/functions/whatsapp-webhook/_test_utils/supabase-mock.ts` — implementação do mock (isolada para reuso futuro; sem dep externa).
- **Edit estrutural (sem mudar comportamento)**: `supabase/functions/whatsapp-webhook/index.ts` — extrair `handleMessagesUpsert(deps, body)` e `handleContactsUpsert(deps, body)`. `Deno.serve` passa a montar `deps` reais e delegar. Nenhum ajuste em validação, resolução de JID, políticas de alias, merge, needs_lid_review.

## Cenários cobertos

1. **Outbound sem alias** — payload `fromMe:true`, `remoteJid:"888777@lid"`, sem entradas em `whatsapp_jid_aliases`, sem `remoteJidAlt`/`senderPn`/`participantAlt`. Assert: exatamente 1 conversa criada, `remote_jid` termina em `@lid`, `needs_lid_review=true`, `tenant_id` correto. Assert negativo: **nenhuma** conversa com `remote_jid` casando `^\d{1,10}@s\.whatsapp\.net$` nem começando com `0`.
2. **Telefone truncado rejeitado** — três sub-testes com candidatos `"9740540"`, `"01807406"`, `"8812944955"` como único hint de peer. Assert: `normalizePhoneJid` devolve `null` para eles; ao rodar o handler, nenhuma conversa é criada com esses JIDs; se houver `@lid` disponível, cai em conversa provisória `@lid`; caso contrário, mensagem é descartada e log `alias_rejected_implausible_phone` / `implausible_phone_rejected` é emitido (capturado via `console.warn` stub).
3. **Renomeação posterior sem chat paralelo** — encadeia cenário 1 e depois dispara um `contacts.update` com `@lid + telefone válido` no mesmo objeto (same-key). Assert: `conversations.count` **antes = depois = 1**, `remote_jid` mudou de `@lid` para `<phone>@s.whatsapp.net`, `needs_lid_review=false`, mensagens preservadas (mesmo `conversation_id`), nenhum duplicado.
4. **Isolamento entre tenants** — dois tenants (A e B) com instâncias separadas processam o mesmo `lidJid` (colisão intencional de ID opaco). Assert: cada conversa fica no seu `tenant_id`, nenhuma linha com `tenant_id=null`, query `select where tenant_id=A` não retorna a de B.
5. **Anti-merge por pushName** — dois payloads `@lid` distintos com **mesmo `pushName="Lucas"`**, sem par same-key. Assert: duas conversas provisórias distintas, nenhuma entrada nova em `whatsapp_jid_aliases`, `decideAliasFromSameKey` recusa (`ok:false`), `needs_lid_review` marcado mas sem merge automático (protege o incidente de 05/07).

## Salvaguardas do próprio teste

- Sem `--allow-net` real: mock Supabase e mock Evolution vivem em memória.
- Sem dependência nova em `deno.json` (usa `https://deno.land/std@0.224.0/assert/mod.ts` como os testes atuais).
- Determinístico: `now` injetado, IDs gerados por contador.
- Se qualquer assert falhar, o teste **falha** — não ajusto código de produção para verdejar.

## Execução

- Ferramenta interna: `supabase--test_edge_functions` com `{ "functions": ["whatsapp-webhook"] }`.
- Local (equivalente ao que a ferramenta roda):
  ```
  deno test --allow-env --allow-net supabase/functions/whatsapp-webhook/
  ```

## Entrega no fim

Reporto: arquivos criados/alterados, saída do runner (passou/falhou por `Deno.test`), e — se algum cenário falhar — descrevo a falha sem mexer na lógica de produção.
