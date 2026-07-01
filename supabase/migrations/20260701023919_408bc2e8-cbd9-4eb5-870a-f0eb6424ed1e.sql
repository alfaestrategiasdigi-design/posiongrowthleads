
-- Ad account -> tenant mappings
CREATE TABLE public.ad_account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  facebook_ad_account_id text,
  facebook_page_id text,
  lead_form_ids text[] NOT NULL DEFAULT '{}',
  campaign_ids text[] NOT NULL DEFAULT '{}',
  label text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_account_mappings TO authenticated;
GRANT ALL ON public.ad_account_mappings TO service_role;

ALTER TABLE public.ad_account_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manages_all_mappings"
  ON public.ad_account_mappings
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "tenant_reads_own_mappings"
  ON public.ad_account_mappings
  FOR SELECT
  TO authenticated
  USING (tenant_id IN (SELECT public.current_tenant_ids()));

CREATE INDEX idx_ad_mappings_tenant ON public.ad_account_mappings(tenant_id);
CREATE INDEX idx_ad_mappings_form_ids ON public.ad_account_mappings USING GIN(lead_form_ids);
CREATE INDEX idx_ad_mappings_page ON public.ad_account_mappings(facebook_page_id);
CREATE INDEX idx_ad_mappings_ad_account ON public.ad_account_mappings(facebook_ad_account_id);

CREATE TRIGGER trg_ad_mappings_updated_at
BEFORE UPDATE ON public.ad_account_mappings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Unrouted leads queue
CREATE TABLE public.unrouted_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_payload jsonb NOT NULL,
  form_id text,
  ad_account_id text,
  page_id text,
  facebook_lead_id text,
  nome text,
  whatsapp text,
  email text,
  resolved boolean NOT NULL DEFAULT false,
  resolved_tenant_id uuid REFERENCES public.tenants(id),
  resolved_lead_id uuid,
  resolved_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.unrouted_leads TO authenticated;
GRANT ALL ON public.unrouted_leads TO service_role;

ALTER TABLE public.unrouted_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_manages_unrouted"
  ON public.unrouted_leads
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_unrouted_received ON public.unrouted_leads(received_at DESC);
CREATE INDEX idx_unrouted_resolved ON public.unrouted_leads(resolved);
CREATE INDEX idx_unrouted_form ON public.unrouted_leads(form_id);

-- Resolver function: form_id > ad_account_id > page_id
CREATE OR REPLACE FUNCTION public.resolve_tenant_for_lead(
  p_form_id text,
  p_ad_account_id text DEFAULT NULL,
  p_page_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_form_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.ad_account_mappings
    WHERE lead_form_ids @> ARRAY[p_form_id]
      AND is_active = true
    LIMIT 1;
    IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END IF;
  END IF;

  IF p_ad_account_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.ad_account_mappings
    WHERE facebook_ad_account_id = p_ad_account_id
      AND is_active = true
    LIMIT 1;
    IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END IF;
  END IF;

  IF p_page_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.ad_account_mappings
    WHERE facebook_page_id = p_page_id
      AND is_active = true
    LIMIT 1;
    IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END IF;
  END IF;

  RETURN NULL;
END;
$$;
