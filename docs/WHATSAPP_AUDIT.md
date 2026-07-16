# Auditoria WhatsApp — Como funciona, onde falha e como diagnosticar

Este documento descreve end-to-end o funcionamento do WhatsApp dentro da plataforma
(Evolution API + Cloud API opcional) e serve de guia para a página
`/admin/whatsapp-audit`.

## 1. Componentes

- **Evolution API** (self-hosted): usa Baileys, escaneia QR code, é o canal
  padrão para todos os tenants.
- **WhatsApp Cloud API** (Meta): opcional, ativado por tenant quando o
  cliente tem um WABA. Só é usado para envio; a recepção continua vindo do
  webhook próprio da Meta.
- **Edge functions**:
  - `whatsapp-webhook` — recebe eventos Evolution (POST) e grava em
    `messages` / `conversations`.
  - `evolution-send` — envia texto/mídia via Evolution.
  - `whatsapp-cloud-send` / `whatsapp-cloud-webhook` — pareamento com a Cloud API.
  - `evolution-webhook-audit` — corrige webhooks fora do padrão.
  - `whatsapp-audit` — auditoria de saúde exposta na UI.
- **Tabelas principais**:
  - `zapi_connections` (nome legado): guarda `instance_url`, `api_key`,
    `instance_name`, `webhook_secret`, `webhook_url` por tenant. Master usa
    `tenant_id IS NULL`.
  - `tenant_whatsapp_numbers`: números verificados por tenant (owner JIDs
    esperados).
  - `whatsapp_jid_aliases`: mapa `@lid → phone JID` construído incrementalmente
    a partir de eventos que contêm ambas as formas na mesma `key`.
  - `conversations` / `messages`: dados exibidos na UI.

## 2. Fluxo de recepção (cliente → sistema)

1. Cliente envia mensagem pelo WhatsApp.
2. Baileys captura, Evolution emite `MESSAGES_UPSERT` (ou `MESSAGES_SET`
   quando é histórico) via POST no webhook.
3. Nosso webhook usa `?tenant=<slug>&secret=<...>` para saber a que tenant
   pertence e valida o secret.
4. `resolveRemoteJid` pega o JID do remetente. Se vier em `@lid` sem alias
   conhecido, ainda assim grava a conversa como **provisória** (com o `@lid`
   como `remote_jid`) e adiciona a flag `needs_lid_review`.
5. Insere na tabela `messages` e atualiza `conversations` (última interação,
   contador de não lidas).
6. Realtime dispara e a UI (`useConversations` / `useMessages`) recebe a
   atualização.

## 3. Fluxo de envio pelo painel

1. Usuário digita e clica enviar em `WhatsAppChat`.
2. Frontend chama `evolution-send`, que faz POST na Evolution API.
3. Evolution responde com `key.id` (wamid) e enfileira o envio.
4. A própria Evolution devolve o eco via webhook (`SEND_MESSAGE` ou
   `MESSAGES_UPSERT` com `fromMe=true`).
5. O webhook faz "reconciliação por wamid": em vez de inserir uma nova linha,
   atualiza a mensagem existente marcando `status='sent'`.
6. ACKs subsequentes (`MESSAGES_UPDATE` com `status: DELIVERY_ACK` / `READ`)
   promovem para `delivered` / `read` (✓✓ azul).

## 4. Fluxo de envio pelo celular físico (dispositivo pareado)

1. Operador manda mensagem pelo WhatsApp do celular.
2. Baileys emite `SEND_MESSAGE` (e às vezes `MESSAGES_UPSERT`) com
   `key.fromMe=true` e a `key.remoteJid` sendo o **destinatário**.
3. Nosso webhook detecta `fromMe=true`, resolve o destinatário usando
   `collectOutboundPeerCandidates` (que ignora o `ownerJid`) e insere na
   `messages` com `direction='outbound'`, `sender='usuario'` e
   `metadata.origin='device'`.
4. Se não houver conversa para aquele destinatário, uma nova é criada. Se
   o destinatário estiver em `@lid`, a conversa vira provisória até que um
   alias apareça.

## 5. Isolamento por tenant

