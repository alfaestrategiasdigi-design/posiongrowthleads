-- Permitir que membros do tenant leiam e gerenciem seus próprios leads
CREATE POLICY "Tenant members read leads"
  ON public.leads FOR SELECT
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "Tenant members update leads"
  ON public.leads FOR UPDATE
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "Tenant admins delete leads"
  ON public.leads FOR DELETE
  USING (tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id));
