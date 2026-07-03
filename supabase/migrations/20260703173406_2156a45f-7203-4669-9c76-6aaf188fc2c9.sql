
-- 1) Backfill by phone, only when the form lead has no agency_lead yet (respects unique constraint)
WITH candidates AS (
  SELECT DISTINCT ON (l.id) a.id AS agency_id, l.id AS lead_id
  FROM public.agency_leads a
  JOIN public.leads l
    ON public.normalize_phone(l.whatsapp) = public.normalize_phone(a.whatsapp)
   AND public.normalize_phone(a.whatsapp) IS NOT NULL
   AND length(public.normalize_phone(a.whatsapp)) >= 8
  WHERE a.source_lead_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.agency_leads a2 WHERE a2.source_lead_id = l.id)
  ORDER BY l.id, a.created_at ASC
)
UPDATE public.agency_leads a
SET source_lead_id = c.lead_id, updated_at = now()
FROM candidates c
WHERE a.id = c.agency_id;

-- 2) Backfill by email for the remainder
WITH candidates AS (
  SELECT DISTINCT ON (l.id) a.id AS agency_id, l.id AS lead_id
  FROM public.agency_leads a
  JOIN public.leads l
    ON lower(trim(l.email)) = lower(trim(a.email))
   AND a.email IS NOT NULL AND l.email IS NOT NULL
  WHERE a.source_lead_id IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.agency_leads a2 WHERE a2.source_lead_id = l.id)
  ORDER BY l.id, a.created_at ASC
)
UPDATE public.agency_leads a
SET source_lead_id = c.lead_id, updated_at = now()
FROM candidates c
WHERE a.id = c.agency_id;

-- 3) BEFORE trigger on agency_leads: auto-link source_lead_id when missing, only if form lead is free
CREATE OR REPLACE FUNCTION public.trg_link_agency_lead_to_form_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text; v_lead_id uuid;
BEGIN
  IF NEW.source_lead_id IS NOT NULL THEN RETURN NEW; END IF;
  v_phone := public.normalize_phone(NEW.whatsapp);
  IF v_phone IS NOT NULL AND length(v_phone) >= 8 THEN
    SELECT l.id INTO v_lead_id FROM public.leads l
     WHERE public.normalize_phone(l.whatsapp) = v_phone
       AND NOT EXISTS (SELECT 1 FROM public.agency_leads a2 WHERE a2.source_lead_id = l.id)
     ORDER BY l.created_at DESC LIMIT 1;
  END IF;
  IF v_lead_id IS NULL AND NEW.email IS NOT NULL AND length(trim(NEW.email))>0 THEN
    SELECT l.id INTO v_lead_id FROM public.leads l
     WHERE lower(trim(l.email)) = lower(trim(NEW.email))
       AND NOT EXISTS (SELECT 1 FROM public.agency_leads a2 WHERE a2.source_lead_id = l.id)
     ORDER BY l.created_at DESC LIMIT 1;
  END IF;
  IF v_lead_id IS NOT NULL THEN NEW.source_lead_id := v_lead_id; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_link_agency_lead_to_form_lead ON public.agency_leads;
CREATE TRIGGER trg_link_agency_lead_to_form_lead
BEFORE INSERT OR UPDATE OF whatsapp, email, source_lead_id ON public.agency_leads
FOR EACH ROW EXECUTE FUNCTION public.trg_link_agency_lead_to_form_lead();

-- 4) AFTER trigger on leads: fill orphan agency_leads pointing to this lead if none exists yet
CREATE OR REPLACE FUNCTION public.trg_link_form_lead_to_agency_leads()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone text; v_target uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.agency_leads a WHERE a.source_lead_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  v_phone := public.normalize_phone(NEW.whatsapp);
  IF v_phone IS NOT NULL AND length(v_phone) >= 8 THEN
    SELECT id INTO v_target FROM public.agency_leads
     WHERE source_lead_id IS NULL AND public.normalize_phone(whatsapp) = v_phone
     ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_target IS NULL AND NEW.email IS NOT NULL AND length(trim(NEW.email))>0 THEN
    SELECT id INTO v_target FROM public.agency_leads
     WHERE source_lead_id IS NULL AND lower(trim(email)) = lower(trim(NEW.email))
     ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_target IS NOT NULL THEN
    UPDATE public.agency_leads SET source_lead_id = NEW.id, updated_at = now() WHERE id = v_target;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_link_form_lead_to_agency_leads ON public.leads;
CREATE TRIGGER trg_link_form_lead_to_agency_leads
AFTER INSERT OR UPDATE OF whatsapp, email ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_link_form_lead_to_agency_leads();

-- 5) Indexes
CREATE INDEX IF NOT EXISTS idx_agency_leads_source_lead_id ON public.agency_leads(source_lead_id);
CREATE INDEX IF NOT EXISTS idx_agency_leads_phone_norm ON public.agency_leads (public.normalize_phone(whatsapp));
CREATE INDEX IF NOT EXISTS idx_agency_leads_email_lower ON public.agency_leads (lower(email));
