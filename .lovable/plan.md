# Objetivo

Eliminar totalmente a UI de "Mesclar com contato…" / "Revisão de conversas @lid" e resolver o mapeamento `@lid → telefone real` de forma **100% automática**, sem depender de nome do lead ou revisão humana.

## Diagnóstico

Hoje, quando o WhatsApp entrega uma mensagem com `remoteJid=<id>@lid` e o payload **não** traz `senderPn`/`participantPn` no mesmo `key` (típico de campanhas em massa e broadcasts), o webhook cria uma conversa provisória `@lid` e marca `needs_lid_review=true`. A reconciliação por `pushName` foi propositalmente desabilitada (causou merges errados em 2026-07-05), então essas conversas ficam órfãs até alguém clicar "Mesclar com contato…". O usuário não quer mais esse fluxo manual.

A Evolution API (v2) já mantém internamente o mapeamento LID↔phone via `contacts.upsert` do Baileys. Podemos **consultar ativamente** esse cache em vez de esperar o evento chegar no webhook.

## Solução

### 1. Resolver `@lid` via Evolution API (fonte autoritativa)

Enriquecer `supabase/functions/whatsapp-lid-reconcile/index.ts` com uma nova etapa **antes** das heurísticas existentes:

- Para cada `whatsapp_connections` ativa (com `instance_url` + `api_key` + `instance_name`), chamar:
  - `GET {instance_url}/chat/findContacts/{instance}` — retorna a lista completa de contatos que o Baileys já viu, incluindo campos `id` (JID canônico `<phone>@s.whatsapp.net`), `lid` (`<n>@lid`) e `pushName`.
- Percorrer o resultado e, para cada par `(lid, phone)` presente no **mesmo objeto de contato**, gravar em `whatsapp_jid_aliases` via `upsertJidAlias(..., source="evolution_contacts_api")` — mesma rota segura já usada para eventos `contacts.upsert`.
- Após popular aliases, executar `mergeProvisionalLidConversations(tenantId, lid, phone)` para cada par, dobrando as conversas `@lid` na conversa canônica automaticamente.

Esse passo elimina a necessidade de correlação por `pushName` ou por nome do lead — usamos apenas o pareamento autoritativo que a própria WhatsApp Web entrega ao Baileys.

### 2. Fallback: descartar conversas `@lid` órfãs sem ruído

Se, depois da consulta à Evolution API + heurística de `wamid`, a conversa `@lid` continuar sem candidato canônico **e** não tiver recebido nenhuma mensagem nas últimas 48 h, marcar automaticamente `arquivada=true` e limpar `needs_lid_review`. Elas somem da UI sem exigir ação — sem banner, sem diálogo. Se voltarem a receber mensagem, a reconciliação roda de novo.

### 3. Agendamento automático

Adicionar `whatsapp-lid-reconcile` ao `automation-scheduler` (executar a cada 15 min, além de já rodar sob demanda depois de webhooks). Como agora ela chama a Evolution API, cada rodada aproveita o cache mais recente do Baileys sem precisar de eventos vindo do WhatsApp.

### 4. Remover toda a UI de revisão manual

Editar `src/pages/admin/WhatsAppChat.tsx`:
- Remover `import { LidReviewDialog }`, `lidReviewOpen`, `lidPendingCount`, o botão "Revisão @lid" no header e o componente `<LidReviewDialog>` no fim do arquivo.
- Remover o banner amarelo "Possível mistura de mensagens de outro contato" e o botão "Mesclar com contato…" (linhas ~1169-1186).
- Manter apenas o selo "NÃO IDENTIFICADO" (para as raras conversas que ainda estejam `@lid` no intervalo entre webhook e reconciliação); ele desaparece sozinho assim que o job resolve.

Editar `src/pages/admin/WhatsAppAuditPage.tsx`:
- Remover o card "Conversas @lid pendentes" e qualquer chamada explícita ao reconcile.

Excluir `src/components/admin/whatsapp/LidReviewDialog.tsx` (arquivo inteiro) — deixa de ser referenciado.

## Detalhes técnicos

- **Endpoint Evolution**: `GET /chat/findContacts/{instance}` com header `apikey: <api_key>` retorna JSON `[{ id, lid, pushName, ... }]`. Já usamos o mesmo padrão de autenticação em `fetchInstanceOwnJids` (linha 290 de `whatsapp-webhook/index.ts`).
- **Segurança do alias**: continuamos usando `upsertJidAlias`, que exige `lidJid` e `phoneJid` presentes no **mesmo objeto** — reforça a proteção contra o bug de 2026-07-05.
- **Idempotência**: `whatsapp_jid_aliases` já tem `unique(tenant_scope, lid_jid)`, então re-execuções não duplicam.
- **Tabelas afetadas**: nenhuma migração necessária. Só usamos colunas existentes (`needs_lid_review`, `arquivada`, `whatsapp_jid_aliases`).
- **Compatibilidade**: o webhook continua criando conversas `@lid` quando o pareamento não vem no `key` — a diferença é que agora elas são resolvidas pelo job dentro de ≤15 min sem intervenção humana.

## Passos de implementação

1. `supabase/functions/whatsapp-lid-reconcile/index.ts`
   - Adicionar `resolveViaEvolutionApi(admin)` que itera `whatsapp_connections` ativas, chama `/chat/findContacts/{instance}`, salva aliases e dobra conversas.
   - Adicionar `archiveStaleLidConversations(admin)` que arquiva `@lid` sem atividade há 48 h.
   - Executar essas duas etapas **antes** do bloco atual de correlação por `wamid`/`pushName`; remover o branch de `pushName` (agora obsoleto).
2. `supabase/functions/automation-scheduler/index.ts` (verificar caminho exato) — enfileirar `whatsapp-lid-reconcile` a cada 15 min.
3. Remover UI: `WhatsAppChat.tsx`, `WhatsAppAuditPage.tsx`, deletar `LidReviewDialog.tsx`.
4. Rodar o reconcile uma vez manualmente após deploy para limpar as 11 conversas pendentes atuais.

## Fora do escopo

- Não vamos mexer no fluxo do webhook: ele continua criando aliases quando o payload traz par `@lid`+phone no mesmo `key`/`contacts.*`.
- Não vamos matar conversas `@lid` que **ainda estão ativas** (mensagem recente) — só arquivamos as verdadeiramente órfãs.
