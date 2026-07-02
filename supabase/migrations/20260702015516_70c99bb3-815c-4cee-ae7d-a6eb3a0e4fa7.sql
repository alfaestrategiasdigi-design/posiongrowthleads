
CREATE OR REPLACE FUNCTION public.trg_create_contract_on_ganho()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.stage = 'ganho' AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'ganho') THEN
    IF NOT EXISTS (SELECT 1 FROM public.agency_contracts WHERE agency_lead_id = NEW.id) THEN
      INSERT INTO public.agency_contracts (
        agency_lead_id, tenant_id, cliente_nome, valor_total, valor_comissao,
        duracao_meses, data_assinatura, status, observacoes
      ) VALUES (
        NEW.id, NEW.tenant_id_criado,
        COALESCE(NEW.nome_clinica, NEW.responsavel, 'Cliente'),
        COALESCE(NEW.valor_proposta, 0), 0, 12,
        COALESCE(NEW.ganho_at::date, CURRENT_DATE), 'ativo', NEW.notas
      );
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_create_contract_on_ganho ON public.agency_leads;
CREATE TRIGGER trg_create_contract_on_ganho
AFTER INSERT OR UPDATE OF stage ON public.agency_leads
FOR EACH ROW EXECUTE FUNCTION public.trg_create_contract_on_ganho();

INSERT INTO public.agency_contracts (
  agency_lead_id, tenant_id, cliente_nome, valor_total, valor_comissao,
  duracao_meses, data_assinatura, status, observacoes
)
SELECT l.id, l.tenant_id_criado,
       COALESCE(l.nome_clinica, l.responsavel, 'Cliente'),
       COALESCE(l.valor_proposta, 0), 0, 12,
       COALESCE(l.ganho_at::date, CURRENT_DATE), 'ativo', l.notas
FROM public.agency_leads l
LEFT JOIN public.agency_contracts c ON c.agency_lead_id = l.id
WHERE l.stage = 'ganho' AND c.id IS NULL;
