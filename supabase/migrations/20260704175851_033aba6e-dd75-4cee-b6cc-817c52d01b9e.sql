DROP INDEX IF EXISTS public.agency_leads_source_lead_id_key;
CREATE UNIQUE INDEX agency_leads_source_lead_id_key
  ON public.agency_leads (source_lead_id);