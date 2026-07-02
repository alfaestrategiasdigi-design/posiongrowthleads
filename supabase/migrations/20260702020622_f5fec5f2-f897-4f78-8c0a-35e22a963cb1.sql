
-- 1) Função que cria uma venda quando lead vira "ganho"
CREATE OR REPLACE FUNCTION public.trg_create_sale_on_lead_ganho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'ganho'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ganho')
     AND NEW.tenant_id IS NOT NULL
  THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.sales
      WHERE tenant_id = NEW.tenant_id
        AND metadata->>'lead_id' = NEW.id::text
    ) THEN
      INSERT INTO public.sales (
        tenant_id, patient_name, seller_name, product, category, channel,
        amount, amount_paid, sale_date, first_contact_date, international,
        notes, channel_origin, facebook_campaign_id, utm_source, utm_campaign, metadata
      ) VALUES (
        NEW.tenant_id,
        COALESCE(NEW.nome_completo, 'Lead'),
        NULL,
        COALESCE(NEW.especialidade, NEW.facebook_form_name),
        NULL,
        COALESCE(NEW.origem, 'kanban'),
        COALESCE(NEW.valor_proposta, 0),
        0,
        COALESCE(NEW.fechado_em::date, CURRENT_DATE),
        NULL,
        false,
        NEW.observacoes,
        NEW.origem,
        NEW.facebook_campaign,
        NEW.utm_source,
        NEW.utm_campaign,
        jsonb_build_object('lead_id', NEW.id, 'source', 'lead_kanban_ganho')
      );
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_create_sale_on_lead_ganho ON public.leads;
CREATE TRIGGER trg_create_sale_on_lead_ganho
  AFTER INSERT OR UPDATE OF status ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_create_sale_on_lead_ganho();

-- 2) Backfill: leads que já estão em "ganho" mas sem venda registrada
INSERT INTO public.sales (
  tenant_id, patient_name, seller_name, product, category, channel,
  amount, amount_paid, sale_date, first_contact_date, international,
  notes, channel_origin, facebook_campaign_id, utm_source, utm_campaign, metadata
)
SELECT
  l.tenant_id,
  COALESCE(l.nome_completo, 'Lead'),
  NULL, COALESCE(l.especialidade, l.facebook_form_name), NULL,
  COALESCE(l.origem, 'kanban'),
  COALESCE(l.valor_proposta, 0), 0,
  COALESCE(l.fechado_em::date, CURRENT_DATE),
  NULL, false, l.observacoes, l.origem, l.facebook_campaign, l.utm_source, l.utm_campaign,
  jsonb_build_object('lead_id', l.id, 'source', 'lead_kanban_ganho_backfill')
FROM public.leads l
WHERE l.status = 'ganho'
  AND l.tenant_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.sales s
    WHERE s.tenant_id = l.tenant_id AND s.metadata->>'lead_id' = l.id::text
  );
