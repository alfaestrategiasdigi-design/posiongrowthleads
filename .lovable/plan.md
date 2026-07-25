## Diagnóstico (o que já sabemos)

Nos prints:
- Painel envia várias mensagens pra `557799032433` (teste 16:23, 16:26, 16:29, 17:37, oi 18:40, teste 18:49). Aparecem com **✓ único** e nunca viram ✓✓.
- No celular físico do Dr. Matheus, essas **não aparecem** na conversa com o mesmo contato — só aparecem as que ele mesmo digitou no aparelho (Teste 16:27, Oi/Teste 17:38, teste 18:37/38/39).
- Nos logs do `whatsapp-webhook`, o único evento recente é um `send.message` cujo `ownJids: ["5511965022801@s.whatsapp.net"]` — esse é o número do **Admin Master**, não o do Instituto Roar.

Conclusão (a confirmar como passo 1): a instância `DRMATHEUS` na Evolution está **pareada no aparelho errado** (celular do Admin Master, 11 96502-2801). Por isso:
- Mensagens saem do painel mas saem do número do Admin, então o Matheus não vê nada saindo do WhatsApp dele.
- ACKs (✓✓) e recebidas do número do Matheus não chegam, porque a sessão Baileys que está de pé não é a dele.

Você diz que na Evolution (`129.121.36.166:8080/manager`) "está tudo conectado e recebendo certo" — isso combina: **a sessão está saudável, só está no telefone errado**.

## O que o plano faz

Duas frentes, na ordem:

**A. Reparear a instância `DRMATHEUS` no número certo do Matheus** (resolve o "não chega no destinatário" e o "recebida não marca").

1. Consultar `/instance/fetchInstances` na Evolution pra confirmar qual número está pareado hoje em `DRMATHEUS` (owner JID). Reportar antes de derrubar nada.
2. Se o owner não for o número do Matheus:
   - Chamar `/instance/logout/DRMATHEUS` na Evolution.
   - Abrir a tela de reconexão já existente (`ReconnectSessionCard` em `TenantConfig`) e gerar QR novo.
   - Pedir pro Matheus escanear no **celular dele**, não no do Admin.
   - Após `state=open`, rodar `evolution-resubscribe` **só pra essa instância** (mantém `webhookByEvents:false` + secret do banco, padrão que já validamos).
3. Confirmar owner novo em `/instance/fetchInstances` e registrar em `tenant_whatsapp_numbers` (número oficial da clínica) pra a rotina de merge-by-owner passar a rotear certo.

**B. Garantir que TODA conversa marque entrada e saída, em todos os tenants.**

Isso é o "preciso que em cada conta cada mensagem tenha `received` do lado esquerdo e `sent` do direito, garantido". Trabalho em `whatsapp-webhook`:

4. Auditar o handler `messages.upsert` e o `messages.update`:
   - Confirmar que nenhum branch descarta mensagens quando `ownerJid` diverge do cache — se descarta, trocar por **rota provisória + reconciliar depois** (mesmo padrão que já usamos pro @lid), nunca dropar.
   - Confirmar que outbound de qualquer aparelho (painel, celular físico, Evolution direto) sempre grava `direcao='enviada'` e entra na conversa canônica por telefone. Já temos merge-by-phone; garantir que roda pra `fromMe=true` também.
   - Confirmar que `messages.update` (status ACK) casa por `wamid` **e** por fallback `(remote_jid, timestamp±5s, from_me=true)` pros casos onde o wamid do envio local difere do que a Evolution emite depois — sem esse fallback, ✓ único fica pra sempre.
5. Rodar `whatsapp-wamid-reconcile` retroativo nas conversas do Instituto Roar pra corrigir mensagens antigas travadas em ✓.
6. Adicionar 1 teste E2E na suíte existente (`outbound_integration_test.ts`) cobrindo o cenário "instância repareada, wamid do send diferente do wamid do update" — pra não regredir.

## Detalhes técnicos

- Evolution base: `http://129.121.36.166:8080` (é a `instance_url` salva em `zapi_connections` pra `DRMATHEUS`, `provider=evolution`).
- `evolution-status` / `evolution-reconnect` / `evolution-resubscribe` já existem e são o que vou reaproveitar — nada de duplicar function.
- O reassinatura vai usar `webhook_secret` do banco (padrão validado com Gabriel), `webhookByEvents:false`, mesma URL de webhook já em uso.
- Nada de mexer em `_shared/phone-jid.ts` ou na lógica de LID reconcile — o problema aqui não é normalização, é aparelho errado.
- Nenhuma migração de dados destrutiva; só `whatsapp-wamid-reconcile` que só preenche `wamid` faltante.

## O que **não** vou fazer sem sua confirmação

- Não vou derrubar a sessão atual antes de você confirmar que o número pareado é mesmo o do Admin (passo 1 é read-only, te reporto o `owner`).
- Não vou tocar em outros tenants (Gabriel, Donna Face, etc.) — o escopo aqui é DRMATHEUS + regra global de marcação de entrada/saída no webhook.

## Como você vai saber que ficou bom

- `fetchInstances DRMATHEUS` mostra owner = número do Matheus.
- Uma mensagem enviada pelo painel aparece no WhatsApp físico do Matheus **como enviada por ele** (não pelo Admin) e em segundos vira ✓✓ no painel.
- Uma mensagem enviada pelo aparelho físico do Matheus para um contato qualquer aparece no painel do lado direito como `sent`.
- Uma mensagem recebida de um lead qualquer aparece no painel do lado esquerdo como `received`, sem cair em chat paralelo.
