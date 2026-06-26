
CREATE TABLE IF NOT EXISTS public.tenant_capi_config (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  pixel_id text,
  access_token text,
  default_event text NOT NULL DEFAULT 'Purchase',
  test_event_code text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_capi_config TO authenticated;
GRANT ALL ON public.tenant_capi_config TO service_role;
ALTER TABLE public.tenant_capi_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant admins manage capi config"
  ON public.tenant_capi_config FOR ALL
  TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));
CREATE TRIGGER trg_tenant_capi_config_updated
  BEFORE UPDATE ON public.tenant_capi_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.facebook_capi_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid,
  event_name text,
  status text NOT NULL,
  http_status int,
  request jsonb,
  response jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.facebook_capi_logs TO authenticated;
GRANT ALL ON public.facebook_capi_logs TO service_role;
ALTER TABLE public.facebook_capi_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant members read capi logs"
  ON public.facebook_capi_logs FOR SELECT
  TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id));
CREATE INDEX IF NOT EXISTS idx_capi_logs_tenant_created
  ON public.facebook_capi_logs (tenant_id, created_at DESC);
