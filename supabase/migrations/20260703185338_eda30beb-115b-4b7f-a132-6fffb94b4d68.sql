
-- Helper: qualquer membro da agência POSION (admin, comercial_admin_master, ou vinculado ao tenant Master)
CREATE OR REPLACE FUNCTION public.is_agency_member(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_uid, 'admin')
    OR public.has_role(_uid, 'comercial_admin_master')
    OR EXISTS (
      SELECT 1 FROM public.tenant_users
      WHERE user_id = _uid
        AND tenant_id = '00000000-0000-0000-0000-000000000001'
        AND active = true
    );
$$;

-- Adiciona SELECT amplo para membros da agência nas tabelas do painel POSION.
-- Escritas continuam nas policies ALL restritas a admin já existentes.

-- agency_leads
DROP POLICY IF EXISTS "Agency members read agency_leads" ON public.agency_leads;
CREATE POLICY "Agency members read agency_leads" ON public.agency_leads
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- agency_contracts (mantém "Tenants view own agency contracts")
DROP POLICY IF EXISTS "Agency members read agency_contracts" ON public.agency_contracts;
CREATE POLICY "Agency members read agency_contracts" ON public.agency_contracts
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- saas_contracts
DROP POLICY IF EXISTS "Agency members read saas_contracts" ON public.saas_contracts;
CREATE POLICY "Agency members read saas_contracts" ON public.saas_contracts
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- tenants (mantém "Users see their tenants")
DROP POLICY IF EXISTS "Agency members read tenants" ON public.tenants;
CREATE POLICY "Agency members read tenants" ON public.tenants
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- leads (formulário POSION)
DROP POLICY IF EXISTS "Agency members read leads" ON public.leads;
CREATE POLICY "Agency members read leads" ON public.leads
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- campaign_insights
DROP POLICY IF EXISTS "Agency members read campaign_insights" ON public.campaign_insights;
CREATE POLICY "Agency members read campaign_insights" ON public.campaign_insights
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- campaign_insights_breakdown
DROP POLICY IF EXISTS "Agency members read campaign_insights_breakdown" ON public.campaign_insights_breakdown;
CREATE POLICY "Agency members read campaign_insights_breakdown" ON public.campaign_insights_breakdown
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- campaign_spend
DROP POLICY IF EXISTS "Agency members read campaign_spend" ON public.campaign_spend;
CREATE POLICY "Agency members read campaign_spend" ON public.campaign_spend
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- campaign_lead_links
DROP POLICY IF EXISTS "Agency members read campaign_lead_links" ON public.campaign_lead_links;
CREATE POLICY "Agency members read campaign_lead_links" ON public.campaign_lead_links
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- subscriptions
DROP POLICY IF EXISTS "Agency members read subscriptions" ON public.subscriptions;
CREATE POLICY "Agency members read subscriptions" ON public.subscriptions
  FOR SELECT USING (public.is_agency_member(auth.uid()));

-- subscription_invoices
DROP POLICY IF EXISTS "Agency members read subscription_invoices" ON public.subscription_invoices;
CREATE POLICY "Agency members read subscription_invoices" ON public.subscription_invoices
  FOR SELECT USING (public.is_agency_member(auth.uid()));
