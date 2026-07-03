
-- Allow N:1 mapping (many pipeline cards → one form lead)
ALTER TABLE public.agency_leads DROP CONSTRAINT IF EXISTS agency_leads_source_lead_id_key;

-- Backfill remaining orphan agency_leads by phone
UPDATE public.agency_leads a
SET source_lead_id = l.id, updated_at = now()
FROM public.leads l
WHERE a.source_lead_id IS NULL
  AND public.normalize_phone(a.whatsapp) IS NOT NULL
  AND length(public.normalize_phone(a.whatsapp)) >= 8
  AND public.normalize_phone(l.whatsapp) = public.normalize_phone(a.whatsapp);

-- Then by email
UPDATE public.agency_leads a
SET source_lead_id = l.id, updated_at = now()
FROM public.leads l
WHERE a.source_lead_id IS NULL
  AND a.email IS NOT NULL AND l.email IS NOT NULL
  AND lower(trim(a.email)) = lower(trim(l.email));

-- Simplify the auto-link trigger now that the unique constraint is gone
CREATE OR REPLACE FUNCTION public.trg_link_agency_lead_to_form_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text; v_lead_id uuid;
BEGIN
  IF NEW.source_lead_id IS NOT NULL THEN RETURN NEW; END IF;
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
  IF v_lead_id IS NOT NULL THEN NEW.source_lead_id := v_lead_id; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.trg_link_form_lead_to_agency_leads()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text;
BEGIN
  v_phone := public.normalize_phone(NEW.whatsapp);
  IF v_phone IS NOT NULL AND length(v_phone) >= 8 THEN
    UPDATE public.agency_leads a
       SET source_lead_id = NEW.id, updated_at = now()
     WHERE a.source_lead_id IS NULL
       AND public.normalize_phone(a.whatsapp) = v_phone;
  END IF;
  IF NEW.email IS NOT NULL AND length(trim(NEW.email))>0 THEN
    UPDATE public.agency_leads a
       SET source_lead_id = NEW.id, updated_at = now()
     WHERE a.source_lead_id IS NULL
       AND lower(trim(a.email)) = lower(trim(NEW.email));
  END IF;
  RETURN NEW;
END; $$;
