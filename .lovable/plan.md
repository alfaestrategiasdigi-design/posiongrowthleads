## Diagnóstico (read-only) — outbound WhatsApp não entra na conversa

### 1. Como o webhook trata OUTBOUND (`fromMe=true` / `SEND_MESSAGE`)

Fluxo em `supabase/functions/whatsapp-webhook/index.ts` (loop `messages.upsert`/`messages.set`/`SEND_MESSAGE`, linhas ~960–1330):

1. `resolveRemoteJid(..., fromMe=true, ownJids)` (linha 504) tenta achar o **destinatário**:
   - `sameKey` (LID+phone na mesma key) → devolve phone canônico. ✅
   - Se não, roda `collectOutboundPeerCandidates` (participantAlt, senderPn, recipient, to, chatId, participantPn…) + `remoteJid` (só se não for own).
   - `firstStandardJid` procura JID `@s.whatsapp.net`; se não achar, cai em `firstLidJid`.
   - Se só houver LID → devolve `unresolvedLid:true`, `remoteJid=null`.
   - Se `remoteJid` bruto for o próprio dono (`rawIsOwn`) → `blockedSelfJid:true`.
2. No handler (linhas 986–1000) há um fallback extra: quando `resolved.remoteJid` é null e `fromMe`, tenta `key.senderPn / participantAlt / remoteJidAlt`. Se falhar, cai o `no_jid_dropped` e a mensagem é descartada.
3. Se sobrar só `@lid`, mantém como **provisório** (log `outbound_lid_kept_provisional`, linha 1029) — não descarta mais, cria conversa nova com `remote_jid=<lid>@lid`, `telefone=<digitos do lid>`, `nome_contato=null`.
4. Grava a message com `direction='outbound'`, `sender='usuario'`, `status='sent'`. Nenhum `metadata.origin='device'` é escrito (contrário ao que a auditoria em `docs/WHATSAPP_AUDIT.md` sugere — `device_24h=0` sempre).

### 2. `outbound_unresolved_lid_dropped_no_conv`

Grep no repo: **não existe mais** essa string. Foi removida na correção anterior (2026-07-16). O log atual equivalente é:
- `no_jid_dropped` (linha 998) — só quando nem alt/senderPn resolve.
- `outbound_lid_kept_provisional` (linha 1030) — caminho "salvo".

Nos logs recentes de `whatsapp-webhook` (últimas horas) aparecem **dezenas** de `outbound_lid_kept_provisional` para o `remoteJid` `190340199895239@lid` (instância DRMATHEUS) — nenhum `no_jid_dropped`. Ou seja, a mensagem enviada do celular **está sendo gravada**, mas em conversa provisória `@lid` separada, não na conversa canônica do contato.

### 3. Por que abre "não identificado" separado

O matching `findConversation` (linha 561) procura por `remote_jid` **exato** ou `telefone` **exato**. Para outbound `@lid`:

- `remote_jid` da conversa canônica = `5577999...@s.whatsapp.net`, `telefone = 5577999...`.
- `remote_jid` do payload outbound = `190340199895239@lid`, `telefone` derivado = `190340199895239` (dígitos do LID).
- Não bate por JID nem por telefone → cria conversa nova provisória sem nome.

**Por que o inbound do mesmo contato entra certo e o outbound não?**
- Inbound geralmente traz `senderPn`/`participantPn` com o telefone real na mesma key → `sameKey` ou `firstStandardJid` resolvem para `@s.whatsapp.net`.
- No SEND_MESSAGE / echo outbound emitido pelo celular, Baileys frequentemente **não** popula `senderPn` do destinatário; a única coisa disponível é o `remoteJid=<lid>@lid`. O `sameKey` na linha 522 tem ainda um guard `!(fromMe && ownJids.has(sameKey.phoneJid))` que faz o resolver descartar o pareamento sempre que o "phone" da key coincide com o dono da instância — impedindo aliasing legítimo em vários echoes.
- Resultado: outbound cai no ramo LID e vira conversa nova. `mergeProvisionalLidConversations` só migra depois que um alias `lid→phone` for descoberto — mas como não há inbound novo para aquele contato trazendo os dois na mesma key, o alias nunca chega e as duas conversas coexistem.

Confirmação no banco: 21 conversas `@lid` criadas nas últimas 48h em 3 tenants (Roar, Gabriel, Fio). Todas com `mapped_phone = null` (sem alias em `whatsapp_jid_aliases`). Várias têm `out_count > 0, in_count = 0` — exatamente o padrão "só enviei do celular, virou chat novo sem nome".

### 4. `SEND_MESSAGE` inscrito e `direction`

- `_shared/evolution-webhook.ts` já inclui `SEND_MESSAGE` na lista obrigatória e o audit força reassinatura. Os logs mostram eventos `messages.set fromMe:true` chegando 200 OK.
- `direction='outbound'` é gravado corretamente (verificado no banco: 67 outbound nas últimas 24h). Não é problema de gravação; é de **roteamento** para a conversa errada.

### 5. Causa concreta e correção mínima (a implementar depois)

Causa raiz única: **quando o outbound chega apenas com `@lid` do destinatário, o webhook cria uma nova conversa provisória em vez de anexar à conversa canônica existente do mesmo contato.** Nenhum caminho no código atual olha para `messages.wamid` já enviado pelo painel/celular, nem consulta a Evolution/API para resolver `lid→phone` on-demand no momento do echo.

Correção mínima proposta (a validar):

a) **Casar por `wamid` primeiro.** Antes de `findConversation`, se o payload é `fromMe` e o `wamid` já existe em `messages`, usar a `conversation_id` daquela linha e só atualizar `status`/`wamid` — nunca criar conversa nova. Isso resolve 100% dos echoes de mensagens enviadas pelo painel (`evolution-send` grava wamid antes) e todos os casos em que o mesmo wamid aparece em múltiplos eventos.

b) **Resolver LID sob demanda para outbound.** Quando `fromMe && isPendingLid && !conv`, chamar o mesmo utilitário do `whatsapp-lid-reconcile` (Evolution `/chat/whatsappNumbers` ou `/chat/findContact`) para tentar mapear `lid→phone` antes de criar conversa. Se resolver, gravar alias e usar canônica; se não, aí sim manter provisória.

c) **Merge automático mais agressivo.** Rodar `mergeProvisionalLidConversations` para o `lid` específico assim que a conversa provisória outbound é criada, e novamente quando qualquer inbound daquele lid chegar — hoje só roda no cron 15min.

d) **Relaxar o guard do `sameKey`** (linha 522): o `!(fromMe && ownJids.has(sameKey.phoneJid))` foi pensado contra self-echo mas está bloqueando pareamento legítimo em echoes de destinatários cujo LID/phone vêm juntos. Aceitar `sameKey` sempre que o phone **não** for own; a proteção contra ownJid já existe em `firstStandardJid`.

Nenhum outro subsistema (dashboard, agendamento, formulários, automações) precisa mudar.

### Aguardando aprovação
Confirmo a análise antes de implementar? Alguma preferência entre (a)+(b) mínimo vs. pacote completo (a)+(b)+(c)+(d)?
