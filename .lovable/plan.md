Três frentes independentes, todas visuais/comportamento (sem mudanças de schema).

## 1. WhatsApp — outbound "chat paralelo" (caso Donna Face / Lucas)

**Sintoma:** mensagem enviada pelo celular físico chega no destinatário, mas no painel do sistema aparece uma segunda conversa "send" com número diferente ao lado da conversa real, em vez de entrar na conversa existente.

**Causa provável:** o webhook está criando uma conversa nova quando o outbound vem só com `@lid` (ou com JID truncado) e já existe uma conversa canônica com o telefone real. O `resolveLidViaEvolution` só é chamado quando `isPendingLid` — mas em alguns eventos `messages.upsert` de SEND_MESSAGE o `effectiveJid` cai no fallback `senderPn/participantAlt` e vira um JID plausível MAS diferente do canônico salvo.

**Correção:** antes de inserir a mensagem outbound no `whatsapp-webhook/index.ts`, adicionar um "merge por telefone normalizado":
- Normalizar `effectiveJid` para dígitos E.164.
- Buscar conversa existente do mesmo tenant onde `telefone = normalizado` OU `remote_jid = <normalizado>@s.whatsapp.net`.
- Se encontrada e o `remote_jid` da mensagem atual difere, rotear a mensagem para a conversa canônica (reutilizar `mergeProvisionalLidConversations` estendendo-a para aceitar o par "phone JID variante → phone JID canônico").
- Registrar log estruturado `[wa-in] outbound_merged_by_phone` com from/to.
- Se `effectiveJid` for `@lid` e o `resolveLidViaEvolution` falhar, tentar segundo lookup por `pushName` do último inbound antes de criar provisional.

Também tratar o inverso: se já existir uma conversa "paralela" criada indevidamente, o `whatsapp-wamid-reconcile` (rodando a cada X min) precisa detectar `remote_jid` variantes do mesmo telefone e mesclar. Adicionar essa checagem no reconcile.

## 2. WhatsApp — Matheus (Instituto Roar): inbound não marca

**Sintoma:** mensagens recebidas não chegam nas conversas. Ao disparar webhook automático de eventos que não são de "configurações", o handler dá erro e a mensagem é descartada.

**Diagnóstico:** revisar no `whatsapp-webhook/index.ts` o caminho `unknown_owner_jid` e outras branches que hoje fazem `continue`/`return` cedo quando o `ownerJid` não bate com `tenant_whatsapp_numbers`. Precisamos:
- Nunca descartar `messages.upsert` inbound por causa de owner desconhecido — apenas logar e seguir usando o `tenantId` resolvido pela instância.
- Verificar `edge_function_logs` para o tenant `clinica-matheus-azevedo` nos últimos eventos para confirmar a linha exata que aborta (vou rodar `supabase--edge_function_logs` na build).
- Corrigir o path para que qualquer inbound (mesmo fora de "settings", ex.: `contacts.update` sozinho ou `messages.upsert` sem `send.message`) gere/atualize conversation + message.

## 3. Kanban de Leads — ajustes visuais

Arquivo `src/pages/app/TenantKanban.tsx` (rota que o usuário chama de "Kanban Leads") e `src/components/admin/LeadCard.tsx`.

- **Header**: reduzir `text-3xl` → `text-xl`, remover subtítulo repetido; compactar o botão "Novo Lead" / ações no topo para `size="sm"` (aplicar mesmo tratamento em `AgencyPipelinePage.tsx`).
- **LeadCard (density=comfortable)**:
  - Aumentar padding (`p-2.5` → `p-3.5`) e tamanho da fonte do nome (`text-[13px]` → `text-sm font-semibold`), avatar `w-6 h-6` → `w-7 h-7`.
  - Mover a **data de criação** para o canto superior direito do card, em fonte menor (`text-[9.5px] text-muted-foreground`), sem ícone, formato `dd/MM`.
  - Remover a data da linha inferior; deixar a linha inferior só com valor + botão WhatsApp.
  - Manter density `compact`/`spacious` funcionando.

## Ordem de execução

1. Ajustes visuais do Kanban (rápido, sem risco).
2. Correção do outbound merge (webhook + wamid-reconcile).
3. Correção do inbound Matheus (após olhar logs).

Nenhuma migração de banco. Só edge functions e componentes React.
