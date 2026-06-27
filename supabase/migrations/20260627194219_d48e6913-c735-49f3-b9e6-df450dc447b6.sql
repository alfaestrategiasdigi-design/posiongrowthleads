
-- Catálogo de planos editável pelo Admin Master
CREATE TABLE public.plan_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,                  -- starter | pro | scale
  interval TEXT NOT NULL,              -- month | quarter
  name TEXT NOT NULL,
  description TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'brl',
  lookup_key TEXT NOT NULL UNIQUE,     -- ex: posion_pro_month_v2 (versionado quando preço muda)
  stripe_price_id TEXT,                -- preenchido pelo backend após criação no Stripe
  stripe_product_id TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, interval, active) DEFERRABLE INITIALLY DEFERRED
);

GRANT SELECT ON public.plan_catalog TO authenticated;
GRANT SELECT ON public.plan_catalog TO anon;
GRANT ALL ON public.plan_catalog TO service_role;

ALTER TABLE public.plan_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plan_catalog read all authenticated"
  ON public.plan_catalog FOR SELECT TO authenticated USING (true);

CREATE POLICY "plan_catalog admin manage"
  ON public.plan_catalog FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER plan_catalog_updated
  BEFORE UPDATE ON public.plan_catalog
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Assinaturas por tenant (uma ativa por tenant)
CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  plan_code TEXT NOT NULL,             -- starter | pro | scale
  interval TEXT NOT NULL,              -- month | quarter
  lookup_key TEXT,                     -- referência ao plan_catalog.lookup_key
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'incomplete', -- active|trialing|past_due|canceled|incomplete|paused
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  amount_cents INTEGER,
  currency TEXT DEFAULT 'brl',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_subscriptions_tenant ON public.subscriptions(tenant_id);
CREATE INDEX idx_subscriptions_status ON public.subscriptions(status);

GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Tenant users e admin master podem ver a assinatura do tenant
CREATE POLICY "subscriptions tenant read"
  ON public.subscriptions FOR SELECT TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "subscriptions admin manage"
  ON public.subscriptions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER subscriptions_updated
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Histórico de pagamentos por tenant
CREATE TABLE public.subscription_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  stripe_invoice_id TEXT UNIQUE,
  stripe_customer_id TEXT,
  amount_paid_cents INTEGER,
  amount_due_cents INTEGER,
  currency TEXT,
  status TEXT,                         -- paid|open|void|uncollectible|draft
  hosted_invoice_url TEXT,
  invoice_pdf TEXT,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sub_invoices_tenant ON public.subscription_invoices(tenant_id);
CREATE INDEX idx_sub_invoices_sub ON public.subscription_invoices(subscription_id);

GRANT SELECT ON public.subscription_invoices TO authenticated;
GRANT ALL ON public.subscription_invoices TO service_role;

ALTER TABLE public.subscription_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sub_invoices tenant read"
  ON public.subscription_invoices FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "sub_invoices admin manage"
  ON public.subscription_invoices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Seed inicial dos 3 planos POSION (mensal + trimestral -10%)
INSERT INTO public.plan_catalog (code, interval, name, description, amount_cents, lookup_key, sort_order) VALUES
  ('starter','month',  'Starter Mensal',    'Clínicas iniciando',           45000, 'posion_starter_month_v1', 10),
  ('starter','quarter','Starter Trimestral','Starter -10% (3 meses)',      121500, 'posion_starter_quarter_v1', 11),
  ('pro',    'month',  'Pro Mensal',        'Operação completa',            89000, 'posion_pro_month_v1', 20),
  ('pro',    'quarter','Pro Trimestral',    'Pro -10% (3 meses)',          240300, 'posion_pro_quarter_v1', 21),
  ('scale',  'month',  'Scale Mensal',      'Redes / alta performance',    149000, 'posion_scale_month_v1', 30),
  ('scale',  'quarter','Scale Trimestral',  'Scale -10% (3 meses)',        402300, 'posion_scale_quarter_v1', 31);
