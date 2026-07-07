
ALTER TABLE public.automation_executions
  ADD COLUMN IF NOT EXISTS steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS next_node text,
  ADD COLUMN IF NOT EXISTS resume_token text,
  ADD COLUMN IF NOT EXISTS trigger_type text,
  ADD COLUMN IF NOT EXISTS context jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS automation_executions_resume_idx
  ON public.automation_executions (tenant_id, contact_phone, status)
  WHERE status = 'waiting_response';

CREATE INDEX IF NOT EXISTS automation_executions_wait_until_idx
  ON public.automation_executions (wait_until)
  WHERE status = 'waiting_delay';

-- Fire the automation dispatcher via pg_net on new leads (form_submitted / lead_entered).
CREATE OR REPLACE FUNCTION public.fire_automation_dispatch()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text := 'https://mbhbflbuawkmtmpjazcj.supabase.co/functions/v1/automation-dispatch';
  v_trigger text;
BEGIN
  IF TG_TABLE_NAME = 'leads' THEN
    IF TG_OP = 'INSERT' THEN
      v_trigger := CASE WHEN COALESCE(NEW.origem,'') ILIKE 'facebook%' THEN 'lead_entered' ELSE 'form_submitted' END;
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type','application/json'),
        body := jsonb_build_object(
          'trigger', v_trigger,
          'tenant_id', NEW.tenant_id,
          'context', jsonb_build_object(
            'lead_id', NEW.id,
            'phone', NEW.whatsapp,
            'name', NEW.nome_completo,
            'email', NEW.email,
            'form_name', NEW.facebook_form_name,
            'origem', NEW.origem
          )
        )
      );
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type','application/json'),
        body := jsonb_build_object(
          'trigger', 'kanban_moved',
          'tenant_id', NEW.tenant_id,
          'context', jsonb_build_object(
            'lead_id', NEW.id,
            'phone', NEW.whatsapp,
            'name', NEW.nome_completo,
            'from_status', OLD.status,
            'to_status', NEW.status
          )
        )
      );
      IF NEW.status = 'ganho' THEN
        PERFORM net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type','application/json'),
          body := jsonb_build_object(
            'trigger', 'lead_won',
            'tenant_id', NEW.tenant_id,
            'context', jsonb_build_object(
              'lead_id', NEW.id,
              'phone', NEW.whatsapp,
              'name', NEW.nome_completo,
              'valor', NEW.valor_proposta
            )
          )
        );
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'appointments' THEN
    IF TG_OP = 'INSERT' THEN
      PERFORM net.http_post(
        url := v_url,
        headers := jsonb_build_object('Content-Type','application/json'),
        body := jsonb_build_object(
          'trigger', 'appointment_created',
          'tenant_id', NEW.tenant_id,
          'context', jsonb_build_object(
            'appointment_id', NEW.id,
            'lead_id', NEW.lead_id,
            'phone', NEW.client_phone,
            'name', NEW.client_name,
            'date_time', NEW.date_time
          )
        )
      );
    ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status IN ('confirmado','compareceu') THEN
        PERFORM net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type','application/json'),
          body := jsonb_build_object(
            'trigger', 'appointment_confirmed',
            'tenant_id', NEW.tenant_id,
            'context', jsonb_build_object('appointment_id', NEW.id, 'lead_id', NEW.lead_id, 'phone', NEW.client_phone, 'name', NEW.client_name)
          )
        );
      ELSIF NEW.status = 'cancelado' THEN
        PERFORM net.http_post(
          url := v_url,
          headers := jsonb_build_object('Content-Type','application/json'),
          body := jsonb_build_object(
            'trigger', 'appointment_cancelled',
            'tenant_id', NEW.tenant_id,
            'context', jsonb_build_object('appointment_id', NEW.id, 'lead_id', NEW.lead_id, 'phone', NEW.client_phone, 'name', NEW.client_name)
          )
        );
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fire_automation_lead ON public.leads;
CREATE TRIGGER trg_fire_automation_lead
AFTER INSERT OR UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.fire_automation_dispatch();

DROP TRIGGER IF EXISTS trg_fire_automation_appt ON public.appointments;
CREATE TRIGGER trg_fire_automation_appt
AFTER INSERT OR UPDATE ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.fire_automation_dispatch();
