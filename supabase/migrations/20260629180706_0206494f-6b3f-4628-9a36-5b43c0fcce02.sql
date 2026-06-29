
-- 1. payment_provider_config (singleton; admin only)
CREATE TABLE public.payment_provider_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'mercadopago',
  public_key text,
  account_email text,
  account_id text,
  account_site text,
  last_validated_at timestamptz,
  last_validation_result jsonb,
  webhook_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_provider_config TO authenticated;
GRANT ALL ON public.payment_provider_config TO service_role;

ALTER TABLE public.payment_provider_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage payment provider config"
  ON public.payment_provider_config FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_payment_provider_config_updated_at
  BEFORE UPDATE ON public.payment_provider_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. plan_catalog: Mercado Pago fields
ALTER TABLE public.plan_catalog
  ADD COLUMN IF NOT EXISTS mp_preapproval_plan_id text,
  ADD COLUMN IF NOT EXISTS mp_reason text;

-- 3. subscriptions: Mercado Pago fields
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'mercadopago',
  ADD COLUMN IF NOT EXISTS mp_preapproval_id text,
  ADD COLUMN IF NOT EXISTS mp_payer_email text,
  ADD COLUMN IF NOT EXISTS mp_init_point text;

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_mp_preapproval_id_key
  ON public.subscriptions (mp_preapproval_id)
  WHERE mp_preapproval_id IS NOT NULL;

-- 4. subscription_invoices: Mercado Pago fields
ALTER TABLE public.subscription_invoices
  ADD COLUMN IF NOT EXISTS mp_payment_id text,
  ADD COLUMN IF NOT EXISTS receipt_url text;

CREATE UNIQUE INDEX IF NOT EXISTS subscription_invoices_mp_payment_id_key
  ON public.subscription_invoices (mp_payment_id)
  WHERE mp_payment_id IS NOT NULL;

-- 5. tenants: drop stripe key (not used anymore)
ALTER TABLE public.tenants DROP COLUMN IF EXISTS stripe_publishable_key;
