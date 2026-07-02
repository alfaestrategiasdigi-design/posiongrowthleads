
CREATE OR REPLACE FUNCTION public.trg_sync_sale_on_lead_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='public' AS $$
BEGIN
  IF NEW.status='ganho' AND NEW.tenant_id IS NOT NULL
     AND NEW.valor_proposta IS DISTINCT FROM OLD.valor_proposta THEN
    UPDATE public.sales
       SET amount = COALESCE(NEW.valor_proposta,0)
     WHERE tenant_id = NEW.tenant_id
       AND metadata->>'lead_id' = NEW.id::text;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_sync_sale_on_lead_update ON public.leads;
CREATE TRIGGER trg_sync_sale_on_lead_update
AFTER UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_sale_on_lead_update();
