
-- 1. Internal edge dispatch token (used by DB triggers to authenticate to edge functions)
CREATE TABLE IF NOT EXISTS public.edge_internal_config (
  id int PRIMARY KEY DEFAULT 1,
  dispatch_token text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT edge_internal_config_singleton CHECK (id = 1)
);
GRANT ALL ON public.edge_internal_config TO service_role;
ALTER TABLE public.edge_internal_config ENABLE ROW LEVEL SECURITY;
-- No policies for anon/authenticated → only service_role can access.
INSERT INTO public.edge_internal_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Helper returning JSON headers for net.http_post
CREATE OR REPLACE FUNCTION public._internal_dispatch_headers()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (SELECT dispatch_token FROM public.edge_internal_config WHERE id = 1)
  );
$$;
REVOKE EXECUTE ON FUNCTION public._internal_dispatch_headers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._internal_dispatch_headers() TO service_role;

-- 2. Update DB triggers to send the dispatch token
CREATE OR REPLACE FUNCTION public.fire_automation_dispatch()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/automation-dispatch';
  v_headers jsonb := public._internal_dispatch_headers();
  v_trigger text;
BEGIN
  IF TG_TABLE_NAME = 'leads' THEN
    IF TG_OP = 'INSERT' THEN
      v_trigger := CASE WHEN COALESCE(NEW.origem,'') ILIKE 'facebook%' THEN 'lead_entered' ELSE 'form_submitted' END;
      PERFORM net.http_post(url := v_url, headers := v_headers,
        body := jsonb_build_object('trigger', v_trigger, 'tenant_id', NEW.tenant_id,
          'context', jsonb_build_object('lead_id', NEW.id, 'phone', NEW.whatsapp, 'name', NEW.nome_completo,
            'email', NEW.email, 'form_name', NEW.facebook_form_name, 'origem', NEW.origem)));
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM net.http_post(url := v_url, headers := v_headers,
        body := jsonb_build_object('trigger', 'kanban_moved', 'tenant_id', NEW.tenant_id,
          'context', jsonb_build_object('lead_id', NEW.id, 'phone', NEW.whatsapp, 'name', NEW.nome_completo,
            'from_status', OLD.status, 'to_status', NEW.status)));
      IF NEW.status = 'ganho' THEN
        PERFORM net.http_post(url := v_url, headers := v_headers,
          body := jsonb_build_object('trigger', 'lead_won', 'tenant_id', NEW.tenant_id,
            'context', jsonb_build_object('lead_id', NEW.id, 'phone', NEW.whatsapp, 'name', NEW.nome_completo, 'valor', NEW.valor_proposta)));
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'appointments' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM net.http_post(url := v_url, headers := v_headers,
        body := jsonb_build_object('trigger', 'appointment_created', 'tenant_id', NEW.tenant_id,
          'context', jsonb_build_object('appointment_id', NEW.id, 'lead_id', NEW.lead_id,
            'phone', NEW.client_phone, 'name', NEW.client_name, 'date_time', NEW.date_time)));
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('confirmado','compareceu') THEN
        PERFORM net.http_post(url := v_url, headers := v_headers,
          body := jsonb_build_object('trigger', 'appointment_confirmed', 'tenant_id', NEW.tenant_id,
            'context', jsonb_build_object('appointment_id', NEW.id, 'lead_id', NEW.lead_id, 'phone', NEW.client_phone, 'name', NEW.client_name)));
      ELSIF NEW.status = 'cancelado' THEN
        PERFORM net.http_post(url := v_url, headers := v_headers,
          body := jsonb_build_object('trigger', 'appointment_cancelled', 'tenant_id', NEW.tenant_id,
            'context', jsonb_build_object('appointment_id', NEW.id, 'lead_id', NEW.lead_id, 'phone', NEW.client_phone, 'name', NEW.client_name)));
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fire_capi_on_won()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/facebook-capi-event';
BEGIN
  IF NEW.status = 'ganho'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ganho')
     AND NEW.tenant_id IS NOT NULL
  THEN
    PERFORM net.http_post(url := v_url, headers := public._internal_dispatch_headers(),
      body := jsonb_build_object('tenant_id', NEW.tenant_id, 'lead_id', NEW.id, 'event_name','Purchase'));
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fire_capi_on_lead_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/facebook-capi-event';
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    PERFORM net.http_post(url := v_url, headers := public._internal_dispatch_headers(),
      body := jsonb_build_object('tenant_id', NEW.tenant_id, 'lead_id', NEW.id, 'event_name','Lead', 'event_id', 'lead:' || NEW.id::text));
  END IF;
  RETURN NEW;
