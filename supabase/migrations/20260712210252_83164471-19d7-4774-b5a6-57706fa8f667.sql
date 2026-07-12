
-- Restrict api_tokens to tenant admins
DROP POLICY IF EXISTS "tenant access api_tokens" ON public.api_tokens;
CREATE POLICY "Tenant admins manage api_tokens"
ON public.api_tokens
FOR ALL
TO authenticated
USING (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));

-- Restrict kommo_connections SELECT and writes to tenant admins
DROP POLICY IF EXISTS "Admins and tenant members can view kommo connection" ON public.kommo_connections;
DROP POLICY IF EXISTS "Admins and tenant members can insert kommo connection" ON public.kommo_connections;
DROP POLICY IF EXISTS "Admins and tenant members can update kommo connection" ON public.kommo_connections;
DROP POLICY IF EXISTS "Admins and tenant members can delete kommo connection" ON public.kommo_connections;

CREATE POLICY "Tenant admins view kommo connection"
ON public.kommo_connections FOR SELECT TO authenticated
USING (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant admins insert kommo connection"
ON public.kommo_connections FOR INSERT TO authenticated
WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant admins update kommo connection"
ON public.kommo_connections FOR UPDATE TO authenticated
USING (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant admins delete kommo connection"
ON public.kommo_connections FOR DELETE TO authenticated
USING (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));

-- Restrict zapi_connections to tenant admins
DROP POLICY IF EXISTS "Tenant members manage zapi_connections" ON public.zapi_connections;
DROP POLICY IF EXISTS "Tenant members view zapi_connections" ON public.zapi_connections;
DROP POLICY IF EXISTS "Tenant members insert zapi_connections" ON public.zapi_connections;
DROP POLICY IF EXISTS "Tenant members update zapi_connections" ON public.zapi_connections;
DROP POLICY IF EXISTS "Tenant members delete zapi_connections" ON public.zapi_connections;

CREATE POLICY "Tenant admins manage zapi_connections"
ON public.zapi_connections FOR ALL TO authenticated
USING (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));
