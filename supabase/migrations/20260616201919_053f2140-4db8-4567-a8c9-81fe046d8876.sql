
ALTER TABLE public.facebook_webhook_config
  ADD COLUMN IF NOT EXISTS ad_account_id text,
  ADD COLUMN IF NOT EXISTS default_tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_campaigns_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_leads_sync_at timestamptz;

ALTER TABLE public.campaign_spend ALTER COLUMN tenant_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS campaign_spend_unique_meta
  ON public.campaign_spend (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), channel, campaign_id, period_start)
  WHERE campaign_id IS NOT NULL;

DROP POLICY IF EXISTS "admins manage all campaign_spend" ON public.campaign_spend;
CREATE POLICY "admins manage all campaign_spend"
  ON public.campaign_spend FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_spend TO authenticated;
GRANT ALL ON public.campaign_spend TO service_role;

DROP FUNCTION IF EXISTS public.get_facebook_config_meta();

CREATE FUNCTION public.get_facebook_config_meta()
 RETURNS TABLE(
   id uuid, verify_token text, page_id text, app_id text,
   connected_page_name text, token_expires_at timestamptz,
   ad_account_id text, default_tenant_id uuid,
   last_campaigns_sync_at timestamptz, last_leads_sync_at timestamptz,
   has_page_access_token boolean, has_app_secret boolean,
   last_validated_at timestamptz, last_validation_result jsonb,
   updated_at timestamptz
 )
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    c.id, c.verify_token, c.page_id, c.app_id,
    c.connected_page_name, c.token_expires_at,
    c.ad_account_id, c.default_tenant_id,
    c.last_campaigns_sync_at, c.last_leads_sync_at,
    (c.page_access_token IS NOT NULL AND length(c.page_access_token) > 0),
    (c.app_secret IS NOT NULL AND length(c.app_secret) > 0),
    c.last_validated_at, c.last_validation_result, c.updated_at
  FROM public.facebook_webhook_config c
  WHERE public.has_role(auth.uid(), 'admin')
  LIMIT 1;
$$;
