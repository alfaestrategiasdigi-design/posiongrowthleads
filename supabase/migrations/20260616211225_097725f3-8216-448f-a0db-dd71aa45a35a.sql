ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS is_organic boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_leads_is_organic ON public.leads(is_organic) WHERE is_organic = true;