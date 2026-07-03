
ALTER TABLE public.agency_leads
  ADD COLUMN IF NOT EXISTS source_lead_id uuid UNIQUE REFERENCES public.leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agency_leads_source_lead_id ON public.agency_leads(source_lead_id);

CREATE OR REPLACE FUNCTION public.map_lead_status_to_stage(_status text)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE lower(coalesce(_status,''))
    WHEN 'ganho' THEN 'ganho'
    WHEN 'perdido' THEN 'perdido'
    WHEN 'qualificado' THEN 'qualificado'
    WHEN 'reuniao' THEN 'reuniao'
    WHEN 'proposta' THEN 'proposta'
    WHEN 'negociacao' THEN 'negociacao'
    ELSE 'lead'
  END;
$$;

CREATE OR REPLACE FUNCTION public.trg_mirror_lead_to_agency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nome  text;
  v_stage text;
  v_cid   text;
  v_uf    text;
BEGIN
  v_nome  := COALESCE(NULLIF(trim(COALESCE(NEW.nome_empresa, NEW.nome_completo)), ''), 'Lead sem nome');
  v_stage := public.map_lead_status_to_stage(NEW.status);
  -- split "Cidade / UF" or "Cidade - UF" or "Cidade, UF"
  v_cid := split_part(regexp_replace(coalesce(NEW.cidade_estado,''), '\s*[-/,]\s*', '|'), '|', 1);
  v_uf  := split_part(regexp_replace(coalesce(NEW.cidade_estado,''), '\s*[-/,]\s*', '|'), '|', 2);
  IF length(v_uf) > 2 THEN v_uf := substr(v_uf,1,2); END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.agency_leads (
      nome_clinica, responsavel, whatsapp, email, cidade, estado,
      origem, stage, valor_proposta, notas, utm_campaign, source_lead_id
    ) VALUES (
      v_nome, NEW.nome_completo, NEW.whatsapp, NEW.email, NULLIF(v_cid,''), NULLIF(upper(v_uf),''),
      COALESCE(NEW.origem, 'formulario'), v_stage, NEW.valor_proposta, NEW.observacoes, NEW.utm_campaign, NEW.id
    )
    ON CONFLICT (source_lead_id) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.agency_leads SET
      nome_clinica   = v_nome,
      responsavel    = NEW.nome_completo,
      whatsapp       = NEW.whatsapp,
      email          = NEW.email,
      cidade         = NULLIF(v_cid,''),
      estado         = NULLIF(upper(v_uf),''),
      valor_proposta = NEW.valor_proposta,
      notas          = NEW.observacoes,
      utm_campaign   = NEW.utm_campaign,
      stage          = v_stage,
      ganho_at       = CASE WHEN v_stage = 'ganho' AND ganho_at IS NULL THEN now() ELSE ganho_at END,
      updated_at     = now()
    WHERE source_lead_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mirror_lead_to_agency_ins ON public.leads;
CREATE TRIGGER mirror_lead_to_agency_ins
AFTER INSERT ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_lead_to_agency();

DROP TRIGGER IF EXISTS mirror_lead_to_agency_upd ON public.leads;
CREATE TRIGGER mirror_lead_to_agency_upd
AFTER UPDATE OF nome_completo, nome_empresa, whatsapp, email, cidade_estado, valor_proposta, observacoes, utm_campaign, status ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_mirror_lead_to_agency();

-- Backfill
INSERT INTO public.agency_leads (
  nome_clinica, responsavel, whatsapp, email, cidade, estado,
  origem, stage, valor_proposta, notas, utm_campaign, source_lead_id, created_at
)
SELECT
  COALESCE(NULLIF(trim(COALESCE(l.nome_empresa, l.nome_completo)), ''), 'Lead sem nome'),
  l.nome_completo, l.whatsapp, l.email,
  NULLIF(split_part(regexp_replace(coalesce(l.cidade_estado,''), '\s*[-/,]\s*', '|'), '|', 1),''),
  NULLIF(upper(substr(split_part(regexp_replace(coalesce(l.cidade_estado,''), '\s*[-/,]\s*', '|'), '|', 2),1,2)),''),
  COALESCE(l.origem, 'formulario'),
  public.map_lead_status_to_stage(l.status),
  l.valor_proposta, l.observacoes, l.utm_campaign, l.id, l.created_at
FROM public.leads l
LEFT JOIN public.agency_leads a ON a.source_lead_id = l.id
WHERE a.id IS NULL;
