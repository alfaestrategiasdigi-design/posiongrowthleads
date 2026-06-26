
CREATE OR REPLACE FUNCTION public.fire_capi_on_won()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/facebook-capi-event';
BEGIN
  IF NEW.status = 'ganho'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ganho')
     AND NEW.tenant_id IS NOT NULL
  THEN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type','application/json'),
      body := jsonb_build_object(
        'tenant_id', NEW.tenant_id,
        'lead_id',   NEW.id,
        'event_name','Purchase'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fire_capi_on_won ON public.leads;
CREATE TRIGGER trg_fire_capi_on_won
AFTER INSERT OR UPDATE OF status ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.fire_capi_on_won();
