
ALTER TABLE public.whatsapp_connections
  ADD COLUMN IF NOT EXISTS access_token text,
  ADD COLUMN IF NOT EXISTS app_secret text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

-- Remove a política que deixa membros de tenant verem credenciais sensíveis
-- (apenas admin pode ler conexões; tenant verá metadados via view futura)
DROP POLICY IF EXISTS "Tenant members see their wa connections" ON public.whatsapp_connections;

-- View pública (sem segredos) para tenants enxergarem status da sua conexão
CREATE OR REPLACE VIEW public.whatsapp_connections_public AS
SELECT
  id, tenant_id, provider, display_name,
  display_phone_number, business_account_name,
  webhook_subscribed, status, last_validated_at,
  is_default, created_at, updated_at
FROM public.whatsapp_connections;

GRANT SELECT ON public.whatsapp_connections_public TO authenticated;
