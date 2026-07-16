
-- Add pause metadata columns to automation_flows
ALTER TABLE public.automation_flows
  ADD COLUMN IF NOT EXISTS paused_reason text,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS previous_status text;

-- Update the fire_automation_dispatch trigger to only fire form_submitted for FRESH leads
-- (created less than 10 minutes ago) — prevents backfills/imports from re-triggering welcome flows.
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
  v_is_fresh boolean;
BEGIN
  IF TG_TABLE_NAME = 'leads' THEN
    IF TG_OP = 'INSERT' THEN
      -- Guard: only fire form_submitted / lead_entered for recently-created leads.
      -- Blocks backfills, imports, and re-inserts from spamming welcome messages.
      v_is_fresh := (COALESCE(NEW.created_at, now()) > now() - interval '10 minutes');
      IF NOT v_is_fresh THEN
        RETURN NEW;
      END IF;
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
