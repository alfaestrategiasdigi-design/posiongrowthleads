ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS utm_content text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS utm_term text;
CREATE INDEX IF NOT EXISTS idx_leads_utm_content ON public.leads(utm_content);
CREATE INDEX IF NOT EXISTS idx_leads_utm_term ON public.leads(utm_term);