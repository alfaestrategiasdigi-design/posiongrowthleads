
ALTER TABLE public.founder_slots
  ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES public.tenant_custom_offers(id) ON DELETE SET NULL;
