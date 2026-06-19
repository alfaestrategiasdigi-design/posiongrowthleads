
-- 1) user_roles: explicit restrictive policy preventing self-insert/update/delete by non-admins
DROP POLICY IF EXISTS "Only admins can write roles" ON public.user_roles;
CREATE POLICY "Only admins can write roles"
  ON public.user_roles
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) appointments: drop NULL-tenant allowance; backfill orphans to safe state by deleting (no tenant context)
DROP POLICY IF EXISTS "Tenant members manage appointments" ON public.appointments;
CREATE POLICY "Tenant members manage appointments"
  ON public.appointments
  FOR ALL
  TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));

-- 3) conversations & messages: add tenant-scoped policies; keep admin override
DROP POLICY IF EXISTS "Admins can manage conversations" ON public.conversations;
CREATE POLICY "Admins manage all conversations"
  ON public.conversations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Tenant members access conversations"
  ON public.conversations FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Admins can manage messages" ON public.messages;
CREATE POLICY "Admins manage all messages"
  ON public.messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Tenant members access messages"
  ON public.messages FOR ALL TO authenticated
  USING (
    tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)
  )
  WITH CHECK (
    tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)
  );

-- 4) zapi_connections: restrict to tenant admins only (not all tenant members)
DROP POLICY IF EXISTS "tenant access zapi_connections" ON public.zapi_connections;
CREATE POLICY "Tenant admins manage zapi_connections"
  ON public.zapi_connections FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id));

-- 5) Realtime: remove sensitive tables from public realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.clinic_leads;
ALTER PUBLICATION supabase_realtime DROP TABLE public.sales;

-- 6) Lock down SECURITY DEFINER helper functions: revoke from anon; keep authenticated where required by RLS
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_tenant_access(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_tenant_ids() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_facebook_config_meta() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_sales_pending() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_contact_count() FROM PUBLIC, anon, authenticated;
