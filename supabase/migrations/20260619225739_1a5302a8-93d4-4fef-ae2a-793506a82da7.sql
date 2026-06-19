
DROP VIEW IF EXISTS public.whatsapp_connections_public;
CREATE VIEW public.whatsapp_connections_public
WITH (security_invoker = true) AS
SELECT
  id, tenant_id, provider, display_name,
  display_phone_number, business_account_name,
  webhook_subscribed, status, last_validated_at,
  is_default, created_at, updated_at
FROM public.whatsapp_connections;
GRANT SELECT ON public.whatsapp_connections_public TO authenticated;
