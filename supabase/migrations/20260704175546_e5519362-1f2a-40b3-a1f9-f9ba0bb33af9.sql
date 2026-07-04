ALTER TABLE public.lead_routing_rules
  ADD COLUMN IF NOT EXISTS page_id text,
  ADD COLUMN IF NOT EXISTS page_name text;

CREATE INDEX IF NOT EXISTS idx_lead_routing_rules_page_id
  ON public.lead_routing_rules (page_id) WHERE page_id IS NOT NULL;