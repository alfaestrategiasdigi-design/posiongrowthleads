-- Integration tests for promotion triggers.
-- Runs inside a transaction and ROLLBACKs so no data persists.
-- Disables side-effect triggers (CAPI, automation dispatch, welcome, sales, mirror, links)
-- to keep tests hermetic. The two targets under test stay enabled.
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/tests/promotion_triggers.test.sql

\set ON_ERROR_STOP on
BEGIN;

-- Silence noisy side-effect triggers (DDL is rolled back with the tx).
ALTER TABLE public.leads DISABLE TRIGGER trg_fire_automation_lead;
ALTER TABLE public.leads DISABLE TRIGGER trg_fire_capi_on_lead_insert;
ALTER TABLE public.leads DISABLE TRIGGER trg_fire_capi_on_won;
ALTER TABLE public.leads DISABLE TRIGGER trg_fire_welcome;
ALTER TABLE public.leads DISABLE TRIGGER trg_create_sale_on_lead_ganho;
ALTER TABLE public.leads DISABLE TRIGGER trg_sync_sale_on_lead_update;
ALTER TABLE public.leads DISABLE TRIGGER mirror_lead_to_agency_ins;
ALTER TABLE public.leads DISABLE TRIGGER mirror_lead_to_agency_upd;
ALTER TABLE public.leads DISABLE TRIGGER trg_leads_link_on_won;
ALTER TABLE public.leads DISABLE TRIGGER leads_link_conversations;
ALTER TABLE public.leads DISABLE TRIGGER trg_link_form_lead_to_agency_leads;
ALTER TABLE public.leads DISABLE TRIGGER trg_leads_status_audit;

ALTER TABLE public.agency_leads DISABLE TRIGGER trg_agency_leads_link_on_won;
ALTER TABLE public.agency_leads DISABLE TRIGGER trg_link_agency_lead_to_form_lead;

DO $test$
DECLARE
  v_tenant uuid;
  v_lead   uuid;
  v_alead  uuid;
  v_patient_id uuid;
  v_profile_id uuid;
  v_reverted timestamptz;
  v_count int;
