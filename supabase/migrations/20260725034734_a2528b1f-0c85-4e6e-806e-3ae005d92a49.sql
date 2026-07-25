
-- 1. FK sales.lead_id -> leads(id) if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_lead_id_fkey'
      AND conrelid = 'public.sales'::regclass
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_lead_id_fkey
      FOREIGN KEY (lead_id) REFERENCES public.leads(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_lead_id ON public.sales(lead_id) WHERE lead_id IS NOT NULL;

-- 2. Promote lead to 'ativo' when a sale with lead_id is created
CREATE OR REPLACE FUNCTION public.trg_promote_lead_to_ativo_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads
       SET status = 'ativo',
           fechado_em = COALESCE(fechado_em, COALESCE(NEW.sale_date::timestamptz, now())),
           valor_proposta = CASE WHEN COALESCE(valor_proposta,0) = 0 THEN NEW.amount ELSE valor_proposta END
     WHERE id = NEW.lead_id
       AND (tenant_id IS NOT DISTINCT FROM NEW.tenant_id)
       AND status IS DISTINCT FROM 'ativo';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_promote_lead_ativo ON public.sales;
CREATE TRIGGER trg_sales_promote_lead_ativo
AFTER INSERT ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.trg_promote_lead_to_ativo_on_sale();
