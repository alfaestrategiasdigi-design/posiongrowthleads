# Diagnóstico — outbound DRMATHEUS travado em ✓ (sem entregar)

Só diagnóstico, nenhuma correção aplicada.

## 1. A chamada pra Evolution está indo e voltando OK

`supabase/functions/evolution-send/index.ts` é **síncrono**: só grava a mensagem no banco depois de `await fetch(...)` retornar `r.ok`. Se a Evolution respondesse erro/timeout, retornaria 502 e a linha nem existiria em `messages`.

Confirmado no banco: as 15 últimas outbound do tenant `f259af97-...` (Instituto Roar) têm todas `status='sent'` **e** `wamid` populado (ex.: `3EB0DC5AAE92657D2145F00D23817A160682A188` às 21:40:14). `wamid` só vem do JSON de resposta da Evolution, então o envio HTTP foi aceito.

**Conclusão:** não é fire-and-forget nem timeout de envio. A Evolution está aceitando as mensagens.

## 2. O ✓ único é ausência de ACK, não falha de envio

O check duplo/entregue depende do handler `messages.update` (linhas ~968–1027 do `whatsapp-webhook/index.ts`), que faz o `UPDATE messages SET status='delivered'|'read' WHERE wamid=...`.

Nos logs do `whatsapp-webhook` das últimas horas:
- Aparecem vários `[wa-in] event: "send.message", fromMe: true` (o eco do envio) — ex.: 21:40:15 e 21:39:24 com os mesmos wamids gravados no banco.
- **Nenhum** log de `messages.update` / `send.message.update` / `no-match` para essa instância. Ou seja, a Evolution não está emitindo eventos de ACK (delivery/read) para o webhook — só o `send.message`.

Como o handler nunca é acionado, `status` fica congelado em `sent` para sempre → UI mostra ✓ único indefinidamente, mesmo quando o WhatsApp real entregou.

**Causa raiz mais provável:** a lista de eventos assinados na Evolution para a instância `DRMATHEUS` não inclui `MESSAGES_UPDATE` (e/ou `SEND_MESSAGE_UPDATE`). O resubscribe recente forçou `webhookByEvents:false` e reescreveu a URL, mas a lista `events[]` pode ter ficado sem esses dois. Precisa confirmar via `GET /webhook/find/DRMATHEUS` na Evolution.

## 3. Estado da instância

`zapi_connections` para o tenant: `instance_name=DRMATHEUS`, `status=connected`, `webhook_url` com `?tenant=…&secret=b4574a…ec78` (padrão correto), `updated_at` de 21:38 hoje.

Endpoints disponíveis pra checar programaticamente:
- `evolution-status` (`POST { instance_name, tenant_id }`) → consulta `/instance/connectionState/DRMATHEUS` e devolve `state` (`open|connecting|close`) + normaliza para `connected/disconnected`.
- `evolution-webhook-audit` (usado no `/admin/whatsapp-audit`) → lê `/webhook/find/{instance}` e compara com a URL/eventos esperados.

Sessão em si está sadia (inbound recente entra normalmente, connectionState open). O problema não é sessão caída.

## Observação adicional

O log de `send.message` mostra `ownJids: ["5511965022801@s.whatsapp.net"]`. Vale confirmar se esse número é mesmo o registrado em `tenant_whatsapp_numbers` para o Roar — se não for, a rota de owner-based está pegando mensagens "do dono errado" e pode virar tema à parte (não bloqueia o ✓, mas convém validar depois).

## Próximo passo sugerido (não executado ainda)

1. Rodar `GET {base}/webhook/find/DRMATHEUS` (via `evolution-webhook-audit` ou curl manual) e verificar se `events` inclui `MESSAGES_UPDATE` e `SEND_MESSAGE_UPDATE`.
2. Se estiver faltando, o fix é um resubscribe explicitando o array de events completo — só depois de você aprovar.