END;
$function$;

-- 3. Fix search_path on map_lead_status_to_stage (SUPA_function_search_path_mutable)
CREATE OR REPLACE FUNCTION public.map_lead_status_to_stage(_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path = public
AS $function$
  SELECT CASE lower(coalesce(_status,''))
    WHEN 'ganho' THEN 'ganho'
    WHEN 'perdido' THEN 'perdido'
    WHEN 'qualificado' THEN 'qualificado'
    WHEN 'reuniao' THEN 'reuniao'
    WHEN 'proposta' THEN 'proposta'
    WHEN 'negociacao' THEN 'negociacao'
    ELSE 'lead'
  END;
$function$;

-- 4. Revoke EXECUTE from anon on SECURITY DEFINER functions
-- (SUPA_anon_security_definer_function_executable)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', r.proname, r.args);
  END LOOP;
END $$;

-- 5. Backfill webhook_secret so all Evolution connections have one
UPDATE public.zapi_connections
   SET webhook_secret = encode(gen_random_bytes(24), 'hex')
 WHERE (webhook_secret IS NULL OR webhook_secret = '');

-- 6. Storage RLS: replace overly permissive whatsapp-media policies with tenant-scoped ones
DROP POLICY IF EXISTS "wa media authenticated read" ON storage.objects;
DROP POLICY IF EXISTS "wa media authenticated write" ON storage.objects;
DROP POLICY IF EXISTS "wa media tenant read" ON storage.objects;
DROP POLICY IF EXISTS "wa media tenant write" ON storage.objects;
DROP POLICY IF EXISTS "wa media tenant update" ON storage.objects;
DROP POLICY IF EXISTS "wa media tenant delete" ON storage.objects;

-- Tenant-scoped read: first path segment must be a tenant_id the user belongs to,
-- OR an instance_name of a zapi_connection under such tenant, OR the user is admin.
CREATE POLICY "wa media tenant read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'whatsapp-media' AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.active = true
        AND tu.tenant_id::text = split_part(storage.objects.name, '/', 1)
    )
    OR EXISTS (
      SELECT 1 FROM public.zapi_connections zc
      JOIN public.tenant_users tu ON tu.tenant_id = zc.tenant_id AND tu.active = true
      WHERE zc.instance_name = split_part(storage.objects.name, '/', 1)
        AND tu.user_id = auth.uid()
    )
  )
);

CREATE POLICY "wa media tenant write"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'whatsapp-media' AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.active = true
        AND tu.tenant_id::text = split_part(storage.objects.name, '/', 1)
    )
    OR EXISTS (
      SELECT 1 FROM public.zapi_connections zc
      JOIN public.tenant_users tu ON tu.tenant_id = zc.tenant_id AND tu.active = true
      WHERE zc.instance_name = split_part(storage.objects.name, '/', 1)
        AND tu.user_id = auth.uid()
    )
  )
);

CREATE POLICY "wa media tenant update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'whatsapp-media' AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.active = true
        AND tu.tenant_id::text = split_part(storage.objects.name, '/', 1)
    )
  )
);

CREATE POLICY "wa media tenant delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'whatsapp-media' AND (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.tenant_users tu
      WHERE tu.user_id = auth.uid() AND tu.active = true
        AND tu.tenant_id::text = split_part(storage.objects.name, '/', 1)
    )
  )
);
