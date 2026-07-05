## Diagnóstico confirmado

O bug não é visual: o backend está aceitando eventos `fromMe=true` da Evolution API usando o `key.remoteJid` como se fosse sempre o contato de destino. Em cenários multi-device/@lid, o webhook pode entregar o `remoteJid` como o próprio WhatsApp conectado ou como um identificador alternativo, enquanto o contato real vem em campos como `remoteJidAlt`, `participant`, `participantAlt`, `sender`, `recipient` ou dentro do envelope da mensagem.

A referência externa confirma esse comportamento: há issues/PRs da Evolution/Baileys sobre `@lid`, `remoteJidAlt` e mensagens onde o `remoteJid` precisa ser substituído pelo identificador real antes de persistir o evento.

## Plano de correção

1. **Criar resolução canônica de destino para mensagens `fromMe`**
   - Separar a lógica de “quem é o contato da conversa” da lógica genérica de `remoteJid`.
   - Para `fromMe=true`, priorizar campos de destinatário/alternativos (`remoteJidAlt`, `participantAlt`, `participant`, `senderPn`, `recipient`, etc.) e rejeitar o JID da própria instância quando ele aparecer como `remoteJid`.
   - Para `fromMe=false`, manter o comportamento atual, mas com suporte ampliado aos mesmos aliases `@lid`/telefone.

2. **Identificar e ignorar o próprio WhatsApp da instância**
   - Derivar o “número próprio” da conexão quando disponível e impedir que mensagens enviadas para terceiros sejam gravadas na conversa do próprio número.
   - Se o webhook vier ambíguo e só trouxer o próprio JID, não criar conversa errada; registrar como pendente de resolução em vez de contaminar o histórico.

3. **Fortalecer `@lid` de forma global por tenant**
   - Quando houver `@lid` + JID telefônico no mesmo payload, salvar alias imediatamente.
   - Quando houver `fromMe + @lid` sem telefone claro, tentar resolver por alias já conhecido antes de criar qualquer conversa provisória.
   - Em caso ambíguo, sinalizar revisão manual sem mesclar automaticamente.

4. **Corrigir dados já contaminados**
   - Localizar mensagens `fromMe` recentes que foram parar na conversa do próprio número ou em conversa errada.
   - Reassociar automaticamente somente quando existir evidência única: mesmo `wamid`, alias conhecido, telefone alternativo ou conversa candidata única.
   - O que não tiver evidência única fica marcado para revisão, sem decisão unilateral.

5. **Validação real antes de encerrar**
   - Criar testes de payload simulando:
     - envio do telefone para Lucas;
     - envio do telefone para outro número;
     - evento com `remoteJid` próprio e contato em `remoteJidAlt`/`participant`;
     - evento `@lid` com e sem alias.
   - Chamar a função de webhook com esses payloads e validar no banco que cada mensagem cai na conversa do destinatário correto, nunca na conversa “comigo mesmo”.
   - Entregar relatório com: causa raiz, arquivos alterados, casos corrigidos por tenant, casos pendentes e resultado dos testes.