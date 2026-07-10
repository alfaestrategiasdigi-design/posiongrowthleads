
-- Trigger: liga appointment ao lead pelo telefone quando lead_id vier nulo
CREATE OR REPLACE FUNCTION public.trg_link_appointment_to_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_lead_id uuid;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  v_phone := public.normalize_phone(NEW.client_phone);
  IF v_phone IS NULL OR length(v_phone) < 8 THEN
    RETURN NEW;
  END IF;
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
  IF v_lead_id IS NOT NULL THEN
    NEW.lead_id := v_lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_appointment_to_lead ON public.appointments;
CREATE TRIGGER trg_link_appointment_to_lead
BEFORE INSERT OR UPDATE OF client_phone, lead_id ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.trg_link_appointment_to_lead();

-- Backfill: liga agendamentos já existentes
UPDATE public.appointments a
   SET lead_id = l.id
  FROM public.leads l
 WHERE a.lead_id IS NULL
   AND a.client_phone IS NOT NULL
   AND l.whatsapp IS NOT NULL
   AND ((a.tenant_id IS NULL AND l.tenant_id IS NULL) OR a.tenant_id = l.tenant_id)
   AND public.normalize_phone(a.client_phone) = public.normalize_phone(l.whatsapp)
   AND length(public.normalize_phone(a.client_phone)) >= 8;
