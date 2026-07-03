
-- 1) Permite regras sem tenant (escopo Admin Master / POSION) e adiciona flag
ALTER TABLE public.lead_routing_rules ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE public.lead_routing_rules
  ADD COLUMN IF NOT EXISTS is_admin_master boolean NOT NULL DEFAULT false;

ALTER TABLE public.lead_routing_rules DROP CONSTRAINT IF EXISTS lead_routing_rules_target_check;
ALTER TABLE public.lead_routing_rules
  ADD CONSTRAINT lead_routing_rules_target_check
  CHECK (tenant_id IS NOT NULL OR is_admin_master = true);

-- 2) Nova função de roteamento STRICT por form_id (sem fallback por ad_account/page)
CREATE OR REPLACE FUNCTION public.resolve_form_routing(p_form_id text)
RETURNS TABLE(tenant_id uuid, is_admin_master boolean, matched boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_form_id IS NULL OR p_form_id = '' THEN
    RETURN QUERY SELECT NULL::uuid, false, false;
    RETURN;
  END IF;

  RETURN QUERY
    SELECT r.tenant_id, r.is_admin_master, true
    FROM public.lead_routing_rules r
    WHERE r.active = true
      AND r.match_type = 'form_id'
      AND r.match_value = p_form_id
    ORDER BY r.priority ASC
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, false, false;
  END IF;
END;
$$;

-- 3) Endurecer resolve_tenant_for_lead: STRICT form_id apenas (sem bleed via ad_account/page)
CREATE OR REPLACE FUNCTION public.resolve_tenant_for_lead(
  p_form_id text,
  p_ad_account_id text DEFAULT NULL,
  p_page_id text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  IF p_form_id IS NULL OR p_form_id = '' THEN RETURN NULL; END IF;
  SELECT tenant_id INTO v_tenant_id
  FROM public.lead_routing_rules
  WHERE active = true
    AND match_type = 'form_id'
    AND match_value = p_form_id
    AND is_admin_master = false
  ORDER BY priority ASC LIMIT 1;
  RETURN v_tenant_id;
END;
$$;

-- 4) Corrige leads FORM CAPILAR atribuídos incorretamente à Instituto Roar
UPDATE public.leads
SET tenant_id = NULL
WHERE facebook_form_id = '1858043458199562'
  AND tenant_id = 'f259af97-8ddc-4a07-99ed-19fcb3ba631b';

UPDATE public.conversations c
SET tenant_id = NULL
WHERE tenant_id = 'f259af97-8ddc-4a07-99ed-19fcb3ba631b'
  AND EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = c.lead_id
      AND l.facebook_form_id = '1858043458199562'
      AND l.tenant_id IS NULL
  );

-- 5) Semeia regras de Admin Master para os forms POSION existentes
INSERT INTO public.lead_routing_rules (tenant_id, match_type, match_value, match_label, priority, active, is_admin_master)
SELECT NULL, 'form_id', '1858043458199562', 'FORM CAPILAR (3P+@IG) — POSION', 5, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_routing_rules
  WHERE match_type='form_id' AND match_value='1858043458199562'
);

INSERT INTO public.lead_routing_rules (tenant_id, match_type, match_value, match_label, priority, active, is_admin_master)
SELECT NULL, 'form_id', '2885172925167034', 'FORM POSION OF', 5, true, true
WHERE NOT EXISTS (
  SELECT 1 FROM public.lead_routing_rules
  WHERE match_type='form_id' AND match_value='2885172925167034'
);
