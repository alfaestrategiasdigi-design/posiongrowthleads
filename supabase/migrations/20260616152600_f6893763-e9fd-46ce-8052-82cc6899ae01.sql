
CREATE TABLE public.campaign_spend (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  channel TEXT NOT NULL DEFAULT 'meta_ads',
  campaign_name TEXT,
  campaign_id TEXT,
  amount_spent NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  leads_generated INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_campaign_spend_tenant ON public.campaign_spend(tenant_id);
CREATE INDEX idx_campaign_spend_period ON public.campaign_spend(period_start, period_end);
CREATE INDEX idx_campaign_spend_channel ON public.campaign_spend(channel);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_spend TO authenticated;
GRANT ALL ON public.campaign_spend TO service_role;

ALTER TABLE public.campaign_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members can view campaign_spend"
  ON public.campaign_spend FOR SELECT TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "tenant members can insert campaign_spend"
  ON public.campaign_spend FOR INSERT TO authenticated
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "tenant members can update campaign_spend"
  ON public.campaign_spend FOR UPDATE TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "tenant admins can delete campaign_spend"
  ON public.campaign_spend FOR DELETE TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER update_campaign_spend_updated_at
  BEFORE UPDATE ON public.campaign_spend
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
