
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.tenant_ad_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  ad_account_id text NOT NULL,
  label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, ad_account_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_ad_accounts TO authenticated;
GRANT ALL ON public.tenant_ad_accounts TO service_role;
ALTER TABLE public.tenant_ad_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage tenant_ad_accounts" ON public.tenant_ad_accounts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "tenant users read own ad accounts" ON public.tenant_ad_accounts FOR SELECT TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id));
CREATE TRIGGER trg_tenant_ad_accounts_updated BEFORE UPDATE ON public.tenant_ad_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.campaign_lead_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id text NOT NULL,
  campaign_name text,
  ad_account_id text,
  agency_lead_id uuid REFERENCES public.agency_leads(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  tenant_id uuid,
  match_source text NOT NULL CHECK (match_source IN ('utm','facebook_campaign','form_name_fuzzy','manual')),
  confidence numeric DEFAULT 1.0,
  valor numeric DEFAULT 0,
  ganho_at timestamptz,
  offline_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((agency_lead_id IS NOT NULL) OR (lead_id IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS campaign_lead_links_ag_uniq ON public.campaign_lead_links(campaign_id, agency_lead_id) WHERE agency_lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS campaign_lead_links_ld_uniq ON public.campaign_lead_links(campaign_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS campaign_lead_links_campaign_idx ON public.campaign_lead_links(campaign_id);
CREATE INDEX IF NOT EXISTS campaign_lead_links_tenant_idx ON public.campaign_lead_links(tenant_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_lead_links TO authenticated;
GRANT ALL ON public.campaign_lead_links TO service_role;
ALTER TABLE public.campaign_lead_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage campaign_lead_links" ON public.campaign_lead_links FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY "tenant users read own links" ON public.campaign_lead_links FOR SELECT TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));

ALTER TABLE public.agency_leads ADD COLUMN IF NOT EXISTS campaign_id_manual text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS campaign_id_manual text;
ALTER TABLE public.campaign_insights ADD COLUMN IF NOT EXISTS offline_events_sent int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.link_lead_to_campaigns(p_agency_lead_id uuid DEFAULT NULL, p_lead_id uuid DEFAULT NULL)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_utm text; v_fb text; v_form_name text; v_valor numeric; v_ganho timestamptz; v_tenant uuid; v_manual text;
  v_campaign_id text; v_campaign_name text; v_ad_account text;
  v_inserted int := 0;
BEGIN
  IF p_agency_lead_id IS NOT NULL THEN
    SELECT utm_campaign, NULL::text, NULL::text, valor_proposta, ganho_at, tenant_id_criado, campaign_id_manual
      INTO v_utm, v_fb, v_form_name, v_valor, v_ganho, v_tenant, v_manual
    FROM public.agency_leads WHERE id = p_agency_lead_id;
  ELSIF p_lead_id IS NOT NULL THEN
    SELECT utm_campaign, facebook_campaign, facebook_form_name, valor_proposta, fechado_em, tenant_id, campaign_id_manual
      INTO v_utm, v_fb, v_form_name, v_valor, v_ganho, v_tenant, v_manual
    FROM public.leads WHERE id = p_lead_id;
  ELSE
    RETURN 0;
  END IF;

  IF v_manual IS NOT NULL AND length(v_manual) > 0 THEN
    SELECT campaign_id, campaign_name, ad_account_id INTO v_campaign_id, v_campaign_name, v_ad_account
      FROM public.campaign_insights WHERE campaign_id = v_manual ORDER BY date_start DESC LIMIT 1;
    IF v_campaign_id IS NOT NULL THEN
      INSERT INTO public.campaign_lead_links (campaign_id, campaign_name, ad_account_id, agency_lead_id, lead_id, tenant_id, match_source, confidence, valor, ganho_at)
      VALUES (v_campaign_id, v_campaign_name, v_ad_account, p_agency_lead_id, p_lead_id, v_tenant, 'manual', 1.0, COALESCE(v_valor,0), v_ganho)
      ON CONFLICT DO NOTHING;
      RETURN 1;
    END IF;
  END IF;

  IF v_utm IS NOT NULL AND length(v_utm) > 0 THEN
    FOR v_campaign_id, v_campaign_name, v_ad_account IN
      SELECT DISTINCT campaign_id, campaign_name, ad_account_id FROM public.campaign_insights
       WHERE lower(campaign_name) = lower(v_utm) OR campaign_id = v_utm
    LOOP
      INSERT INTO public.campaign_lead_links (campaign_id, campaign_name, ad_account_id, agency_lead_id, lead_id, tenant_id, match_source, confidence, valor, ganho_at)
      VALUES (v_campaign_id, v_campaign_name, v_ad_account, p_agency_lead_id, p_lead_id, v_tenant, 'utm', 1.0, COALESCE(v_valor,0), v_ganho)
      ON CONFLICT DO NOTHING;
      v_inserted := v_inserted + 1;
    END LOOP;
  END IF;

  IF v_inserted = 0 AND v_fb IS NOT NULL AND length(v_fb) > 0 THEN
    FOR v_campaign_id, v_campaign_name, v_ad_account IN
      SELECT DISTINCT campaign_id, campaign_name, ad_account_id FROM public.campaign_insights
       WHERE lower(campaign_name) = lower(v_fb) OR campaign_id = v_fb
    LOOP
      INSERT INTO public.campaign_lead_links (campaign_id, campaign_name, ad_account_id, agency_lead_id, lead_id, tenant_id, match_source, confidence, valor, ganho_at)
      VALUES (v_campaign_id, v_campaign_name, v_ad_account, p_agency_lead_id, p_lead_id, v_tenant, 'facebook_campaign', 0.95, COALESCE(v_valor,0), v_ganho)
      ON CONFLICT DO NOTHING;
      v_inserted := v_inserted + 1;
    END LOOP;
  END IF;

  IF v_inserted = 0 AND v_form_name IS NOT NULL AND length(v_form_name) > 3 THEN
    FOR v_campaign_id, v_campaign_name, v_ad_account IN
      SELECT campaign_id, campaign_name, ad_account_id FROM (
        SELECT DISTINCT ON (campaign_id) campaign_id, campaign_name, ad_account_id,
               similarity(lower(campaign_name), lower(v_form_name)) AS sim
          FROM public.campaign_insights
         WHERE similarity(lower(campaign_name), lower(v_form_name)) > 0.35
      ) s ORDER BY s.sim DESC LIMIT 3
    LOOP
      INSERT INTO public.campaign_lead_links (campaign_id, campaign_name, ad_account_id, agency_lead_id, lead_id, tenant_id, match_source, confidence, valor, ganho_at)
      VALUES (v_campaign_id, v_campaign_name, v_ad_account, p_agency_lead_id, p_lead_id, v_tenant, 'form_name_fuzzy', 0.5, COALESCE(v_valor,0), v_ganho)
      ON CONFLICT DO NOTHING;
      v_inserted := v_inserted + 1;
    END LOOP;
  END IF;

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_link_lead_on_won()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'agency_leads' THEN
    IF NEW.stage = 'ganho' AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'ganho' OR NEW.campaign_id_manual IS DISTINCT FROM OLD.campaign_id_manual) THEN
      DELETE FROM public.campaign_lead_links WHERE agency_lead_id = NEW.id;
      PERFORM public.link_lead_to_campaigns(NEW.id, NULL);
    END IF;
  ELSIF TG_TABLE_NAME = 'leads' THEN
    IF NEW.status = 'ganho' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ganho' OR NEW.campaign_id_manual IS DISTINCT FROM OLD.campaign_id_manual) THEN
      DELETE FROM public.campaign_lead_links WHERE lead_id = NEW.id;
      PERFORM public.link_lead_to_campaigns(NULL, NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_leads_link_on_won ON public.agency_leads;
CREATE TRIGGER trg_agency_leads_link_on_won
  AFTER INSERT OR UPDATE OF stage, campaign_id_manual ON public.agency_leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_link_lead_on_won();

DROP TRIGGER IF EXISTS trg_leads_link_on_won ON public.leads;
CREATE TRIGGER trg_leads_link_on_won
  AFTER INSERT OR UPDATE OF status, campaign_id_manual ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_link_lead_on_won();

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.agency_leads WHERE stage = 'ganho' LOOP
    PERFORM public.link_lead_to_campaigns(r.id, NULL);
  END LOOP;
  FOR r IN SELECT id FROM public.leads WHERE status = 'ganho' LOOP
    PERFORM public.link_lead_to_campaigns(NULL, r.id);
  END LOOP;
END $$;
