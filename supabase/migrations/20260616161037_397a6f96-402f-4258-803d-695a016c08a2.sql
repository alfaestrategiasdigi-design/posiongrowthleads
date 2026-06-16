
CREATE TABLE public.posion_contracts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_name TEXT,
  monthly_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  setup_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  start_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','churned')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_posion_contracts_tenant ON public.posion_contracts(tenant_id);
CREATE INDEX idx_posion_contracts_status ON public.posion_contracts(status);
CREATE INDEX idx_posion_contracts_start ON public.posion_contracts(start_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.posion_contracts TO authenticated;
GRANT ALL ON public.posion_contracts TO service_role;

ALTER TABLE public.posion_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage posion_contracts"
  ON public.posion_contracts
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_posion_contracts_updated_at
  BEFORE UPDATE ON public.posion_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
