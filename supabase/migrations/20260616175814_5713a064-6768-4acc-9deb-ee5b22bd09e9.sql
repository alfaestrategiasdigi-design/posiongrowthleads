
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS facebook_form_name text,
  ADD COLUMN IF NOT EXISTS facebook_ad_name text,
  ADD COLUMN IF NOT EXISTS facebook_adset_name text;

CREATE UNIQUE INDEX IF NOT EXISTS leads_facebook_lead_id_unique
  ON public.leads (facebook_lead_id)
  WHERE facebook_lead_id IS NOT NULL;
