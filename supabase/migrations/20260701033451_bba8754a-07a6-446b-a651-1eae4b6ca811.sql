
CREATE TABLE public.agency_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_clinica text NOT NULL,
  responsavel text,
  whatsapp text,
  email text,
  cidade text,
  estado text,
  origem text DEFAULT 'inbound',
  stage text NOT NULL DEFAULT 'lead',
  valor_proposta numeric(12,2) DEFAULT 0,
  plano_interesse text,
  proximo_followup timestamptz,
  owner_id uuid,
  notas text,
  tags text[] DEFAULT '{}',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  campaign_id text,
  ad_id text,
  form_id text,
  ganho_at timestamptz,
  perdido_motivo text,
  tenant_id_criado uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_leads_stage_check CHECK (stage IN ('lead','qualificado','reuniao','proposta','negociacao','ganho','perdido'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_leads TO authenticated;
GRANT ALL ON public.agency_leads TO service_role;
ALTER TABLE public.agency_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage agency leads" ON public.agency_leads
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_agency_leads_stage ON public.agency_leads(stage);
CREATE INDEX idx_agency_leads_created ON public.agency_leads(created_at DESC);
CREATE TRIGGER trg_agency_leads_updated
  BEFORE UPDATE ON public.agency_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.agency_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_lead_id uuid REFERENCES public.agency_leads(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  cliente_nome text NOT NULL,
  valor_total numeric(12,2) NOT NULL DEFAULT 0,
  valor_comissao numeric(12,2) DEFAULT 0,
  duracao_meses int DEFAULT 12,
  data_assinatura date NOT NULL DEFAULT CURRENT_DATE,
  status text NOT NULL DEFAULT 'ativo',
  observacoes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agency_contracts_status_check CHECK (status IN ('ativo','pausado','encerrado','cancelado'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agency_contracts TO authenticated;
GRANT ALL ON public.agency_contracts TO service_role;
ALTER TABLE public.agency_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage agency contracts" ON public.agency_contracts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX idx_agency_contracts_tenant ON public.agency_contracts(tenant_id);
CREATE INDEX idx_agency_contracts_assinatura ON public.agency_contracts(data_assinatura DESC);
CREATE TRIGGER trg_agency_contracts_updated
  BEFORE UPDATE ON public.agency_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.tenant_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  categoria text,
  preco_sugerido numeric(12,2) DEFAULT 0,
  duracao_min int DEFAULT 60,
  ativo boolean NOT NULL DEFAULT true,
  ordem int DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_products TO authenticated;
GRANT ALL ON public.tenant_products TO service_role;
ALTER TABLE public.tenant_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant users read products" ON public.tenant_products
  FOR SELECT TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY "Tenant admins manage products" ON public.tenant_products
  FOR ALL TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));
CREATE INDEX idx_tenant_products_tenant ON public.tenant_products(tenant_id, ativo);
CREATE TRIGGER trg_tenant_products_updated
  BEFORE UPDATE ON public.tenant_products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.promote_agency_lead_to_tenant(
  p_lead_id uuid,
  p_slug text,
  p_plano text DEFAULT 'starter',
  p_valor numeric DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.agency_leads;
  v_tenant_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can promote leads';
  END IF;
  SELECT * INTO v_lead FROM public.agency_leads WHERE id = p_lead_id;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;
  INSERT INTO public.tenants (name, slug, active)
  VALUES (v_lead.nome_clinica, p_slug, true)
  RETURNING id INTO v_tenant_id;
  INSERT INTO public.agency_contracts (agency_lead_id, tenant_id, cliente_nome, valor_total, data_assinatura, status)
  VALUES (p_lead_id, v_tenant_id, v_lead.nome_clinica, COALESCE(p_valor, v_lead.valor_proposta, 0), CURRENT_DATE, 'ativo');
  UPDATE public.agency_leads
     SET stage = 'ganho', ganho_at = now(), tenant_id_criado = v_tenant_id, updated_at = now()
   WHERE id = p_lead_id;
  RETURN v_tenant_id;
END;
$$;

INSERT INTO public.agency_leads (
  nome_clinica, responsavel, whatsapp, email,
  origem, stage, valor_proposta, notas,
  utm_source, utm_medium, utm_campaign, campaign_id, form_id,
  created_at, updated_at
)
SELECT
  COALESCE(cl.full_name, 'Sem nome'),
  cl.full_name,
  cl.whatsapp,
  cl.email,
  COALESCE(cl.channel, 'inbound'),
  CASE
    WHEN cl.stage = 'ganho' THEN 'ganho'
    WHEN cl.stage = 'perdido' THEN 'perdido'
    WHEN cl.stage = 'negociacao' THEN 'negociacao'
    WHEN cl.stage IN ('reuniao_agendada','consulta_agendada','compareceu') THEN 'reuniao'
    WHEN cl.stage = 'qualificado' THEN 'qualificado'
    ELSE 'lead'
  END,
  COALESCE(cl.sale_amount, cl.negotiation_value, 0),
  cl.notes,
  cl.utm_source, cl.utm_medium, cl.utm_campaign,
  cl.facebook_campaign_id, cl.facebook_lead_id,
  cl.created_at, cl.updated_at
FROM public.clinic_leads cl
WHERE cl.tenant_id IS NULL;
