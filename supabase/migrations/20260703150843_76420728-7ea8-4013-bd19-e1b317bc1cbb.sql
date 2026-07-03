
-- Isolamento estrito: leads/contratos POSION nunca aparecem em telas de clínicas.

-- 1) agency_contracts: remover política permissiva que vazava contratos com tenant_id NULL.
DROP POLICY IF EXISTS "agency_contracts_block_comercial" ON public.agency_contracts;
-- Restante: só admin gerencia. Tenants podem visualizar apenas contratos vinculados ao próprio tenant.
DROP POLICY IF EXISTS "Tenants view own agency contracts" ON public.agency_contracts;
CREATE POLICY "Tenants view own agency contracts"
  ON public.agency_contracts FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));

-- 2) agency_leads: só admin. Tenants nunca leem agency_leads diretamente.
--    (Política existente "Admins manage agency leads" já cobre. Garantir que não há outra permissiva.)
DROP POLICY IF EXISTS "Tenants view own agency leads" ON public.agency_leads;

-- 3) sales: remover política permissiva que liberava tenant_id NULL para qualquer não-comercial.
DROP POLICY IF EXISTS "sales_block_comercial" ON public.sales;
-- Restringir INSERT: exigir que quem cria sale seja admin do sistema OU tenha acesso ao tenant.
DROP POLICY IF EXISTS "sales_insert" ON public.sales;
CREATE POLICY "sales_insert"
  ON public.sales FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    AND (public.has_role(auth.uid(), 'admin') OR public.has_tenant_access(auth.uid(), tenant_id))
  );

-- 4) posion_contracts: exclusivo POSION admin master — nunca visível para tenants.
--    Política "Admins manage posion_contracts" já restringe. Sem alterações.

-- 5) saas_contracts: idem — só admin master.
--    Políticas atuais já restringem a admin.
