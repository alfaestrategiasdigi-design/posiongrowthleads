
-- ============================================================
-- FASE 1 — Fundação: schema, triggers, índices, RLS, realtime
-- ============================================================

-- ---------- clinic_leads ----------
ALTER TABLE public.clinic_leads
  ADD COLUMN IF NOT EXISTS responsible_user_id uuid,
  ADD COLUMN IF NOT EXISTS responsible_role text,
  ADD COLUMN IF NOT EXISTS last_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_contact_by uuid,
  ADD COLUMN IF NOT EXISTS contact_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS evaluation_scheduled_at timestamptz,
  ADD COLUMN IF NOT EXISTS evaluation_attended_at timestamptz,
  ADD COLUMN IF NOT EXISTS evaluation_attended boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS negotiation_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS product text,
  ADD COLUMN IF NOT EXISTS lead_type text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS facebook_lead_id text,
  ADD COLUMN IF NOT EXISTS facebook_campaign_id text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_medium text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS utm_content text,
  ADD COLUMN IF NOT EXISTS source_landing_page text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';

-- status enum-style check
DO $$ BEGIN
  ALTER TABLE public.clinic_leads
    ADD CONSTRAINT clinic_leads_status_chk
    CHECK (status IN ('ativo','inativo','arquivado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- sales ----------
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS clinic_lead_id uuid REFERENCES public.clinic_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seller_id uuid,
  ADD COLUMN IF NOT EXISTS procedure_id uuid,
  ADD COLUMN IF NOT EXISTS procedure_name text,
  ADD COLUMN IF NOT EXISTS procedure_category text,
  ADD COLUMN IF NOT EXISTS amount_paid numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_pending numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pendente',
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS completed_date date,
  ADD COLUMN IF NOT EXISTS completed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS channel_origin text,
  ADD COLUMN IF NOT EXISTS facebook_campaign_id text,
  ADD COLUMN IF NOT EXISTS utm_source text,
  ADD COLUMN IF NOT EXISTS utm_campaign text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public.sales
    ADD CONSTRAINT sales_amount_positive CHECK (amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.sales
    ADD CONSTRAINT sales_amount_paid_lte_amount CHECK (amount_paid >= 0 AND amount_paid <= amount);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.sales
    ADD CONSTRAINT sales_payment_status_chk
    CHECK (payment_status IN ('pendente','parcial','pago','cancelado'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- Triggers ----------
-- updated_at clinic_leads
DROP TRIGGER IF EXISTS clinic_leads_set_updated_at ON public.clinic_leads;
CREATE TRIGGER clinic_leads_set_updated_at
  BEFORE UPDATE ON public.clinic_leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- updated_at sales
DROP TRIGGER IF EXISTS sales_set_updated_at ON public.sales;
CREATE TRIGGER sales_set_updated_at
  BEFORE UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- amount_pending + payment_status auto
CREATE OR REPLACE FUNCTION public.update_sales_pending()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.amount_pending := GREATEST(COALESCE(NEW.amount,0) - COALESCE(NEW.amount_paid,0), 0);
  IF NEW.payment_status <> 'cancelado' THEN
    IF NEW.amount_paid <= 0 THEN
      NEW.payment_status := 'pendente';
    ELSIF NEW.amount_paid >= NEW.amount THEN
      NEW.payment_status := 'pago';
    ELSE
      NEW.payment_status := 'parcial';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_pending_calc ON public.sales;
CREATE TRIGGER sales_pending_calc
  BEFORE INSERT OR UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.update_sales_pending();

-- contact_count incremental
CREATE OR REPLACE FUNCTION public.increment_contact_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.last_contact_at IS NOT NULL
     AND (OLD.last_contact_at IS NULL OR NEW.last_contact_at <> OLD.last_contact_at) THEN
    NEW.contact_count := COALESCE(OLD.contact_count, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clinic_leads_contact_count ON public.clinic_leads;
CREATE TRIGGER clinic_leads_contact_count
  BEFORE UPDATE ON public.clinic_leads
  FOR EACH ROW EXECUTE FUNCTION public.increment_contact_count();

-- ---------- Índices ----------
CREATE INDEX IF NOT EXISTS idx_clinic_leads_tenant_stage   ON public.clinic_leads(tenant_id, stage);
CREATE INDEX IF NOT EXISTS idx_clinic_leads_tenant_created ON public.clinic_leads(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clinic_leads_responsible    ON public.clinic_leads(responsible_user_id);
CREATE INDEX IF NOT EXISTS idx_clinic_leads_fb_lead        ON public.clinic_leads(facebook_lead_id);
CREATE INDEX IF NOT EXISTS idx_clinic_leads_channel        ON public.clinic_leads(channel);

CREATE INDEX IF NOT EXISTS idx_sales_tenant_created   ON public.sales(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sales_clinic_lead      ON public.sales(clinic_lead_id);
CREATE INDEX IF NOT EXISTS idx_sales_seller           ON public.sales(seller_id);
CREATE INDEX IF NOT EXISTS idx_sales_payment_status   ON public.sales(payment_status);
CREATE INDEX IF NOT EXISTS idx_sales_fb_campaign      ON public.sales(facebook_campaign_id);

-- ---------- RLS revisada (split por comando) ----------
ALTER TABLE public.clinic_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Tenant members can manage clinic leads" ON public.clinic_leads;
DROP POLICY IF EXISTS clinic_leads_select ON public.clinic_leads;
DROP POLICY IF EXISTS clinic_leads_insert ON public.clinic_leads;
DROP POLICY IF EXISTS clinic_leads_update ON public.clinic_leads;
DROP POLICY IF EXISTS clinic_leads_delete ON public.clinic_leads;
CREATE POLICY clinic_leads_select ON public.clinic_leads FOR SELECT TO authenticated USING (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY clinic_leads_insert ON public.clinic_leads FOR INSERT TO authenticated WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY clinic_leads_update ON public.clinic_leads FOR UPDATE TO authenticated USING (public.has_tenant_access(auth.uid(), tenant_id)) WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY clinic_leads_delete ON public.clinic_leads FOR DELETE TO authenticated USING (public.is_tenant_admin(auth.uid(), tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clinic_leads TO authenticated;
GRANT ALL ON public.clinic_leads TO service_role;

ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant access sales" ON public.sales;
DROP POLICY IF EXISTS sales_select ON public.sales;
DROP POLICY IF EXISTS sales_insert ON public.sales;
DROP POLICY IF EXISTS sales_update ON public.sales;
DROP POLICY IF EXISTS sales_delete ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated USING (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY sales_insert ON public.sales FOR INSERT TO authenticated WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY sales_update ON public.sales FOR UPDATE TO authenticated USING (public.has_tenant_access(auth.uid(), tenant_id)) WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));
CREATE POLICY sales_delete ON public.sales FOR DELETE TO authenticated USING (public.is_tenant_admin(auth.uid(), tenant_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;

-- ---------- Realtime ----------
ALTER TABLE public.clinic_leads REPLICA IDENTITY FULL;
ALTER TABLE public.sales        REPLICA IDENTITY FULL;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.clinic_leads;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
