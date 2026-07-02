## Problema

O botão "Sincronizar Formulários" hoje só lista formulários da Página configurada em `facebook_webhook_config.page_id`. Formulários criados em outras Páginas (Matheus Azevedo, etc.) ou dentro do Business Manager nunca aparecem — mesmo quando a Marketing API já vê as contas de anúncio dessas Páginas.

Motivo técnico: em `supabase/functions/facebook-ads-manage/index.ts`, a action `list_lead_forms` faz apenas:
```
GET /{cfg.page_id}/leadgen_forms
```
Formulários no Meta são de propriedade da **Página** (não da conta de anúncio), então precisamos varrer todas as Páginas visíveis pelo token de usuário — inclusive as owned/client pages dos Business Managers.

## Escopo da mudança

Backend (edge function) + UI da aba "Formulários Meta Vinculados" no `CampanhasPage`. Sem alterar schema.

### 1. `supabase/functions/facebook-ads-manage/index.ts` — action `list_lead_forms`

Reescrever para agregar formulários de todas as Páginas acessíveis:

1. `GET /me/accounts?fields=id,name,access_token&limit=200` → páginas pessoais.
2. `GET /me/businesses?fields=id,name&limit=200` → para cada Business:
   - `GET /{business_id}/owned_pages?fields=id,name,access_token&limit=200`
   - `GET /{business_id}/client_pages?fields=id,name,access_token&limit=200`
3. Deduplicar por `page.id`.
4. Para cada página (com concorrência limitada — reutilizar `mapLimit(pages, 4, ...)`):
   - `GET /{page.id}/leadgen_forms?fields=id,name,status,leads_count,created_time` usando o `page.access_token` retornado (fallback para o user token se ausente).
5. Retornar `{ ok: true, data: [{ id, name, status, leads_count, created_time, page_id, page_name }], pages: [{ id, name, forms_count }] }`.
6. Erros por página não devem quebrar a resposta — apenas incluir a página em `errors[]` com a mensagem do Graph (útil quando falta permissão em uma Página específica).

Rate-limit: reusar `fbErr` e o helper de cache existente não é necessário aqui (chamada pontual). Manter `mapLimit` com concorrência 4.

Sem novos escopos OAuth obrigatórios: `pages_show_list` + `leads_retrieval` + `business_management` (que já estão no fluxo de reconexão) cobrem a leitura. Se a Página não estiver conectada ao app, o Graph retorna erro específico — logamos em `errors[]` para a UI mostrar.

### 2. `src/pages/admin/CampanhasPage.tsx`

- Estender o tipo `LeadForm` com `page_id?: string; page_name?: string`.
- Na seção "Formulários Meta Vinculados": agrupar os formulários por `page_name` (accordion/heading por Página) e exibir badge com quantidade de formulários por página.
- Cabeçalho da seção: mostrar total geral e "X páginas verificadas".
- Se `data.errors` vier populado, mostrar um `Alert` discreto listando as páginas com falha (nome + motivo) — sem bloquear a lista.
- Manter o fluxo existente de vinculação `form_id → tenant_id` em `lead_routing_rules` (não muda).

## Fora do escopo

- Não altero `facebook-backfill-leads` — ele já usa `page_access_token` por página quando disponível via `lead_routing_rules`; se algum tenant precisar backfill de uma Página nova, o vínculo continua sendo criado pela mesma UI.
- Não mexo em campanhas, insights, cache ou routing rules.

## Resultado esperado

Após "Recarregar formulários", você verá formulários agrupados por Página (ex.: "Página Matheus Azevedo — 3 formulários", "Página Instituto Roar — 5 formulários"), independentemente da conta de anúncio, e poderá vincular cada um ao tenant correto.
