CREATE OR REPLACE FUNCTION public.promote_agency_lead_to_tenant(p_lead_id uuid, p_slug text, p_plano text DEFAULT 'starter'::text, p_valor numeric DEFAULT NULL::numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.agency_leads;
  v_tenant_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can promote leads';
  END IF;
  SELECT * INTO v_lead FROM public.agency_leads WHERE id = p_lead_id;
  IF v_lead IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  -- Reaproveita tenant já criado pelo trigger de promoção, se houver
  SELECT tenant_id INTO v_tenant_id FROM public.tenant_client_profile
   WHERE source_agency_lead_id = p_lead_id LIMIT 1;
  IF v_tenant_id IS NULL AND v_lead.tenant_id_criado IS NOT NULL THEN
    v_tenant_id := v_lead.tenant_id_criado;
  END IF;

  IF v_tenant_id IS NULL THEN
    INSERT INTO public.tenants (name, slug, status, plan, segment)
    VALUES (COALESCE(NULLIF(trim(v_lead.nome_clinica), ''), 'Cliente'), p_slug, 'active', COALESCE(p_plano,'starter'), 'clinica')
    RETURNING id INTO v_tenant_id;
  END IF;

  INSERT INTO public.agency_contracts (agency_lead_id, tenant_id, cliente_nome, valor_total, data_assinatura, status)
  VALUES (p_lead_id, v_tenant_id, v_lead.nome_clinica, COALESCE(p_valor, v_lead.valor_proposta, 0), CURRENT_DATE, 'ativo')
  ON CONFLICT DO NOTHING;

  UPDATE public.agency_leads
     SET stage = 'ganho',
         ganho_at = COALESCE(ganho_at, now()),
         tenant_id_criado = v_tenant_id,
         updated_at = now()
   WHERE id = p_lead_id;

  RETURN v_tenant_id;
END;
$function$;