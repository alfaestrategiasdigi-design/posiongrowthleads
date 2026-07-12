
ALTER TABLE public.tenant_capi_config
  ADD COLUMN IF NOT EXISTS send_appointment_event boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS send_sale_event boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS appointment_event_name text NOT NULL DEFAULT 'Schedule',
  ADD COLUMN IF NOT EXISTS sale_event_name text NOT NULL DEFAULT 'Purchase';

-- Allow appointment_id / sale_id references in the logs (best effort)
ALTER TABLE public.facebook_capi_logs
  ADD COLUMN IF NOT EXISTS appointment_id uuid,
  ADD COLUMN IF NOT EXISTS sale_id uuid;

-- Trigger: appointment concluída → CAPI Schedule
CREATE OR REPLACE FUNCTION public.fire_capi_on_appointment_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/facebook-capi-event';
  v_done boolean := (NEW.status IN ('compareceu','realizado','fechado'));
  v_was_done boolean := (TG_OP = 'UPDATE' AND OLD.status IN ('compareceu','realizado','fechado'));
  v_cfg record;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF NOT v_done THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND v_was_done THEN RETURN NEW; END IF;

  SELECT enabled, send_appointment_event, appointment_event_name
    INTO v_cfg
    FROM public.tenant_capi_config
   WHERE tenant_id = NEW.tenant_id;
  IF v_cfg IS NULL OR NOT v_cfg.enabled OR NOT v_cfg.send_appointment_event THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := public._internal_dispatch_headers(),
    body := jsonb_build_object(
      'tenant_id', NEW.tenant_id,
      'appointment_id', NEW.id,
      'lead_id', NEW.lead_id,
      'event_name', COALESCE(v_cfg.appointment_event_name, 'Schedule'),
      'event_id', 'appt:' || NEW.id::text
    )
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_fire_capi_on_appointment_done ON public.appointments;
CREATE TRIGGER trg_fire_capi_on_appointment_done
  AFTER INSERT OR UPDATE OF status ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.fire_capi_on_appointment_done();

-- Trigger: nova venda → CAPI Purchase com valor real
CREATE OR REPLACE FUNCTION public.fire_capi_on_sale_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url text := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/facebook-capi-event';
  v_cfg record;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF COALESCE(NEW.amount, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT enabled, send_sale_event, sale_event_name
    INTO v_cfg
    FROM public.tenant_capi_config
   WHERE tenant_id = NEW.tenant_id;
  IF v_cfg IS NULL OR NOT v_cfg.enabled OR NOT v_cfg.send_sale_event THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := public._internal_dispatch_headers(),
    body := jsonb_build_object(
      'tenant_id', NEW.tenant_id,
      'sale_id', NEW.id,
      'lead_id', NEW.lead_id,
      'event_name', COALESCE(v_cfg.sale_event_name, 'Purchase'),
      'lead_value', NEW.amount,
      'event_id', 'sale:' || NEW.id::text
    )
  );
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_fire_capi_on_sale_created ON public.sales;
CREATE TRIGGER trg_fire_capi_on_sale_created
  AFTER INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.fire_capi_on_sale_created();
