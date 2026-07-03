## Problema

O dashboard da Agência mostra R$ 0 / 0 leads / 0 conversão para a Clarissa porque as políticas de RLS das tabelas usadas pelo painel POSION exigem `has_role(uid, 'admin')`. Contas `comercial_admin_master` e usuários vinculados ao tenant Master (papel `user`) são bloqueadas na leitura e recebem listas vazias — daí os zeros.

Contas de clínica (`/app/{slug}/...`) já leem via `has_tenant_access`, então não são afetadas — o ajuste é apenas do lado master.

## O que muda

1. Criar uma função `public.is_agency_member(uid)` (SECURITY DEFINER) que retorna true quando o usuário:
   - tem `admin` no `user_roles`, OU
   - tem `comercial_admin_master` no `user_roles`, OU
   - tem vínculo ativo em `tenant_users` com o tenant Master (`00000000-0000-0000-0000-000000000001`).

2. Ajustar as políticas de **SELECT** das tabelas do painel POSION para usar essa função (leitura ampla para toda a agência). As políticas de escrita continuam restritas a `admin`.

   Tabelas afetadas (apenas SELECT):
   - `agency_leads`
   - `agency_contracts` (mantém a política que também deixa clínica ver o próprio)
   - `saas_contracts`
   - `tenants` (deixar membros da agência enxergarem todas as clínicas; clínicas continuam vendo só a sua via `current_tenant_ids`)
   - `campaign_insights`, `campaign_insights_breakdown`, `campaign_spend`, `campaign_lead_links` (usadas nas telas de Campanhas/Pipeline)
   - `leads` (formulário POSION)
   - `subscriptions`, `subscription_invoices` (usadas em Planos)

3. **Não** vou tocar em tabelas com escopo por tenant (`sales`, `clinic_leads`, `patients`, etc.) — elas devem continuar isoladas por clínica.

4. Nada muda no frontend nesta etapa; o Dashboard, Pipeline, Leads (formulário), Campanhas, Contratos e Planos passam a carregar dados reais assim que o RLS permitir a leitura para membros da agência.

## Detalhes técnicos

```sql
create or replace function public.is_agency_member(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.has_role(_uid, 'admin')
    or public.has_role(_uid, 'comercial_admin_master')
    or exists (
      select 1 from public.tenant_users
      where user_id = _uid
        and tenant_id = '00000000-0000-0000-0000-000000000001'
        and active = true
    );
$$;
```

Depois: `DROP POLICY` das SELECT atuais dessas tabelas e recriar com `USING (public.is_agency_member(auth.uid()))` (mantendo policies extras onde já existem — ex.: `agency_contracts` que também libera para o tenant dono).

## Risco / escopo

- Leitura mais ampla dentro do time POSION (esperado — todos os papéis master enxergam o painel).
- Escritas continuam apenas para `admin` (evita SDR alterar dados).
- Dados de clínicas continuam isolados por RLS de tenant.
