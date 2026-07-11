
-- 1) Permitir 'ativo' nos CHECKs
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_canonical;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check
  CHECK (status = ANY (ARRAY['lead','qualificado','reuniao_agendada','compareceu','negociacao','ganho','ativo','perdido','no_show']));

ALTER TABLE public.agency_leads DROP CONSTRAINT IF EXISTS agency_leads_stage_check;
ALTER TABLE public.agency_leads ADD CONSTRAINT agency_leads_stage_check
  CHECK (stage = ANY (ARRAY['lead','qualificado','agendar_reuniao','reuniao_agendada','proposta','negociacao','ganho','ativo','perdido']));

-- 2) Trigger: promoção lead -> patient (trata 'ganho' e 'ativo' como estados "won")
CREATE OR REPLACE FUNCTION public.trg_promote_lead_to_patient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id uuid;
  v_was_won boolean := (TG_OP = 'UPDATE' AND OLD.status IN ('ganho','ativo'));
  v_is_won  boolean := (NEW.status IN ('ganho','ativo'));
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Entrou (ou continua) em estado won, vindo de fora
  IF v_is_won AND (TG_OP = 'INSERT' OR NOT v_was_won) THEN
    SELECT id INTO v_existing_id FROM public.patients
     WHERE source_form_lead_id = NEW.id LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.patients (
        tenant_id, name, whatsapp, email, origem,
        source_form_lead_id, promoted_at, promoted_by,
        primeiro_contato, observacoes, status
      ) VALUES (
        NEW.tenant_id,
        COALESCE(NULLIF(trim(NEW.nome_completo), ''), 'Paciente'),
        NEW.whatsapp, NEW.email,
        COALESCE(NEW.origem, 'lead_ganho'),
        NEW.id, now(), auth.uid(),
        COALESCE(NEW.created_at::date, CURRENT_DATE),
        NEW.observacoes, 'ativo'
      )
      ON CONFLICT (source_form_lead_id) DO UPDATE SET
        promotion_reverted_at = NULL, updated_at = now();
    ELSE
      UPDATE public.patients
         SET promotion_reverted_at = NULL, updated_at = now()
       WHERE id = v_existing_id;
    END IF;
  END IF;

  -- Reversão: só quando SAI dos estados won
  IF TG_OP = 'UPDATE' AND v_was_won AND NOT v_is_won THEN
    UPDATE public.patients
       SET promotion_reverted_at = now(), updated_at = now()
     WHERE source_form_lead_id = NEW.id
       AND promotion_reverted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3) Trigger: promoção agency_lead -> tenant/client_profile
CREATE OR REPLACE FUNCTION public.trg_promote_agency_lead_to_client()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

      INSERT INTO public.tenants (name, slug, active)
      VALUES (COALESCE(NULLIF(trim(NEW.nome_clinica),''),'Cliente'), v_slug, true)
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
$function$;

-- 4) Trigger: criação de contrato dispara também em 'ativo' (idempotente)
CREATE OR REPLACE FUNCTION public.trg_create_contract_on_ganho()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_was_won boolean := (TG_OP = 'UPDATE' AND OLD.stage IN ('ganho','ativo'));
  v_is_won  boolean := (NEW.stage IN ('ganho','ativo'));
BEGIN
  IF v_is_won AND (TG_OP = 'INSERT' OR NOT v_was_won) THEN
    IF NOT EXISTS (SELECT 1 FROM public.agency_contracts WHERE agency_lead_id = NEW.id) THEN
      INSERT INTO public.agency_contracts (
        agency_lead_id, tenant_id, cliente_nome, valor_total, valor_comissao,
        duracao_meses, data_assinatura, status, observacoes
      ) VALUES (
        NEW.id, NEW.tenant_id_criado,
        COALESCE(NEW.nome_clinica, NEW.responsavel, 'Cliente'),
        COALESCE(NEW.valor_proposta, 0), 0, 12,
        COALESCE(NEW.ganho_at::date, CURRENT_DATE), 'ativo', NEW.notas
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
