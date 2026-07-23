## Diagnóstico READ-ONLY — outbound de outro dispositivo

Nenhum arquivo, função ou dado foi alterado.

### Conclusão executiva

A causa concreta é a resolução incorreta de `@lid` para um suposto telefone.

Nos casos informados, o webhook recebeu identificadores LID completos e válidos:

- `82004364259387@lid`
- `217312561000489@lid`

Porém, a tabela de aliases contém estes mapeamentos incorretos no tenant Donna Face:

- `82004364259387@lid` → `8812944955@s.whatsapp.net`
- `217312561000489@lid` → `01807406@s.whatsapp.net`

As mensagens armazenadas preservam em `metadata.raw_key.remoteJid` os LIDs completos acima. Portanto, **o webhook não está cortando o `remoteJid` bruto**, nem usando parte do `wamid`. Os valores `8812944955` e `01807406` vêm do `phone_jid` já resolvido/persistido como alias e depois usado como se fosse um telefone real.

## 1. Caminho de outbound vindo de outro dispositivo

O handler aceita `MESSAGES_UPSERT`, `MESSAGES_SET` e `SEND_MESSAGE` em `supabase/functions/whatsapp-webhook/index.ts:1030-1042`:

```ts
if (eventMatches(event, "messages.upsert", "messages.set", "send.message")) {
  const key = m?.key ?? m?.message?.key ?? m?.message?.message?.key ?? {};
  const wamid = key?.id ?? m?.id ?? null;
  const fromMe = Boolean(key?.fromMe ?? m?.fromMe);
  const resolved = await resolveRemoteJid(...);
}
```

Para `fromMe=true`, `resolveRemoteJid` monta candidatos em `index.ts:579-625` e `routing.ts:62-81` usando, nesta ordem geral:

- `remoteJidAlt`
- `participantAlt`
- `participantPn`
- `senderPn`
- `recipientJid`, `recipient`, `to`, `chatId`
- `destinationJid`, `targetJid`
- `participant`
- por último, o `key.remoteJid` bruto quando ele não é o próprio número da instância

Se existir um JID telefônico entre esses candidatos, ele é usado. Se houver somente `@lid`, o código tenta:

1. alias já salvo em `whatsapp_jid_aliases` (`index.ts:480-501`, `617-618`);
2. consulta sob demanda à Evolution (`index.ts:504-575`, `1104-1117`);
3. se ainda não resolver, mantém o LID como conversa provisória (`index.ts:1119-1127`).

## 2. Origem dos números errados

A origem confirmada no banco é `whatsapp_jid_aliases.phone_jid`. A vulnerabilidade que permite gravá-los está nos resolvedores da resposta de contatos da Evolution.

Em `whatsapp-webhook/index.ts:551-560`, uma única lista mistura campos semanticamente diferentes:

```ts
const cands = [
  c?.id, c?.remoteJid, c?.remoteJidAlt, c?.jid, c?.jidAlt,
  c?.lid, c?.lidJid, c?.lid_jid,
  c?.pn, c?.phoneNumber, c?.wa_id, c?.senderPn, c?.participantPn,
];
const foundPhone = firstStandardJid(cands);
const foundLid = firstLidJid(cands);
```

O problema é que `firstStandardJid` chama `normalizePhoneJid`, e essa função aceita **qualquer sequência de dígitos** como telefone (`index.ts:34-48`; equivalente em `routing.ts:9-24`). Não há validação E.164, comprimento adequado ou rejeição de zero inicial.

Além disso:

- `c.id` é o primeiro candidato, embora possa ser um identificador interno/opaco;
- o primeiro valor numérico não-LID pode virar `@s.whatsapp.net` mesmo sem ser telefone;
- o reconciliador periódico repete a fragilidade: `whatsapp-lid-reconcile/index.ts:42-49, 208-223` aceita números com apenas 8 dígitos e também mistura `id`, `jid`, `pn`, `phoneNumber` e `wa_id`;
- a checagem sob demanda aceita um telefone mesmo quando a resposta não contém o LID solicitado: `if (foundPhone && (!foundLid || foundLid === lidJid))` (`index.ts:560`).

