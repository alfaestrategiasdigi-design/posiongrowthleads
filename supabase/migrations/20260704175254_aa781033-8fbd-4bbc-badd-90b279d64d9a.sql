-- Fix: trigger trg_mirror_lead_to_agency usa ON CONFLICT (source_lead_id) mas
-- não havia constraint UNIQUE. Isso quebrava inserts em public.leads
-- (import histórico do Facebook Ads).
-- Deduplica registros antes de criar o índice único.
DELETE FROM public.agency_leads a
USING public.agency_leads b
WHERE a.source_lead_id IS NOT NULL
  AND a.source_lead_id = b.source_lead_id
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS agency_leads_source_lead_id_key
  ON public.agency_leads (source_lead_id)
  WHERE source_lead_id IS NOT NULL;