## Diagnóstico
Os formulários que você mapeou (Página **Dr Matheus - Medico**, ex.: RMK-01 com 23 leads, FORM-01_GoldIncision_A com 32) pertencem a uma **Página diferente** da que está configurada no `facebook_webhook_config` (page_id `1032397629953696`). A edge function `facebook-backfill-leads` usa **apenas o Page Access Token dessa página configurada** — e o Graph API só devolve leads de um formulário se o token for da Página dona do formulário. Resultado: a chamada de backfill falha silenciosamente para os forms mapeados e nenhum lead entra no tenant (por isso o tenant do Alessandro só tem 9 leads Facebook, todos do form antigo `1858043458199562`).

Já temos `user_access_token` salvo — dá pra resolver o token da Página certa dinamicamente pra cada form.

## Correção

**1. `supabase/functions/facebook-backfill-leads/index.ts` — usar token da Página dona do form**
- Carregar também `user_access_token` do `facebook_webhook_config`.
- Buscar `/me/accounts?fields=id,name,access_token&limit=200` com o user token e montar cache `pageId → pageToken/pageName`.
- Para cada `form_id` recebido:
  - Chamar `GET /{form_id}?fields=name,page{id,name}` com user token pra descobrir a Página dona.
  - Usar `pageTokenCache[form.page.id]` na hora de fazer `GET /{form_id}/leads?...`. Se não existir (usuário não é admin daquela Página), retornar erro claro no `summary` (`error: "sem token para a página X"`).
- Manter fallback: se o form for da Página configurada, continuar usando `page_access_token`.
- Ao inserir o lead, gravar também `facebook_page_id = form.page.id` para diagnóstico futuro (já existe coluna? se não, só logar).

**2. UI `src/pages/admin/CampanhasPage.tsx`**
- Nenhuma mudança de layout. Só melhorar o `toast` do `syncFormNow` / `syncPageForms` pra mostrar `imported / fetched / failed / error` vindo do `by_form` — assim, se um form ainda falhar (ex.: usuário sem permissão naquela Página), fica visível.

**3. Reprocessar histórico**
- Após deploy: você clica em **IMPORTAR HISTÓRICO** no card da Página "Dr Matheus - Medico" (ou usa "Sincronizar Agora" em cada form). Os 23 + 32 leads dos forms mapeados vão pra tabela `leads` já com `tenant_id = bb96152a-…` (Alessandro), aparecendo na aba Leads do tenant.

## Fora do escopo
- Não muda schema, não mexe em roteamento (`resolve_tenant_for_lead` já resolve pelo `form_id` correto), não mexe em outras páginas.
