CREATE TABLE public.saas_contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'starter',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','trial','past_due','canceled')),
  mrr numeric(12,2) NOT NULL DEFAULT 0,
  billing_cycle text NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly','yearly')),
  started_at date NOT NULL DEFAULT CURRENT_DATE,
  renews_at date,
  canceled_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_saas_contracts_tenant ON public.saas_contracts(tenant_id);
CREATE INDEX idx_saas_contracts_status ON public.saas_contracts(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saas_contracts TO authenticated;
GRANT ALL ON public.saas_contracts TO service_role;

ALTER TABLE public.saas_contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can view all saas contracts" ON public.saas_contracts
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin can insert saas contracts" ON public.saas_contracts
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin can update saas contracts" ON public.saas_contracts
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admin can delete saas contracts" ON public.saas_contracts
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_saas_contracts_updated_at
  BEFORE UPDATE ON public.saas_contracts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();