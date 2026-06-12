
ALTER TABLE public.tenant_users ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.has_tenant_access(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE user_id = _user_id AND tenant_id = _tenant_id AND active = true
  ) OR public.has_role(_user_id, 'admin');
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_admin(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE user_id = _user_id AND tenant_id = _tenant_id
      AND active = true AND role IN ('admin','owner')
  ) OR public.has_role(_user_id, 'admin');
$$;

DROP POLICY IF EXISTS "Tenant admins manage memberships" ON public.tenant_users;
CREATE POLICY "Tenant admins manage memberships" ON public.tenant_users
FOR ALL TO authenticated
USING (public.is_tenant_admin(auth.uid(), tenant_id))
WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));

DROP POLICY IF EXISTS "Tenant members manage appointments" ON public.appointments;
CREATE POLICY "Tenant members manage appointments" ON public.appointments
FOR ALL TO authenticated
USING (tenant_id IS NULL OR public.has_tenant_access(auth.uid(), tenant_id))
WITH CHECK (tenant_id IS NULL OR public.has_tenant_access(auth.uid(), tenant_id));
