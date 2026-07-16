# Auditoria WhatsApp — corrigir "mensagens enviadas pelo celular não aparecem"

Confirmação recebida: **caso A** — mensagens enviadas pelo celular físico não chegam no painel; só as recebidas do cliente aparecem.

## Causas prováveis (identificadas na leitura do código)

Em ordem de probabilidade, com base em `supabase/functions/whatsapp-webhook/index.ts` e `_shared/evolution-webhook.ts`:

1. **Evento `SEND_MESSAGE` / `MESSAGES_UPSERT` não assinado na Evolution.** Se a instância foi criada antes do último ajuste em `EVOLUTION_EVENTS` ou o admin desligou, o Baileys captura o `fromMe=true` mas não posta no webhook.
2. **`webhookByEvents=true`** na instância. A Evolution passa a postar em rotas separadas (`/whatsapp-webhook/send-message`), que o handler não reconhece. Nosso `configureWebhook` sempre envia `false`, mas instâncias legadas ficaram com `true`.
3. **Outbound para NOVO contato dropa em `isPendingLid && fromMe`.** Regra em `index.ts:969-980`: se o outbound chega como `@lid` sem alias e não existe conversa prévia, é descartado com `outbound_unresolved_lid_dropped_no_conv`. É exatamente o cenário "mandei do celular pra um lead novo" — o inbound ainda não existiu, então o outbound some.
4. **`ownJids` mal detectado.** Se o `ownerJid` capturado inclui por engano o JID do destinatário (bug conhecido em envelopes aninhados da Evolution), `rawIsOwn=true` → dropa em `no_jid_dropped`.
5. **`?secret=` do webhook divergente do DB** ou `?tenant=` errado após a separação master/tenant que fizemos hoje → mensagem é rejeitada com 401.
6. **Instância desconectada** (state ≠ `open`) durante o horário em que a mensagem foi enviada.

## O que vou entregar

### 1. Correção definitiva no webhook (`supabase/functions/whatsapp-webhook/index.ts`)
- **Remover o drop cego para outbound `@lid` sem conversa prévia**. Passo a criar a conversa provisória mesmo quando `isPendingLid && fromMe`, marcando `needs_lid_review=true` e `lid_review_notes="outbound sem inbound prévio — resolver por CONTACTS_UPDATE"`. Assim a mensagem sempre aparece no painel; o merge posterior por `pushName`/`CONTACTS_UPDATE` reconcilia a conversa quando o número real for revelado.
- **Log estruturado**: acrescentar `console.log("[wa-out]", { event, fromMe, rawRemoteJid, ownJids, wamid })` no início do laço de `messages.upsert` para diagnóstico direto via `edge_function_logs`.
- **Fallback de resolução de JID**: quando `fromMe=true` e o único candidato standard é próprio JID, tentar o `participantAlt` / `senderPn` como recipient antes de dropar.

### 2. Edge function `whatsapp-audit` (nova)
Endpoint `POST` com `{ tenant_id | "master" }` que retorna JSON com checklist:

- Conexão Evolution: URL, `instance_name`, `state` via `/instance/connect`.
- Webhook: URL registrada bate com a esperada, `?secret=` bate com `zapi_connections.webhook_secret`, `?tenant=` bate com o tenant.
- Eventos assinados vs. `REQUIRED_EVENTS` (`MESSAGES_UPSERT`, `MESSAGES_SET`, `SEND_MESSAGE`). Lista os que faltam.
- Flag `webhookByEvents` (deve ser `false`).
- Settings da instância: `syncFullHistory`, `readMessages`, `alwaysOnline`, `readStatus`.
- OwnerJid da instância vs. `tenant_whatsapp_numbers` verificados do tenant.
- Tráfego 7d: `count(*)` inbound, outbound-via-painel (`sender=usuario AND metadata.raw_key.fromMe=true AND wamid NULL no momento do insert`), outbound-de-outro-device (`sender=usuario AND metadata.raw_key.fromMe=true`). Se o número de outbound-de-outro-device for 0 apesar de o cliente ter enviado do celular, a auditoria já aponta isso como sintoma-A.
- Últimas 20 mensagens com `direction`, `status`, `wamid`, `sender` para inspeção.
- Cloud API (quando ativa): `waba_id`, `phone_number_id`, `webhook_subscribed`, tokens.

Cada item devolve `{ok, hint, fix_action?}` onde `fix_action` é uma das ações da tela.

### 3. Tela `Auditoria WhatsApp`
- Rota `/admin/whatsapp-audit` (Master) + botão "Auditar" dentro do card do tenant em `TenantWhatsAppNumbersCard`.
- Renderiza o JSON como checklist verde/amarelo/vermelho.
- Ações one-click:
  - **Reassinar webhook** → chama `evolution-resubscribe` já existente (garante lista `EVOLUTION_EVENTS` + `webhookByEvents=false`).
  - **Aplicar settings recomendados** → chama endpoint da Evolution `settings/set` com `syncFullHistory:true, readMessages:true, alwaysOnline:true, readStatus:true`.
  - **Enviar mensagem de teste do celular** — instrução visual pedindo pro operador mandar uma mensagem do celular físico agora e clicar "Recarregar auditoria" 15s depois; o painel confirma se o `SEND_MESSAGE` chegou.

### 4. Documento `docs/WHATSAPP_AUDIT.md`
Explicação end-to-end em português:
1. Como o WhatsApp funciona no sistema (Evolution vs. Cloud API, quem grava no banco).
2. Fluxo de uma mensagem **recebida** (device do cliente → Baileys → webhook → `conversations` + `messages` → realtime → UI).
3. Fluxo de uma mensagem **enviada pelo painel** (UI → `evolution-send` → API Evolution → webhook devolve `SEND_MESSAGE` → reconciliação por wamid).
4. Fluxo de uma mensagem **enviada por outro dispositivo** (device → Baileys emite `SEND_MESSAGE`/`MESSAGES_UPSERT fromMe=true` → webhook grava `sender=usuario, direction=outbound`).
5. Isolamento por tenant via `?tenant=<slug>&secret=<...>` (a correção master/tenant que fizemos hoje).
6. ACKs `MESSAGES_UPDATE` e por que ✓✓ azul às vezes trava.
7. `@lid` vs. JID canônico, regras de merge.
8. **Troubleshooting**: cada uma das 6 causas prováveis acima, com sinal claro e comando de fix.

## Detalhes técnicos

Arquivos alterados/criados:

```text
docs/WHATSAPP_AUDIT.md                                (novo)
supabase/functions/whatsapp-audit/index.ts            (novo)
src/pages/admin/WhatsAppAuditPage.tsx                 (novo)
src/components/tenant/TenantWhatsAppNumbersCard.tsx   (botão "Auditar")
src/App.tsx                                           (rota nova)
src/components/admin/AppSidebar.tsx                   (item "Auditoria WhatsApp")
supabase/functions/whatsapp-webhook/index.ts          (2 correções descritas)
```

Sem migrations. Sem alteração de RLS. A edge function `whatsapp-audit` usa apenas leituras (`conversations`, `messages`, `zapi_connections`, `tenant_whatsapp_numbers`, `whatsapp_connections`) + chamadas HTTP à Evolution.