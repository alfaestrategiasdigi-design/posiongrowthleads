## Contexto

Tenant `Clínica Donna Face` tem **61 conversas @lid** aguardando reconciliação. Ao chamar `whatsapp-lid-reconcile` direto, a requisição estoura o timeout do gateway (`context canceled`) porque a função processa tudo em série, com várias idas ao banco por conversa (~5-8 queries × 61 = ~400 queries em uma única request).

Preciso ao mesmo tempo (1) executar a reconciliação agora e (2) evitar que o próximo lote grande volte a estourar.

## Plano

### 1. Tornar `whatsapp-lid-reconcile` resiliente a lotes grandes
- Aceitar no body: `limit` (default 20) e `offset` (default 0), além do `tenant_id` já existente.
- Aplicar `.order('ultima_interacao', { ascending: false }).range(offset, offset+limit-1)` no `SELECT` das conversas `@lid`.
- Devolver no JSON: `processed`, `remaining` (contagem de `@lid` restantes no tenant) e `next_offset`, para permitir loop pelo cliente.
- Nenhuma mudança de lógica de merge — só paginação.

### 2. Loop de execução em lotes (server-side, via edge function call)
- Chamar `whatsapp-lid-reconcile` repetidamente com `limit=15` até `remaining=0` ou até esgotar 10 iterações de segurança.
- Reportar resumo consolidado: `auto_merged`, `renamed`, `manual_review` por tenant.

### 3. Melhoria opcional na UI (se sobrar espaço no plano)
- Em `LidReviewDialog.tsx`, no botão "Rodar reconciliação automática", trocar a chamada única por um loop de lotes com feedback de progresso (`Processando 20/61…`). Isso resolve o problema para o usuário também na interface, não só quando eu rodo manualmente.

## Detalhes técnicos

Arquivos alterados:

- `supabase/functions/whatsapp-lid-reconcile/index.ts`
  - Ler `limit`/`offset` do body (com defaults e clamp).
  - Aplicar `.range()` na query principal.
  - Após o loop, executar um `SELECT count(*)` filtrado por tenant + `remote_jid LIKE '%@lid'` + `needs_lid_review=true` (ou sem esse filtro, para refletir o pool real) e devolver `remaining`.
  - Devolver `next_offset = offset + processed` quando `remaining > 0`.

- `src/components/admin/whatsapp/LidReviewDialog.tsx`
  - `runReconcile` passa a chamar a função em loop com `limit=15`, acumulando os contadores retornados e mostrando um toast de progresso a cada rodada.
  - Ao final, mesmo `toast.success` + `load()` + `onDone()` já existentes.

Execução pós-deploy (feita por mim via ferramenta de curl):
1. Loop de 5 chamadas com `{ tenant_id: "f23ff22b-…-9efe7", limit: 15 }` até `remaining=0`.
2. Rodar `SELECT count(*) FROM conversations WHERE tenant_id='…' AND needs_lid_review=true` e reportar quantas caíram em `auto_merged`, quantas em `renamed` e quantas restaram como `manual_review` (essas continuam aparecendo no diálogo para você confirmar o número real).

Sem mudanças em regras de merge, sem migrations, sem alteração no webhook.
