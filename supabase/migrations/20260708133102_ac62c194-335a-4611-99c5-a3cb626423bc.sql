-- Permite que membros da agência master (ex.: Clarissa) leiam/gerenciem
-- as regras de roteamento admin_master e vejam o meta do config do Facebook.

DROP POLICY IF EXISTS "Admins manage routing rules" ON public.lead_routing_rules;

CREATE POLICY "Agency members read routing rules"
  ON public.lead_routing_rules
  FOR SELECT
  TO authenticated
  USING (public.is_agency_member(auth.uid()));

CREATE POLICY "Agency members manage master routing rules"
  ON public.lead_routing_rules
  FOR ALL
  TO authenticated
  USING (public.is_agency_member(auth.uid()) AND is_admin_master = true)
  WITH CHECK (public.is_agency_member(auth.uid()) AND is_admin_master = true);

CREATE POLICY "Admins manage all routing rules"
  ON public.lead_routing_rules
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Amplia o acesso ao meta do config do Facebook para membros da agência.
CREATE OR REPLACE FUNCTION public.get_facebook_config_meta()
 RETURNS TABLE(id uuid, verify_token text, page_id text, app_id text, connected_page_name text, token_expires_at timestamp with time zone, ad_account_id text, default_tenant_id uuid, last_campaigns_sync_at timestamp with time zone, last_leads_sync_at timestamp with time zone, has_page_access_token boolean, has_app_secret boolean, last_validated_at timestamp with time zone, last_validation_result jsonb, updated_at timestamp with time zone, has_user_access_token boolean, user_token_expires_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    c.id, c.verify_token, c.page_id, c.app_id,
    c.connected_page_name, c.token_expires_at,
    c.ad_account_id, c.default_tenant_id,
    c.last_campaigns_sync_at, c.last_leads_sync_at,
    (c.page_access_token IS NOT NULL AND length(c.page_access_token) > 0),
    (c.app_secret IS NOT NULL AND length(c.app_secret) > 0),
    c.last_validated_at, c.last_validation_result, c.updated_at,
    (c.user_access_token IS NOT NULL AND length(c.user_access_token) > 0),
    c.user_token_expires_at
  FROM public.facebook_webhook_config c
  WHERE public.is_agency_member(auth.uid())
  LIMIT 1;
$function$;