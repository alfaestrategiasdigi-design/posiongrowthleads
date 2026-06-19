
-- 1. LEAD ROUTING RULES
CREATE TABLE IF NOT EXISTS public.lead_routing_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  match_type text NOT NULL CHECK (match_type IN ('form_id','campaign_id','page_id','adset_id','ad_account_id')),
  match_value text NOT NULL,
  match_label text,
  ad_account_id text,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_type, match_value)
);
CREATE INDEX IF NOT EXISTS idx_routing_rules_match ON public.lead_routing_rules(match_type, match_value) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant ON public.lead_routing_rules(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_routing_rules TO authenticated;
GRANT ALL ON public.lead_routing_rules TO service_role;
ALTER TABLE public.lead_routing_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage routing rules" ON public.lead_routing_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER trg_routing_rules_updated_at BEFORE UPDATE ON public.lead_routing_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. WHATSAPP CONNECTIONS
CREATE TABLE IF NOT EXISTS public.whatsapp_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('cloud','zapi')),
  display_name text,
  waba_id text,
  phone_number_id text,
  display_phone_number text,
  business_account_name text,
  verify_token text,
  webhook_subscribed boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','error','disconnected')),
  last_error text,
  last_validated_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wa_connections_tenant ON public.whatsapp_connections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_connections_phone ON public.whatsapp_connections(phone_number_id) WHERE phone_number_id IS NOT NULL;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_connections TO authenticated;
GRANT ALL ON public.whatsapp_connections TO service_role;
ALTER TABLE public.whatsapp_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage all wa connections" ON public.whatsapp_connections FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Tenant members see their wa connections" ON public.whatsapp_connections FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));
CREATE TRIGGER trg_wa_connections_updated_at BEFORE UPDATE ON public.whatsapp_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. CAMPAIGN INSIGHTS
CREATE TABLE IF NOT EXISTS public.campaign_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  ad_account_id text NOT NULL,
  level text NOT NULL CHECK (level IN ('campaign','adset','ad')),
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  date_start date NOT NULL,
  spend numeric(14,2) DEFAULT 0,
  impressions bigint DEFAULT 0,
  reach bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  link_clicks bigint DEFAULT 0,
  ctr numeric(8,4) DEFAULT 0,
  cpc numeric(10,4) DEFAULT 0,
  cpm numeric(10,4) DEFAULT 0,
  frequency numeric(8,4) DEFAULT 0,
  leads integer DEFAULT 0,
  cost_per_lead numeric(10,2) DEFAULT 0,
  purchases integer DEFAULT 0,
  purchase_value numeric(14,2) DEFAULT 0,
  roas numeric(10,4) DEFAULT 0,
  video_views bigint DEFAULT 0,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_row ON public.campaign_insights
  (level, ad_account_id, date_start, COALESCE(ad_id,''), COALESCE(adset_id,''), COALESCE(campaign_id,''));
CREATE INDEX IF NOT EXISTS idx_insights_date ON public.campaign_insights(date_start DESC);
CREATE INDEX IF NOT EXISTS idx_insights_account ON public.campaign_insights(ad_account_id, date_start DESC);
CREATE INDEX IF NOT EXISTS idx_insights_tenant ON public.campaign_insights(tenant_id, date_start DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_insights TO authenticated;
GRANT ALL ON public.campaign_insights TO service_role;
ALTER TABLE public.campaign_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins see all insights" ON public.campaign_insights FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Tenant members see their insights" ON public.campaign_insights FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));
CREATE TRIGGER trg_insights_updated_at BEFORE UPDATE ON public.campaign_insights
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. BREAKDOWNS
CREATE TABLE IF NOT EXISTS public.campaign_insights_breakdown (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insight_id uuid NOT NULL REFERENCES public.campaign_insights(id) ON DELETE CASCADE,
  breakdown_type text NOT NULL CHECK (breakdown_type IN ('age','gender','region','country','placement','device','publisher_platform','age_gender')),
  breakdown_value text NOT NULL,
  spend numeric(14,2) DEFAULT 0,
  impressions bigint DEFAULT 0,
  clicks bigint DEFAULT 0,
  leads integer DEFAULT 0,
  purchases integer DEFAULT 0,
  purchase_value numeric(14,2) DEFAULT 0,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_breakdown_insight ON public.campaign_insights_breakdown(insight_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_type ON public.campaign_insights_breakdown(breakdown_type, breakdown_value);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_insights_breakdown TO authenticated;
GRANT ALL ON public.campaign_insights_breakdown TO service_role;
ALTER TABLE public.campaign_insights_breakdown ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Inherit from parent insight" ON public.campaign_insights_breakdown FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.campaign_insights ci WHERE ci.id = insight_id
    AND (public.has_role(auth.uid(),'admin') OR (ci.tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), ci.tenant_id)))));
CREATE POLICY "Admins manage breakdowns" ON public.campaign_insights_breakdown FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
