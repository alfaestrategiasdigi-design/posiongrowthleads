## Diagnóstico confirmado

A hipótese de filtro por lead não se confirma no código atual: o webhook cria a conversa antes de tentar criar/vincular um lead, e a tela lista conversas com `lead_id` vazio. No print, as mensagens de texto enviadas entre 14:18 e 14:53 nem chegaram ao banco/webhook; portanto, o bloqueio principal continua anterior à classificação como lead — na recepção da instância DRMATHEUS.

## Plano de implementação

1. **Tornar a reconexão verificável ponta a ponta**
   - Ajustar o fluxo de reconexão para só declarar a sessão saudável após receber uma nova mensagem individual inbound da DRMATHEUS, e não apenas pelo status `open`.
   - Exibir estado claro de “conectada, aguardando mensagem de teste” até o webhook persistir a mensagem.

2. **Garantir conversas sem lead no webhook**
   - Manter a criação da conversa independente de formulário ou `lead_id`.
   - Persistir mensagens individuais recebidas mesmo quando o tipo/conteúdo não é reconhecido, usando uma descrição segura em vez de descartá-las antes de criar a conversa.
   - Preservar as exclusões corretas de grupos e status/broadcast.
   - Manter a proteção existente para outbound `@lid` sem conversa, evitando conversas fantasmas.

3. **Validar a experiência na lista do WhatsApp**
   - Confirmar que o filtro “somente com lead” permanece desligado por padrão e que uma conversa com `lead_id = null` aparece, abre e recebe mensagens normalmente.
   - Não criar lead automaticamente como requisito para exibir a conversa; o vínculo poderá ocorrer posteriormente.

4. **Adicionar regressões e teste real**
   - Testar inbound de contato sem formulário, inbound de lead existente, contato `@lid`, mídia/forma não reconhecida e exclusão de grupo/status.
   - Após o novo QR, enviar uma mensagem de um número sem lead e confirmar o caminho completo: Evolution → webhook → conversa sem lead → mensagem → lista em tempo real.

## Resultado esperado

Toda mensagem individual recebida pela DRMATHEUS será armazenada e mostrada no WhatsApp do sistema, independentemente de o contato ter vindo de formulário ou possuir lead vinculado; a sessão só será marcada como saudável após essa recepção real.