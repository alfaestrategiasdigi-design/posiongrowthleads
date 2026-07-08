
-- CAPI multi-stage support
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_fbp text,
  ADD COLUMN IF NOT EXISTS meta_fbc text,
  ADD COLUMN IF NOT EXISTS visitor_id text,
  ADD COLUMN IF NOT EXISTS cep text;

-- Server-side dedup log
CREATE TABLE IF NOT EXISTS public.capi_events_sent (
  event_id text PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  lead_id uuid,
  event_name text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.capi_events_sent TO authenticated;
GRANT ALL ON public.capi_events_sent TO service_role;

ALTER TABLE public.capi_events_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read capi dedup"
ON public.capi_events_sent
FOR SELECT
TO authenticated
USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));

CREATE INDEX IF NOT EXISTS idx_capi_events_sent_tenant ON public.capi_events_sent(tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_capi_events_sent_lead ON public.capi_events_sent(lead_id);

-- Trigger: fire Lead event on new lead
CREATE OR REPLACE FUNCTION public.fire_capi_on_lead_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_url text := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/facebook-capi-event';
BEGIN
  IF NEW.tenant_id IS NOT NULL THEN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object(
        'tenant_id', NEW.tenant_id,
        'lead_id',   NEW.id,
        'event_name','Lead',
        'event_id',  'lead:' || NEW.id::text
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fire_capi_on_lead_insert ON public.leads;
CREATE TRIGGER trg_fire_capi_on_lead_insert
AFTER INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.fire_capi_on_lead_insert();
