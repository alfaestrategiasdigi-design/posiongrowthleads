## Objetivo
No `/admin/pipeline`:
1. Adicionar campo de busca para filtrar leads no funil.
2. Corrigir "Novo Lead" para que leads criados manualmente apareçam de fato no pipeline.

## Diagnóstico
Em `src/pages/admin/AgencyPipelinePage.tsx`, o `load()` só traz `agency_leads` cujo `source_lead_id` está em uma lista de leads do Meta vinculados às regras `admin_master`. Leads criados manualmente pelo botão "Novo Lead" nascem com `source_lead_id = null` → nunca aparecem no board (parecem "não criados"). O `insert` já funciona; o problema é o filtro de leitura.

## Mudanças (apenas UI/leitura, sem alterar schema)

**`src/pages/admin/AgencyPipelinePage.tsx`**

1. **Fix "Novo Lead" visível**: alterar `load()` para trazer também os agency_leads manuais.
   - Fazer duas queries em paralelo:
     - `agency_leads` com `source_lead_id in (sourceIds)` (leads Meta atuais).
     - `agency_leads` com `source_lead_id is null` (criados manualmente).
   - Fazer merge (dedupe por `id`) e ordenar por `created_at desc`.
   - Se `sourceIds` for vazio, ainda assim carregar os manuais (hoje retorna `[]` cedo).

2. **Busca**: novo `useState<string>("")` `search` + `<Input>` no header (ao lado do botão "Novo Lead"), com ícone `Search` e placeholder "Buscar por clínica, responsável, e-mail, WhatsApp, cidade...".
   - Filtro client-side aplicado antes do `grouped` (via `useMemo`):
     - normalizar sem acento, lower-case, comparar `includes` contra: `nome_clinica`, `responsavel`, `email`, `whatsapp`, `cidade`, `estado`, `plano_interesse`, `utm_campaign`.
   - KPIs continuam calculados sobre o conjunto filtrado para refletir o que está visível.
   - Colunas do kanban mostram counts do filtrado; se `search` estiver ativo e a coluna ficar vazia, mostrar "Nenhum resultado".

3. **Toast de erro no insert**: no `LeadDialog.save()`, além de `toast.error(error.message)`, logar `console.error` para diagnóstico caso a RLS bloqueie inserts manuais no futuro.

## Fora do escopo
- Não mudar schema de `agency_leads` nem RLS.
- Não mexer no Kanban de `/admin/kanban` (leads dos tenants).
- Não mudar o fluxo de promoção para tenant.