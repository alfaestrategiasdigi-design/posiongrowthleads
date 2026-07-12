
-- 1) founder_slots: restrict SELECT to tenant admins (was any tenant member)
DROP POLICY IF EXISTS "Tenant users can view their founder slot" ON public.founder_slots;
CREATE POLICY "Tenant admins can view their founder slot"
  ON public.founder_slots FOR SELECT TO authenticated
  USING (is_tenant_admin(auth.uid(), tenant_id) OR has_role(auth.uid(), 'admin'::app_role));

-- 2) leads: agency members should only see master-funnel leads (tenant_id IS NULL)
DROP POLICY IF EXISTS "Agency members read leads" ON public.leads;
CREATE POLICY "Agency members read master leads"
  ON public.leads FOR SELECT TO authenticated
  USING (tenant_id IS NULL AND is_agency_member(auth.uid()));

-- 3) plan_catalog: restrict SELECT to admins
DROP POLICY IF EXISTS "plan_catalog read all authenticated" ON public.plan_catalog;
CREATE POLICY "plan_catalog admin read"
  ON public.plan_catalog FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- 4) qualification_fields: require authentication (was public/anon)
DROP POLICY IF EXISTS "Public can read active fields" ON public.qualification_fields;
CREATE POLICY "Authenticated can read qualification fields"
  ON public.qualification_fields FOR SELECT TO authenticated
  USING (true);

-- 5) Revoke EXECUTE from anon and PUBLIC on all SECURITY DEFINER functions in public schema
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname,
           pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC, anon',
                   r.proname, r.args);
  END LOOP;
END $$;