O banco não registra a coluna `source` do alias, então não é possível afirmar qual das duas rotinas o criou originalmente. Mas ambas possuem a mesma falha estrutural e os aliases atuais reproduzem exatamente os IDs exibidos na UI.

## 3. Diferença entre envio pelo sistema e pelo celular

### Enviado dentro do sistema

`evolution-send` recebe um `conversation_id` já conhecido (`evolution-send/index.ts:39, 54-57`). Ele:

1. carrega diretamente essa conversa;
2. extrai o número de `conversations.telefone` ou `remote_jid` (`linha 82`);
3. envia pela Evolution;
4. grava a mensagem diretamente no mesmo `conversation_id`, já com o `wamid` retornado (`linhas 153, 160-173`).

Quando o eco volta pelo webhook, a deduplicação por `wamid` encontra essa mensagem e não cria outro chat (`whatsapp-webhook/index.ts:1223-1241`).

### Enviado por outro dispositivo

Não existe uma mensagem pré-gravada nem um `conversation_id` fornecido pelo painel. O webhook precisa descobrir o destinatário somente pelo payload. Quando recebe apenas `key.remoteJid=<LID>@lid`, consulta o alias/resolvedor. Se esse alias é `8812944955@s.whatsapp.net`, esse valor passa a ser o `remoteJid` efetivo.

Depois o código deriva:

```ts
const phone = onlyDigits(remoteJid.split("@")[0]);
let conv = await findConversation(tenantId, remoteJid, phone);
```

(`index.ts:1284-1287`)

Assim, procura exatamente por `remote_jid='8812944955@s.whatsapp.net'` ou `telefone='8812944955'`. Não encontra a conversa real e cria uma nova (`index.ts:1303-1319`).

## 4. Matching existente e motivo da falha

Existe matching antes da criação, em `findConversation` (`index.ts:636-649`):

1. igualdade exata por `remote_jid`;
2. igualdade exata por `telefone`;
3. sempre respeitando o tenant/Master.

Ele falha porque recebe como entrada o alias inválido, não o telefone canônico. Não há como uma busca exata por `8812944955` encontrar a conversa cujo telefone real é outro.

A deduplicação por `wamid` também não resolve o caso do celular: ela só encontra algo quando o mesmo `wamid` já foi salvo anteriormente. No envio pelo painel isso ocorre; no primeiro evento vindo do dispositivo, não.

## 5. Causa concreta

```text
Celular envia
  → payload contém somente <LID>@lid
  → resolvedor consulta/usa whatsapp_jid_aliases
  → campo numérico opaco é aceito como telefone
  → alias LID → telefone falso é persistido
  → findConversation busca esse telefone falso
  → nenhuma conversa canônica corresponde
  → webhook cria chat paralelo
```

Portanto, não é problema de tenant, formulário, lead, dashboard ou agenda. Também não é truncamento por `split('@')[0]`: esse `split` apenas remove o domínio **depois** que o alias incorreto já foi escolhido.

## Correção mínima recomendada — ainda não aplicada

1. **Restringir os campos que podem fornecer telefone:** priorizar somente campos explicitamente telefônicos (`pn`, `phoneNumber`, `wa_id`, `senderPn`, `participantPn` e JIDs canônicos explícitos); nunca interpretar um `id` numérico genérico como telefone.
2. **Exigir pareamento autoritativo:** uma resposta da Evolution só pode criar alias se contiver simultaneamente o LID exatamente igual ao solicitado e um telefone canônico válido. Remover a condição permissiva `!foundLid`.
3. **Validar telefone antes de persistir/usar alias:** formato internacional plausível, comprimento E.164 e rejeição de zero inicial/IDs opacos. Aplicar a mesma validação no webhook e no reconciliador periódico.
4. **Sanear os aliases inválidos existentes:** colocar em quarentena os aliases que falharem na nova validação, consultar novamente a fonte autoritativa e então mesclar os chats órfãos na conversa canônica.
5. **Fail-safe:** quando houver somente LID e nenhuma resolução confiável, não convertê-lo em `@s.whatsapp.net`; mantê-lo explicitamente como pendente até resolução, evitando que um identificador opaco pareça telefone real.

Escopo futuro restrito ao webhook, resolução/reconciliação de LID, saneamento dos aliases e testes de roteamento outbound; sem tocar em dashboard, agenda ou formulários.