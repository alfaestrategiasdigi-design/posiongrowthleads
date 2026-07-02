
-- Helpers
CREATE OR REPLACE FUNCTION public.get_tenant_role(_user_id uuid, _tenant_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT role::text FROM public.tenant_users
  WHERE user_id = _user_id AND tenant_id = _tenant_id AND active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_tenant_comercial(_user_id uuid, _tenant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users
    WHERE user_id = _user_id AND tenant_id = _tenant_id AND active = true
      AND role::text IN ('comercial_tenant','vendedor','recepcao','viewer')
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_tenant_role(uuid,uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_tenant_comercial(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_tenant_role(uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_tenant_comercial(uuid,uuid) TO authenticated, service_role;

-- Tabela invites
CREATE TABLE IF NOT EXISTS public.invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role public.app_role NOT NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_role text,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invites_email ON public.invites (lower(email));
CREATE INDEX IF NOT EXISTS idx_invites_token ON public.invites (token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.invites TO authenticated;
GRANT ALL ON public.invites TO service_role;

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invites_admin_all" ON public.invites;
CREATE POLICY "invites_admin_all" ON public.invites
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "invites_tenant_admin_manage" ON public.invites;
CREATE POLICY "invites_tenant_admin_manage" ON public.invites
  FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id));

-- RLS restritivo (bloqueia comercial)
DROP POLICY IF EXISTS "sales_block_comercial" ON public.sales;
CREATE POLICY "sales_block_comercial" ON public.sales
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR tenant_id IS NULL
    OR NOT public.is_tenant_comercial(auth.uid(), tenant_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR tenant_id IS NULL
    OR NOT public.is_tenant_comercial(auth.uid(), tenant_id)
  );

DROP POLICY IF EXISTS "campaign_spend_block_comercial" ON public.campaign_spend;
CREATE POLICY "campaign_spend_block_comercial" ON public.campaign_spend
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR tenant_id IS NULL
    OR NOT public.is_tenant_comercial(auth.uid(), tenant_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR tenant_id IS NULL
    OR NOT public.is_tenant_comercial(auth.uid(), tenant_id)
  );

DROP POLICY IF EXISTS "agency_contracts_block_comercial" ON public.agency_contracts;
CREATE POLICY "agency_contracts_block_comercial" ON public.agency_contracts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR tenant_id IS NULL
    OR NOT public.is_tenant_comercial(auth.uid(), tenant_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin')
    OR tenant_id IS NULL
    OR NOT public.is_tenant_comercial(auth.uid(), tenant_id)
  );

DROP POLICY IF EXISTS "saas_contracts_admin_only" ON public.saas_contracts;
CREATE POLICY "saas_contracts_admin_only" ON public.saas_contracts
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "payment_provider_admin_only" ON public.payment_provider_config;
CREATE POLICY "payment_provider_admin_only" ON public.payment_provider_config
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
