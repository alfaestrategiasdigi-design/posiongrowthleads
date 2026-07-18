
-- 1) Extend link trigger: match by phone → then by exact name → else auto-create lead
CREATE OR REPLACE FUNCTION public.trg_link_appointment_to_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_phone text;
  v_name  text;
  v_lead_id uuid;
  v_match_count int;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_phone := public.normalize_phone(NEW.client_phone);
  v_name  := NULLIF(trim(NEW.client_name), '');

  -- Match by phone
  IF v_phone IS NOT NULL AND length(v_phone) >= 8 THEN
    IF NEW.tenant_id IS NULL THEN
      SELECT id INTO v_lead_id FROM public.leads
       WHERE tenant_id IS NULL
         AND public.normalize_phone(whatsapp) = v_phone
       ORDER BY created_at DESC LIMIT 1;
    ELSE
      SELECT id INTO v_lead_id FROM public.leads
       WHERE tenant_id = NEW.tenant_id
         AND public.normalize_phone(whatsapp) = v_phone
       ORDER BY created_at DESC LIMIT 1;
    END IF;
  END IF;

  -- Fallback: match by exact name within tenant, only if exactly one match
  IF v_lead_id IS NULL AND v_name IS NOT NULL AND NEW.tenant_id IS NOT NULL AND length(v_name) >= 3 THEN
    SELECT count(*) INTO v_match_count FROM public.leads
     WHERE tenant_id = NEW.tenant_id
       AND lower(trim(nome_completo)) = lower(v_name);
    IF v_match_count = 1 THEN
      SELECT id INTO v_lead_id FROM public.leads
       WHERE tenant_id = NEW.tenant_id
         AND lower(trim(nome_completo)) = lower(v_name)
       LIMIT 1;
    END IF;
  END IF;

  -- Auto-create lead if still not found (tenant scope only)
  IF v_lead_id IS NULL AND NEW.tenant_id IS NOT NULL AND v_name IS NOT NULL THEN
    INSERT INTO public.leads (
      tenant_id, nome_completo, whatsapp, origem, status,
      reuniao_agendada_em
    ) VALUES (
      NEW.tenant_id, v_name, COALESCE(NEW.client_phone, ''),
      'agenda', 'reuniao_agendada',
      NEW.date_time
    )
    RETURNING id INTO v_lead_id;
  END IF;

  IF v_lead_id IS NOT NULL THEN
    NEW.lead_id := v_lead_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Sync lead stage from appointment status/date changes
CREATE OR REPLACE FUNCTION public.trg_sync_lead_stage_from_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.leads;
  v_has_future boolean;
BEGIN
  IF NEW.lead_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  IF v_lead IS NULL THEN RETURN NEW; END IF;

  -- Newly scheduled / rescheduled
  IF NEW.status IN ('agendado','confirmado','reagendado') THEN
    IF TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.date_time IS DISTINCT FROM NEW.date_time THEN
      UPDATE public.leads
         SET reuniao_agendada_em = NEW.date_time,
             status = CASE
                        WHEN status IN ('lead','qualificado','agendar_reuniao') THEN 'reuniao_agendada'
                        ELSE status
                      END
       WHERE id = NEW.lead_id;
    END IF;
  END IF;

  -- Attended → promote to proposta if earlier in funnel
  IF NEW.status IN ('compareceu','realizado','fechado')
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    UPDATE public.leads
       SET reuniao_realizada_em = COALESCE(reuniao_realizada_em, NEW.date_time),
           status = CASE
                      WHEN status IN ('lead','qualificado','agendar_reuniao','reuniao_agendada') THEN 'proposta'
                      ELSE status
                    END
     WHERE id = NEW.lead_id;
  END IF;

  -- Cancelled → clear reuniao_agendada_em only if no other future non-cancelled appointment
  IF NEW.status = 'cancelado'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.appointments
       WHERE lead_id = NEW.lead_id
         AND id <> NEW.id
         AND status NOT IN ('cancelado','no_show')
         AND date_time >= now()
    ) INTO v_has_future;
    IF NOT v_has_future THEN
      UPDATE public.leads SET reuniao_agendada_em = NULL WHERE id = NEW.lead_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_lead_stage_from_appointment ON public.appointments;
CREATE TRIGGER trg_sync_lead_stage_from_appointment
AFTER INSERT OR UPDATE OF status, date_time, lead_id ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_lead_stage_from_appointment();
