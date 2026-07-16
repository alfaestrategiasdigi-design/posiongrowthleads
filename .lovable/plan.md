## Problema

As conversas marcadas como **"Contato não identificado"** têm `remote_jid = <id>@lid` — o novo identificador opaco (LID) do WhatsApp multi‑dispositivo. Quando o Evolution entrega um evento com esse formato, criamos uma conversa nova em vez de mesclar na canônica do contato (ex.: a do Dheimy). Isso não é específico do donna‑face: **acontece em todo tenant** que usa Evolution/Baileys — hoje há 12 conversas presas no donna‑face e 2 no escopo global do Master.

O `whatsapp-lid-reconcile` atual só cruza por telefone/JID canônico; sem o telefone real, ele desiste e marca `needs_lid_review=true`.

## Solução em 3 camadas

### 1. Extrair o telefone real do payload (webhook — prevenção)

No `supabase/functions/whatsapp-webhook/index.ts` (e no helper `_shared/evolution-webhook.ts`), quando o `remoteJid` chegar como `@lid`, tentar resolver o telefone real ANTES de criar/atualizar a conversa, procurando nesta ordem:

- `key.senderPn` / `key.participantPn` (Baileys ≥ 6.7)
- `message.contextInfo.participantPn`
- `participant` quando terminar em `@s.whatsapp.net`
- payloads de `contacts.upsert` / `contacts.update` correlatos (JID → phone map em memória por instância)
- consulta ao alias já existente em `whatsapp_jid_aliases` (`lid_jid = <id>@lid`)

Se resolver:

- Persistir o alias em `whatsapp_jid_aliases` (upsert).
- Usar o JID canônico `<phone>@s.whatsapp.net` para achar/criar a `conversations` (mesma lógica atual do path por telefone).
- Nunca criar a conversa `@lid`.

Se não resolver: manter o comportamento atual (cria @lid + `needs_lid_review=true`), mas com um segundo aliado (item 2).

### 2. Job de reconciliação enriquecido (retroativo)

Atualizar `supabase/functions/whatsapp-lid-reconcile/index.ts` para tentar resolver LIDs pendentes usando:

- Alias já registrado (`whatsapp_jid_aliases`) — resolução barata.
- **Correlação por conteúdo/tempo**: para cada conversa `@lid` com mensagens recentes, procurar em outras conversas do mesmo tenant, na mesma janela de ±2 min, uma mensagem com o mesmo `wamid` (chega em dois eventos com JIDs diferentes) ou mesmo texto/mídia. Score idêntico ao do `whatsapp-wamid-reconcile`. Se casar acima de um threshold, mesclar automaticamente (reaproveita `mergeInto` do `whatsapp-lid-merge`).
- **Correlação por `pushName**`: se a `@lid` tem `nome_contato` e existe uma única conversa canônica no tenant com `nome_contato` igual/parecido (trigram > 0.8), mesclar.

Rodar o job periodicamente (via `automation-scheduler` a cada 10 min) e também sob demanda no botão da página de Auditoria.

### 3. UI do WhatsApp — mesclar em 1 clique

Na página `src/pages/admin/WhatsAppChat.tsx`, no header da conversa com bandeira **"Possível mistura de mensagens"**, adicionar botão **"Mesclar com…"** que abre um seletor buscando conversas canônicas do tenant (por nome/telefone). Ao confirmar, chama `whatsapp-lid-merge` com `target_conversation_id`. Hoje isso já existe via `LidReviewDialog`, mas está pouco visível — vamos deixar a ação sempre acessível no header quando `needs_lid_review=true`.

Adicionar também na `WhatsAppAuditPage` um card **"Conversas @lid pendentes"** listando todas com contagem por tenant e botão para rodar o reconcile em massa (dry‑run + aplicar).

## Escopo e arquivos

**Edge Functions:**

- `supabase/functions/whatsapp-webhook/index.ts` — extrair phone do payload, gravar alias, rotear pré‑insert.
- `supabase/functions/_shared/evolution-webhook.ts` — helper `resolveLidToPhone(payload, admin, tenantId)`.
- `supabase/functions/whatsapp-lid-reconcile/index.ts` — estratégias por alias, wamid, conteúdo e nome.
- `supabase/functions/automation-scheduler/index.ts` — cron a cada 10 min chamando o reconcile.

**Frontend:**

- `src/pages/admin/WhatsAppChat.tsx` — botão "Mesclar com…" no header LID.
- `src/pages/admin/WhatsAppAuditPage.tsx` — card LID pendentes + ações em massa.
- `src/components/admin/whatsapp/LidReviewDialog.tsx` — reuso do seletor.

**Sem migrations novas** — `whatsapp_jid_aliases` já existe.

## Verificação

- Rodar reconcile em dry‑run e conferir quantas das 14 conversas @lid atuais casam.
- Enviar uma mensagem do celular físico para um contato e confirmar que a mensagem cai na conversa canônica (sem criar `@lid`).
- Recarregar `/app/donna-face/whatsapp` e ver que o "Contato não identificado ·1553" foi mesclado no Dheimy.

## Pergunta rápida antes de eu implementar

Quer que eu já **execute o reconcile agora** (após aplicar as melhorias) para limpar as 14 conversas presas, ou prefere revisar cada mesclagem manualmente pela nova UI de "Mesclar com…"?  
  
