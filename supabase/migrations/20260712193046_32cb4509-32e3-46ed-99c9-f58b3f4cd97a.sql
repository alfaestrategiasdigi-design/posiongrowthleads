CREATE OR REPLACE FUNCTION public.trg_promote_agency_lead_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_base_slug text;
  v_slug text;
  v_suffix int := 0;
  v_was_won boolean := (TG_OP = 'UPDATE' AND OLD.stage IN ('ganho','ativo'));
  v_is_won  boolean := (NEW.stage IN ('ganho','ativo'));
BEGIN
  IF v_is_won AND (TG_OP = 'INSERT' OR NOT v_was_won) THEN
    SELECT tenant_id INTO v_tenant_id FROM public.tenant_client_profile
     WHERE source_agency_lead_id = NEW.id LIMIT 1;

    IF v_tenant_id IS NULL AND NEW.tenant_id_criado IS NOT NULL THEN
      v_tenant_id := NEW.tenant_id_criado;
    END IF;

    IF v_tenant_id IS NULL THEN
      v_base_slug := lower(regexp_replace(
        COALESCE(NULLIF(trim(NEW.nome_clinica), ''), 'cliente'),
        '[^a-zA-Z0-9]+', '-', 'g'));
      v_base_slug := trim(both '-' from v_base_slug);
      IF v_base_slug = '' THEN v_base_slug := 'cliente'; END IF;
      v_slug := v_base_slug;
      WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = v_slug) LOOP
        v_suffix := v_suffix + 1;
        v_slug := v_base_slug || '-' || v_suffix::text;
      END LOOP;

      INSERT INTO public.tenants (name, slug, status, plan)
      VALUES (COALESCE(NULLIF(trim(NEW.nome_clinica),''),'Cliente'), v_slug, 'active', 'starter')
      RETURNING id INTO v_tenant_id;
    END IF;

    NEW.tenant_id_criado := v_tenant_id;
    IF NEW.ganho_at IS NULL THEN NEW.ganho_at := now(); END IF;

    INSERT INTO public.tenant_client_profile (
      tenant_id, source_agency_lead_id,
      responsavel_nome, responsavel_whatsapp, responsavel_email,
      cidade, estado
    ) VALUES (
      v_tenant_id, NEW.id,
      NEW.responsavel, NEW.whatsapp, NEW.email,
      NEW.cidade, NEW.estado
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
      source_agency_lead_id = COALESCE(public.tenant_client_profile.source_agency_lead_id, EXCLUDED.source_agency_lead_id),
      responsavel_nome      = COALESCE(public.tenant_client_profile.responsavel_nome, EXCLUDED.responsavel_nome),
      responsavel_whatsapp  = COALESCE(public.tenant_client_profile.responsavel_whatsapp, EXCLUDED.responsavel_whatsapp),
      responsavel_email     = COALESCE(public.tenant_client_profile.responsavel_email, EXCLUDED.responsavel_email),
      cidade                = COALESCE(public.tenant_client_profile.cidade, EXCLUDED.cidade),
      estado                = COALESCE(public.tenant_client_profile.estado, EXCLUDED.estado),
      promotion_reverted_at = NULL,
      updated_at            = now();
  END IF;

  IF TG_OP = 'UPDATE' AND v_was_won AND NOT v_is_won THEN
    UPDATE public.tenant_client_profile
       SET promotion_reverted_at = now(), updated_at = now()
     WHERE source_agency_lead_id = NEW.id
       AND promotion_reverted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;