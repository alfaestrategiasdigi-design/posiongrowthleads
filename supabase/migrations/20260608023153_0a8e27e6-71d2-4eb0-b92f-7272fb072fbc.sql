
-- ============ PROCEDURES ============
CREATE TABLE public.procedures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL,
  ticket_min numeric,
  ticket_max numeric,
  ticket_avg numeric,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.procedures TO authenticated;
GRANT ALL ON public.procedures TO service_role;
ALTER TABLE public.procedures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can manage procedures"
  ON public.procedures FOR ALL TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));
CREATE TRIGGER trg_procedures_updated_at BEFORE UPDATE ON public.procedures
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX procedures_tenant_idx ON public.procedures(tenant_id);

-- ============ CLINIC LEADS ============
CREATE TABLE public.clinic_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  whatsapp text NOT NULL,
  channel text,
  seller_name text,
  procedure_interest text,
  stage text NOT NULL DEFAULT 'contato_iniciado',
  first_contact_date date,
  evaluation_date date,
  attended text, -- 'SIM' | 'NAO' | 'FUTURA'
  payment_method text,
  sale_amount numeric,
  notes text,
  international boolean NOT NULL DEFAULT false,
  arrival_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_leads TO authenticated;
GRANT ALL ON public.clinic_leads TO service_role;
ALTER TABLE public.clinic_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant members can manage clinic leads"
  ON public.clinic_leads FOR ALL TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));
CREATE TRIGGER trg_clinic_leads_updated_at BEFORE UPDATE ON public.clinic_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX clinic_leads_tenant_stage_idx ON public.clinic_leads(tenant_id, stage);
