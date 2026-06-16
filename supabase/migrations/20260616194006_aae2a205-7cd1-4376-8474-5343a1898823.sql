
ALTER TABLE public.facebook_webhook_config
  ADD COLUMN IF NOT EXISTS app_id text,
  ADD COLUMN IF NOT EXISTS connected_page_name text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamptz;

DROP FUNCTION IF EXISTS public.get_facebook_config_meta();

CREATE OR REPLACE FUNCTION public.get_facebook_config_meta()
 RETURNS TABLE(
   id uuid,
   verify_token text,
   page_id text,
   app_id text,
   connected_page_name text,
   token_expires_at timestamptz,
   has_page_access_token boolean,
   has_app_secret boolean,
   last_validated_at timestamp with time zone,
   last_validation_result jsonb,
   updated_at timestamp with time zone
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    c.id,
    c.verify_token,
    c.page_id,
    c.app_id,
    c.connected_page_name,
    c.token_expires_at,
    (c.page_access_token IS NOT NULL AND length(c.page_access_token) > 0) AS has_page_access_token,
    (c.app_secret IS NOT NULL AND length(c.app_secret) > 0) AS has_app_secret,
    c.last_validated_at,
    c.last_validation_result,
    c.updated_at
  FROM public.facebook_webhook_config c
  WHERE public.has_role(auth.uid(), 'admin')
  LIMIT 1;
$function$;
