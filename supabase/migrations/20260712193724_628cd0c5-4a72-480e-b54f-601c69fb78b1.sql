CREATE OR REPLACE FUNCTION public.trg_link_agency_lead_to_form_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_lead_id uuid;
BEGIN
  -- Já vinculado: nada a fazer
  IF NEW.source_lead_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Desvínculo explícito (ex.: cascata ON DELETE SET NULL do lead-origem):
  -- não tentar religar, respeitar o NULL.
  IF TG_OP = 'UPDATE' AND OLD.source_lead_id IS NOT NULL AND NEW.source_lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_phone := public.normalize_phone(NEW.whatsapp);
  IF v_phone IS NOT NULL AND length(v_phone) >= 8 THEN
    SELECT id INTO v_lead_id FROM public.leads
     WHERE public.normalize_phone(whatsapp) = v_phone
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_lead_id IS NULL AND NEW.email IS NOT NULL AND length(trim(NEW.email))>0 THEN
    SELECT id INTO v_lead_id FROM public.leads
     WHERE lower(trim(email)) = lower(trim(NEW.email))
     ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_lead_id IS NOT NULL THEN
    -- Evita colisão com o índice único: só linka se ninguém mais estiver usando esse source_lead_id.
    IF NOT EXISTS (SELECT 1 FROM public.agency_leads WHERE source_lead_id = v_lead_id AND id <> NEW.id) THEN
      NEW.source_lead_id := v_lead_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;