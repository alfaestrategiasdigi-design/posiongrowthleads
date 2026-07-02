# Vincular Contas Meta ↔ Cliente

## Problema
- No painel do cliente (`/app/:slug/campanhas`) a função `tenant-campaigns` lê a tabela **`tenant_ad_accounts`** para saber quais `act_*` mostrar.
- Hoje essa tabela está **vazia**. O admin master escreve o vínculo apenas em `lead_routing_rules` (usado para roteio de leads), então o cliente do Dr. Alessandro vê "Nenhuma campanha".
- Precisamos de uma UI no Admin Master para escolher a conta de anúncio e o cliente e persistir em `tenant_ad_accounts`, mantendo o roteio de leads coerente.

## O que vou implementar

### 1. Painel Admin — nova seção "Vincular conta ao cliente"
Local: topo de `src/pages/admin/CampanhasPage.tsx`, ao lado do seletor de conta atual.

- Card "Contas vinculadas a clientes" listando cada linha de `tenant_ad_accounts` com: nome do tenant, `act_id`, label, toggle ativo, botão remover.
- Formulário inline: `Select` de conta (usa `list_ad_accounts` já disponível) + `Select` de tenant (query `tenants`) + campo opcional de label → botão **Vincular**.
- Ao vincular:
  - `upsert` em `tenant_ad_accounts` (respeita o `unique (tenant_id, ad_account_id)`).
  - `upsert` espelhado em `lead_routing_rules` (`match_type='ad_account_id'`) para manter o roteio automático de leads que já usamos.
- Ao remover: apaga em ambos.
- Uma mesma conta pode ficar vinculada a mais de um tenant se necessário; o admin master continua vendo tudo (nada muda no seletor de conta atual dele).

### 2. Painel do Cliente — reflexo automático
`src/pages/app/TenantCampaigns.tsx` e `supabase/functions/tenant-campaigns` já filtram por `tenant_ad_accounts`. Só preciso:
- Melhorar o estado vazio: quando `reason === "no_mapping"`, mostrar "Nenhuma conta de anúncio vinculada. Peça à Posion." (já parecido, ajustar cópia).
- Mostrar no header a(s) conta(s) vinculadas (nome + `act_id`), vindas do array `ad_accounts` que a função já devolve.
- Nada de escrita pelo cliente: RLS já garante que ele só lê as próprias linhas.

### 3. Migração de dados
Backfill único: para cada regra existente em `lead_routing_rules` com `match_type='ad_account_id' AND active`, inserir a linha correspondente em `tenant_ad_accounts` (ON CONFLICT DO NOTHING) para que vínculos antigos apareçam de imediato no painel dos clientes atuais.

### 4. Sem mudanças de escopo
- Não altero autenticação, RLS existente, nem o dashboard do Admin Master.
- Não mudo o fluxo de formulários Meta Lead Ads (segue como está).
- Nenhum novo secret ou tabela — `tenant_ad_accounts` já existe com as políticas certas.

## Resultado esperado
- Admin master abre "Campanhas Meta", escolhe conta + cliente, clica Vincular.
- Cliente entra em `/app/<slug>/campanhas` e vê os mesmos cards de campanha (com KPIs, ganhos CRM, ROAS) que o admin vê para aquela conta — filtrados só à(s) conta(s) dele.
