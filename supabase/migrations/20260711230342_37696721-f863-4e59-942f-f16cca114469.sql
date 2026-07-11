
-- =========================================================================
-- Fase 6 / PARTE 2: promoção lead → cliente (patients / tenant_client_profile)
-- + correção do espelho + suporte a reversão
-- Aditiva, idempotente, sem apagar dados.
-- =========================================================================

-- 1) Coluna promotion_reverted_at (aditiva, nula)
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS promotion_reverted_at timestamptz;

ALTER TABLE public.tenant_client_profile
  ADD COLUMN IF NOT EXISTS promotion_reverted_at timestamptz;

-- 2) Índice único parcial para idempotência do upsert (ON CONFLICT)
CREATE UNIQUE INDEX IF NOT EXISTS ux_patients_source_form_lead_id
  ON public.patients(source_form_lead_id)
  WHERE source_form_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_patients_source_lead_id
  ON public.patients(source_lead_id)
  WHERE source_lead_id IS NOT NULL;

-- =========================================================================
-- 3) CORREÇÃO DO ESPELHO: só espelhar leads sem tenant_id (funil do Master).
--    Leads com tenant_id são de PACIENTE de clínica e NÃO devem ir para
--    agency_leads. Isso mata o vazamento na origem.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.trg_mirror_lead_to_agency()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_nome  text;
  v_stage text;
  v_cid   text;
  v_uf    text;
BEGIN
  -- Guard: só espelhar leads do funil do Master (sem tenant_id).
  -- Leads com tenant_id são pacientes da clínica e não pertencem a agency_leads.
  IF NEW.tenant_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  v_nome  := COALESCE(NULLIF(trim(COALESCE(NEW.nome_empresa, NEW.nome_completo)), ''), 'Lead sem nome');
  v_stage := public.map_lead_status_to_stage(NEW.status);
  v_cid := split_part(regexp_replace(coalesce(NEW.cidade_estado,''), '\s*[-/,]\s*', '|'), '|', 1);
  v_uf  := split_part(regexp_replace(coalesce(NEW.cidade_estado,''), '\s*[-/,]\s*', '|'), '|', 2);
  IF length(v_uf) > 2 THEN v_uf := substr(v_uf,1,2); END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.agency_leads (
      nome_clinica, responsavel, whatsapp, email, cidade, estado,
      origem, stage, valor_proposta, notas, utm_campaign, source_lead_id
    ) VALUES (
      v_nome, NEW.nome_completo, NEW.whatsapp, NEW.email, NULLIF(v_cid,''), NULLIF(upper(v_uf),''),
      COALESCE(NEW.origem, 'formulario'), v_stage, NEW.valor_proposta, NEW.observacoes, NEW.utm_campaign, NEW.id
    )
    ON CONFLICT (source_lead_id) DO NOTHING;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.agency_leads SET
      nome_clinica   = v_nome,
      responsavel    = NEW.nome_completo,
      whatsapp       = NEW.whatsapp,
      email          = NEW.email,
      cidade         = NULLIF(v_cid,''),
      estado         = NULLIF(upper(v_uf),''),
      valor_proposta = NEW.valor_proposta,
      notas          = NEW.observacoes,
      utm_campaign   = NEW.utm_campaign,
      stage          = v_stage,
      ganho_at       = CASE WHEN v_stage = 'ganho' AND ganho_at IS NULL THEN now() ELSE ganho_at END,
      updated_at     = now()
    WHERE source_lead_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

