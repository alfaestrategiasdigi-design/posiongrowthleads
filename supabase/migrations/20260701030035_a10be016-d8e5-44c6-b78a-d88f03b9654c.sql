-- P0: Remover a tabela ad_account_mappings (a UI foi removida).
-- O vínculo real vive em public.lead_routing_rules (alimentada pelo botão
-- "Vincular cliente" em Campanhas & Anúncios).

DROP TABLE IF EXISTS public.ad_account_mappings CASCADE;

-- P1: Reescrever resolve_tenant_for_lead para consultar lead_routing_rules,
-- que é a fonte de verdade já existente. Prioridade: form_id > ad_account_id > page_id,
-- respeitando a coluna priority (menor = mais específico).
CREATE OR REPLACE FUNCTION public.resolve_tenant_for_lead(
  p_form_id text,
  p_ad_account_id text DEFAULT NULL,
  p_page_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  IF p_form_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.lead_routing_rules
    WHERE active = true
      AND match_type = 'form_id'
      AND match_value = p_form_id
    ORDER BY priority ASC
    LIMIT 1;
    IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END IF;
  END IF;

  IF p_ad_account_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.lead_routing_rules
    WHERE active = true
      AND match_type = 'ad_account_id'
      AND match_value = p_ad_account_id
    ORDER BY priority ASC
    LIMIT 1;
    IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END IF;
  END IF;

  IF p_page_id IS NOT NULL THEN
    SELECT tenant_id INTO v_tenant_id
    FROM public.lead_routing_rules
    WHERE active = true
      AND match_type = 'page_id'
      AND match_value = p_page_id
    ORDER BY priority ASC
    LIMIT 1;
    IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END IF;
  END IF;

  RETURN NULL;
END;
$function$;