BEGIN
  -- ---------------------------------------------------------------
  -- Setup: tenant used by the clinic-side lead
  -- ---------------------------------------------------------------
  INSERT INTO public.tenants (name, slug, plan, status)
  VALUES ('Test Tenant Promotion', 'test-tenant-promo-' || substr(md5(random()::text),1,8), 'starter', 'active')
  RETURNING id INTO v_tenant;

  -- ================================================================
  -- CASE 1 — trg_promote_lead_to_patient
  -- ================================================================
  RAISE NOTICE '[1] insert lead status=ganho -> patient created';
  INSERT INTO public.leads (nome_completo, whatsapp, status, tenant_id)
  VALUES ('Paciente Teste', '11999990000', 'ganho', v_tenant)
  RETURNING id INTO v_lead;

  SELECT id, promotion_reverted_at INTO v_patient_id, v_reverted
    FROM public.patients WHERE source_form_lead_id = v_lead;
  IF v_patient_id IS NULL THEN
    RAISE EXCEPTION 'FAIL 1a: expected patient row for lead %', v_lead;
  END IF;
  IF v_reverted IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 1b: promotion_reverted_at should be NULL on fresh promotion';
  END IF;

  RAISE NOTICE '[2] idempotencia: mover ganho -> ativo nao duplica paciente';
  UPDATE public.leads SET status='ativo' WHERE id=v_lead;
  SELECT count(*) INTO v_count FROM public.patients WHERE source_form_lead_id=v_lead;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL 2: expected exactly 1 patient after ganho->ativo, got %', v_count;
  END IF;

  RAISE NOTICE '[3] reversao: ativo -> negociacao preenche promotion_reverted_at';
  UPDATE public.leads SET status='negociacao' WHERE id=v_lead;
  SELECT promotion_reverted_at INTO v_reverted FROM public.patients WHERE id=v_patient_id;
  IF v_reverted IS NULL THEN
    RAISE EXCEPTION 'FAIL 3: promotion_reverted_at should be set after leaving ganho/ativo';
  END IF;

  RAISE NOTICE '[4] reativacao: negociacao -> ganho limpa promotion_reverted_at';
  UPDATE public.leads SET status='ganho' WHERE id=v_lead;
  SELECT promotion_reverted_at INTO v_reverted FROM public.patients WHERE id=v_patient_id;
  IF v_reverted IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 4: promotion_reverted_at should be NULL after re-promotion';
  END IF;

  RAISE NOTICE '[5] transicao lateral ganho -> ativo NAO reverte';
  UPDATE public.leads SET status='ativo' WHERE id=v_lead;
  SELECT promotion_reverted_at INTO v_reverted FROM public.patients WHERE id=v_patient_id;
  IF v_reverted IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 5: lateral won-state move must not set promotion_reverted_at';
  END IF;

  RAISE NOTICE '[6] lead sem tenant_id NAO cria patient';
  INSERT INTO public.leads (nome_completo, whatsapp, status, tenant_id)
  VALUES ('Sem Tenant', '11888880000', 'ganho', NULL) RETURNING id INTO v_lead;
  SELECT count(*) INTO v_count FROM public.patients WHERE source_form_lead_id=v_lead;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL 6: patient should NOT be created for lead without tenant_id';
  END IF;

  -- ================================================================
  -- CASE 2 — trg_promote_agency_lead_to_client (+ trg_create_contract_on_ganho)
  -- ================================================================
  RAISE NOTICE '[7] insert agency_lead stage=ganho -> tenant + profile + contract';
  INSERT INTO public.agency_leads (nome_clinica, responsavel, whatsapp, email, stage, valor_proposta)
  VALUES ('Clinica Teste ' || substr(md5(random()::text),1,6), 'Dr Teste', '11777770000', 'dr@test.com', 'ganho', 5000)
  RETURNING id INTO v_alead;

  SELECT id, promotion_reverted_at INTO v_profile_id, v_reverted
    FROM public.tenant_client_profile WHERE source_agency_lead_id=v_alead;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'FAIL 7a: expected tenant_client_profile for agency_lead %', v_alead;
  END IF;
  IF v_reverted IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 7b: profile.promotion_reverted_at should be NULL';
  END IF;

  SELECT count(*) INTO v_count FROM public.agency_contracts WHERE agency_lead_id=v_alead;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL 7c: expected 1 agency_contract, got %', v_count;
  END IF;

  RAISE NOTICE '[8] idempotencia: ganho -> ativo nao cria segundo contrato/profile';
  UPDATE public.agency_leads SET stage='ativo' WHERE id=v_alead;
  SELECT count(*) INTO v_count FROM public.tenant_client_profile WHERE source_agency_lead_id=v_alead;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 8a: expected 1 profile, got %', v_count; END IF;
  SELECT count(*) INTO v_count FROM public.agency_contracts WHERE agency_lead_id=v_alead;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL 8b: expected 1 contract, got %', v_count; END IF;

  RAISE NOTICE '[9] reversao: ativo -> negociacao preenche profile.promotion_reverted_at';
  UPDATE public.agency_leads SET stage='negociacao' WHERE id=v_alead;
  SELECT promotion_reverted_at INTO v_reverted FROM public.tenant_client_profile WHERE id=v_profile_id;
  IF v_reverted IS NULL THEN
    RAISE EXCEPTION 'FAIL 9: profile.promotion_reverted_at should be set after reversion';
  END IF;

  RAISE NOTICE '[10] reativacao: negociacao -> ganho limpa profile.promotion_reverted_at';
  UPDATE public.agency_leads SET stage='ganho' WHERE id=v_alead;
  SELECT promotion_reverted_at INTO v_reverted FROM public.tenant_client_profile WHERE id=v_profile_id;
  IF v_reverted IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 10: profile.promotion_reverted_at should be NULL after re-promotion';
  END IF;

  RAISE NOTICE '[11] transicao lateral ganho -> ativo NAO reverte';
  UPDATE public.agency_leads SET stage='ativo' WHERE id=v_alead;
  SELECT promotion_reverted_at INTO v_reverted FROM public.tenant_client_profile WHERE id=v_profile_id;
  IF v_reverted IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL 11: lateral won-state move must not set promotion_reverted_at';
  END IF;

  RAISE NOTICE 'ALL PROMOTION TRIGGER TESTS PASSED ✓';
END;
$test$;

ROLLBACK;
