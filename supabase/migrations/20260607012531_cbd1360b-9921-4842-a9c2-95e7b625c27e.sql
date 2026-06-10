
-- Add new columns to leads
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'site',
  ADD COLUMN IF NOT EXISTS mql BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS sql_qualified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS reuniao_agendada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reuniao_realizada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposta_enviada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS valor_proposta NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS fechado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS motivo_perda TEXT,
  ADD COLUMN IF NOT EXISTS facebook_lead_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_form_id TEXT,
  ADD COLUMN IF NOT EXISTS facebook_campaign TEXT,
  ADD COLUMN IF NOT EXISTS utm_source TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS observacoes TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS leads_facebook_lead_id_key ON public.leads(facebook_lead_id) WHERE facebook_lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_status_idx ON public.leads(status);
CREATE INDEX IF NOT EXISTS leads_origem_idx ON public.leads(origem);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON public.leads(created_at DESC);

-- Page views table
CREATE TABLE IF NOT EXISTS public.page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path TEXT NOT NULL DEFAULT '/',
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT INSERT ON public.page_views TO anon, authenticated;
GRANT SELECT ON public.page_views TO authenticated;
GRANT ALL ON public.page_views TO service_role;
ALTER TABLE public.page_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can insert pageview" ON public.page_views;
CREATE POLICY "anyone can insert pageview" ON public.page_views
  FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "admins read pageviews" ON public.page_views;
CREATE POLICY "admins read pageviews" ON public.page_views
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS page_views_created_at_idx ON public.page_views(created_at DESC);

-- Facebook webhook config (verify token)
CREATE TABLE IF NOT EXISTS public.facebook_webhook_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verify_token TEXT NOT NULL,
  page_access_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facebook_webhook_config TO authenticated;
GRANT ALL ON public.facebook_webhook_config TO service_role;
ALTER TABLE public.facebook_webhook_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins manage fb config" ON public.facebook_webhook_config;
CREATE POLICY "admins manage fb config" ON public.facebook_webhook_config
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