Todo webhook Evolution é chamado como
`https://<supabase>/functions/v1/whatsapp-webhook?tenant=<slug>&secret=<...>`.
O secret vem de `zapi_connections.webhook_secret`. Sem o secret certo, a
requisição é rejeitada com 401. Isso impede que uma instância mal
configurada de um cliente grave dados em outro tenant.

**Master** (Posion Master) usa `tenant_id IS NULL` na `zapi_connections` e
nas queries. Um bug corrigido recentemente fazia o modal master carregar a
conexão de outro tenant quando havia mais de uma linha na tabela —
resolvido restringindo a query a `tenant_id IS NULL`.

## 6. Eventos obrigatórios

A Evolution só entrega eventos que estejam na lista `events` do webhook.
Nossos eventos obrigatórios (definidos em `_shared/evolution-webhook.ts`):

- `MESSAGES_UPSERT` — mensagens recebidas e envios do painel refletidos.
- `MESSAGES_SET` — carga inicial ao conectar.
- `SEND_MESSAGE` — envios feitos por outro dispositivo (celular físico).

Além disso, `webhookByEvents` **deve ser `false`**; caso contrário a
Evolution posta em rotas separadas (`/webhook/send-message`, etc.) que o
handler não reconhece.

## 7. `@lid` vs. JID canônico

WhatsApp Business Cloud passou a introduzir identificadores locais (`@lid`)
em vez do número (`@s.whatsapp.net`) em algumas mensagens. Isso quebrava
conversas porque o painel não sabia o telefone real. Regras atuais:

- Guardamos alias `lid → phone` na tabela `whatsapp_jid_aliases`, mas
  **somente quando o LID e o telefone vêm da MESMA `key`** (ver
  `decideAliasFromSameKey` em `routing.ts`). Pareamentos entre campos
  diferentes causavam o "storm de conversas" identificado no dia
  2026-07-05.
- Enquanto não há alias, a conversa fica provisória e o merge posterior
  (`whatsapp-lid-merge`, `mergeProvisionalLidConversations`) migra
  mensagens quando o alias chega.

## 8. Troubleshooting — problemas comuns

### A. Mensagens enviadas pelo celular físico não aparecem no painel

**Diagnóstico**: contador "outbound de dispositivo (7d)" = 0 na auditoria.

Causas prováveis, em ordem:

1. `SEND_MESSAGE` não está inscrito na Evolution → **Reassinar webhook**.
2. `webhookByEvents = true` na instância → **Reassinar webhook** força
   `false`.
3. `?secret=` divergente entre a URL registrada na Evolution e o valor em
   `zapi_connections.webhook_secret` → **Reassinar webhook** força alinhamento.
4. Instância desconectada (`state != open`) → refazer QR code.
5. Ownerjid mal detectado → verificar seção "OwnerJid da instância" da
   auditoria.

Fix aplicado em código (2026-07-16): o webhook não descarta mais outbound
`@lid` sem conversa prévia — grava como provisório. Isso resolve o cenário
"mandei do celular para um lead novo antes de ele responder".

### B. ✓✓ azul não atualiza

`MESSAGES_UPDATE` não está inscrito ou não bate no wamid gravado. Verificar
que a lista de eventos contém `MESSAGES_UPDATE` (auditoria já checa).

### C. Contador de não lidas não zera

`conversations.nao_lidas` só zera quando o painel emite a leitura via
`whatsapp-mark-read`. Se a chamada falhar (401 / instância caiu), o
contador fica preso.

### D. Mensagens vindo com nome do operador em vez do cliente

Bug antigo: `pushName` em mensagens `fromMe=true` é o nome do dono do
telefone. Corrigido — só usamos `pushName` em mensagens `fromMe=false`.

### E. Painel do tenant mostra dados de outro tenant

Sempre relacionado a query sem `tenant_id`. Master deve usar
`tenant_id IS NULL`, tenant deve usar `tenant_id = <id>`. Nunca misturar.

## 9. Rotinas de fix na página `/admin/whatsapp-audit`

- **Reassinar webhook**: dispara `evolution-webhook-audit` que força
  `webhookByEvents=false`, injeta a lista completa de eventos e realinha a
  URL com o secret esperado.
- **Recarregar auditoria**: recarrega o snapshot depois de aplicar um fix
  externo (por exemplo, refazer o QR code).
