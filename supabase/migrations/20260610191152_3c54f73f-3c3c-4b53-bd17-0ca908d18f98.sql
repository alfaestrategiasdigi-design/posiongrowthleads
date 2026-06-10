
-- 1) api_tokens table
CREATE TABLE IF NOT EXISTS public.api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Token principal',
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_token_idx ON public.api_tokens(token);
CREATE INDEX IF NOT EXISTS api_tokens_tenant_idx ON public.api_tokens(tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_tokens TO authenticated;
GRANT ALL ON public.api_tokens TO service_role;

ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant access api_tokens"
  ON public.api_tokens
  FOR ALL
  TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

CREATE TRIGGER update_api_tokens_updated_at
  BEFORE UPDATE ON public.api_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Extend zapi_connections for manual WhatsApp config
ALTER TABLE public.zapi_connections
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'zapi',
  ADD COLUMN IF NOT EXISTS instance_url text,
  ADD COLUMN IF NOT EXISTS instance_name text,
  ADD COLUMN IF NOT EXISTS api_key text;

-- Allow tenant members to manage their own connection (in addition to admins)
DROP POLICY IF EXISTS "tenant access zapi_connections" ON public.zapi_connections;
CREATE POLICY "tenant access zapi_connections"
  ON public.zapi_connections
  FOR ALL
  TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));