-- =========================================================================
-- 4) PROMOÇÃO leads (tenant) → patients
--    Idempotente por source_form_lead_id.
--    Reversão (sair de ganho) preenche promotion_reverted_at.
--    Voltar para ganho limpa o campo.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.trg_promote_lead_to_patient()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id uuid;
BEGIN
  -- Só atua em leads de clínica (com tenant_id). Leads do Master não têm patients.
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Entrou em "ganho"
  IF NEW.status = 'ganho'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'ganho') THEN

    SELECT id INTO v_existing_id
      FROM public.patients
     WHERE source_form_lead_id = NEW.id
     LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.patients (
        tenant_id, name, whatsapp, email, origem,
        source_form_lead_id, promoted_at, promoted_by,
        primeiro_contato, observacoes, status
      ) VALUES (
        NEW.tenant_id,
        COALESCE(NULLIF(trim(NEW.nome_completo), ''), 'Paciente'),
        NEW.whatsapp,
        NEW.email,
        COALESCE(NEW.origem, 'lead_ganho'),
        NEW.id,
        now(),
        auth.uid(),
        COALESCE(NEW.created_at::date, CURRENT_DATE),
        NEW.observacoes,
        'ativo'
      )
      ON CONFLICT (source_form_lead_id) DO UPDATE SET
        promotion_reverted_at = NULL,
        updated_at = now();
    ELSE
      -- Já existia (possivelmente revertido). Reativa.
      UPDATE public.patients
         SET promotion_reverted_at = NULL,
             updated_at = now()
       WHERE id = v_existing_id;
    END IF;
  END IF;

  -- Saiu de "ganho" → reversão
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'ganho'
     AND NEW.status IS DISTINCT FROM 'ganho' THEN
    UPDATE public.patients
       SET promotion_reverted_at = now(),
           updated_at = now()
     WHERE source_form_lead_id = NEW.id
       AND promotion_reverted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_promote_lead_to_patient ON public.leads;
CREATE TRIGGER trg_promote_lead_to_patient
AFTER INSERT OR UPDATE OF status ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.trg_promote_lead_to_patient();

-- =========================================================================
-- 5) PROMOÇÃO agency_leads → tenant + tenant_client_profile
--    Idempotente por source_agency_lead_id.
--    Cria tenant se ainda não existir (usa slug derivado do nome).
--    Preenche NEW.tenant_id_criado antes do trigger de contrato rodar.
-- =========================================================================
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
BEGIN
  -- Entrou em "ganho"
  IF NEW.stage = 'ganho'
     AND (TG_OP = 'INSERT' OR OLD.stage IS DISTINCT FROM 'ganho') THEN

    -- 1) Já existe perfil vinculado? Reutiliza tenant.
    SELECT tenant_id INTO v_tenant_id
      FROM public.tenant_client_profile
     WHERE source_agency_lead_id = NEW.id
     LIMIT 1;

    -- 2) Se não, tenant_id_criado já pode ter sido setado manualmente
    IF v_tenant_id IS NULL AND NEW.tenant_id_criado IS NOT NULL THEN
      v_tenant_id := NEW.tenant_id_criado;
    END IF;

    -- 3) Ainda não temos tenant → criar
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

    -- 4) Grava tenant_id_criado no próprio NEW (BEFORE trigger)
    NEW.tenant_id_criado := v_tenant_id;
    IF NEW.ganho_at IS NULL THEN NEW.ganho_at := now(); END IF;

    -- 5) Upsert tenant_client_profile (idempotente por tenant_id)
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

  -- Saiu de "ganho" → reversão
  IF TG_OP = 'UPDATE'
     AND OLD.stage = 'ganho'
     AND NEW.stage IS DISTINCT FROM 'ganho' THEN
    UPDATE public.tenant_client_profile
       SET promotion_reverted_at = now(),
           updated_at = now()
     WHERE source_agency_lead_id = NEW.id
       AND promotion_reverted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;

-- BEFORE trigger com nome que sorteia antes de trg_create_contract_on_ganho,
-- para que tenant_id_criado esteja preenchido quando o contrato for gerado.
DROP TRIGGER IF EXISTS trg_a_promote_agency_lead_to_client ON public.agency_leads;
CREATE TRIGGER trg_a_promote_agency_lead_to_client
BEFORE INSERT OR UPDATE OF stage ON public.agency_leads
FOR EACH ROW EXECUTE FUNCTION public.trg_promote_agency_lead_to_client();
