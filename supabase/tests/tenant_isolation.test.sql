-- Integration tests for cross-tenant isolation via RLS.
-- Seeds two tenants + two authenticated users and verifies that user A
-- can never read tenant B's leads, sales, appointments, patients,
-- conversations, medical_records, lead_tasks, campaign_insights,
-- campaign_spend or lead_status_events (and vice-versa).
--
-- Runs inside a transaction and ROLLBACKs so nothing persists.
--
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/tests/tenant_isolation.test.sql

\set ON_ERROR_STOP on
BEGIN;

-- Helper: switch the session to a "logged-in" user (PostgREST-style JWT claims)
CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END; $$;

CREATE OR REPLACE FUNCTION pg_temp.act_as_service() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'service_role', true);
  PERFORM set_config('request.jwt.claims', '', true);
END; $$;

DO $test$
DECLARE
  v_tenant_a  uuid;
  v_tenant_b  uuid;
  v_user_a    uuid := gen_random_uuid();
  v_user_b    uuid := gen_random_uuid();
  v_lead_a    uuid;
  v_lead_b    uuid;
  v_sale_a    uuid;
  v_sale_b    uuid;
  v_appt_a    uuid;
  v_appt_b    uuid;
  v_pat_a     uuid;
  v_pat_b     uuid;
  v_conv_a    uuid;
  v_conv_b    uuid;
  v_task_a    uuid;
  v_task_b    uuid;
  v_mr_a      uuid;
  v_mr_b      uuid;
  v_ci_a      uuid;
  v_ci_b      uuid;
  v_cs_a      uuid;
  v_cs_b      uuid;
  v_count     int;
BEGIN
  -- ---------------------------------------------------------------
  -- Setup (as superuser — bypass RLS during seeding)
  -- ---------------------------------------------------------------
  INSERT INTO public.tenants (name, slug, plan, status)
  VALUES ('Iso Tenant A ' || substr(md5(random()::text),1,6),
          'iso-a-' || substr(md5(random()::text),1,8), 'starter', 'active')
  RETURNING id INTO v_tenant_a;

  INSERT INTO public.tenants (name, slug, plan, status)
  VALUES ('Iso Tenant B ' || substr(md5(random()::text),1,6),
          'iso-b-' || substr(md5(random()::text),1,8), 'starter', 'active')
  RETURNING id INTO v_tenant_b;

  -- tenant_users has no FK to auth.users; UUIDs are used directly.


  INSERT INTO public.tenant_users (user_id, tenant_id, role, active)
  VALUES
    (v_user_a, v_tenant_a, 'admin', true),
    (v_user_b, v_tenant_b, 'admin', true);

  -- Leads (one per tenant)
  INSERT INTO public.leads (nome_completo, whatsapp, status, tenant_id)
  VALUES ('Lead A', '11900000001', 'lead', v_tenant_a) RETURNING id INTO v_lead_a;
  INSERT INTO public.leads (nome_completo, whatsapp, status, tenant_id)
  VALUES ('Lead B', '11900000002', 'lead', v_tenant_b) RETURNING id INTO v_lead_b;

  -- Sales
  INSERT INTO public.sales (tenant_id, patient_name, product, channel, amount, sale_date)
  VALUES (v_tenant_a, 'Paciente A', 'Prod', 'form', 1000, CURRENT_DATE) RETURNING id INTO v_sale_a;
  INSERT INTO public.sales (tenant_id, patient_name, product, channel, amount, sale_date)
  VALUES (v_tenant_b, 'Paciente B', 'Prod', 'form', 2000, CURRENT_DATE) RETURNING id INTO v_sale_b;

  -- Appointments
  INSERT INTO public.appointments (tenant_id, client_name, client_phone, date_time, status)
  VALUES (v_tenant_a, 'Paciente A', '11900000001', now() + interval '1 day', 'agendado') RETURNING id INTO v_appt_a;
  INSERT INTO public.appointments (tenant_id, client_name, client_phone, date_time, status)
  VALUES (v_tenant_b, 'Paciente B', '11900000002', now() + interval '1 day', 'agendado') RETURNING id INTO v_appt_b;

  -- Patients
  INSERT INTO public.patients (tenant_id, name, whatsapp, status)
  VALUES (v_tenant_a, 'Paciente A', '11900000001', 'ativo') RETURNING id INTO v_pat_a;
  INSERT INTO public.patients (tenant_id, name, whatsapp, status)
  VALUES (v_tenant_b, 'Paciente B', '11900000002', 'ativo') RETURNING id INTO v_pat_b;

  -- Conversations
  INSERT INTO public.conversations (tenant_id, telefone, nome_contato)
  VALUES (v_tenant_a, '11900000001', 'A') RETURNING id INTO v_conv_a;
  INSERT INTO public.conversations (tenant_id, telefone, nome_contato)
  VALUES (v_tenant_b, '11900000002', 'B') RETURNING id INTO v_conv_b;

  -- Lead tasks
  INSERT INTO public.lead_tasks (tenant_id, lead_id, title)
  VALUES (v_tenant_a, v_lead_a, 'Task A') RETURNING id INTO v_task_a;
  INSERT INTO public.lead_tasks (tenant_id, lead_id, title)
  VALUES (v_tenant_b, v_lead_b, 'Task B') RETURNING id INTO v_task_b;

  -- Medical records
  INSERT INTO public.medical_records (tenant_id, patient_id, record_type)
  VALUES (v_tenant_a, v_pat_a, 'anamnese') RETURNING id INTO v_mr_a;
  INSERT INTO public.medical_records (tenant_id, patient_id, record_type)
  VALUES (v_tenant_b, v_pat_b, 'anamnese') RETURNING id INTO v_mr_b;

  -- Campaign insights
  INSERT INTO public.campaign_insights (tenant_id, ad_account_id, campaign_id, campaign_name, date_start, date_stop, spend)
  VALUES (v_tenant_a, 'act_1', 'cA', 'Camp A', CURRENT_DATE, CURRENT_DATE, 100) RETURNING id INTO v_ci_a;
  INSERT INTO public.campaign_insights (tenant_id, ad_account_id, campaign_id, campaign_name, date_start, date_stop, spend)
  VALUES (v_tenant_b, 'act_2', 'cB', 'Camp B', CURRENT_DATE, CURRENT_DATE, 200) RETURNING id INTO v_ci_b;

  -- Campaign spend
  INSERT INTO public.campaign_spend (tenant_id, campaign_id, period_start, period_end, amount_spent)
  VALUES (v_tenant_a, 'cA', CURRENT_DATE, CURRENT_DATE, 50) RETURNING id INTO v_cs_a;
  INSERT INTO public.campaign_spend (tenant_id, campaign_id, period_start, period_end, amount_spent)
  VALUES (v_tenant_b, 'cB', CURRENT_DATE, CURRENT_DATE, 60) RETURNING id INTO v_cs_b;


  -- =================================================================
  -- Assertions: act as USER A (tenant A) — must NOT see tenant B rows
  -- =================================================================
  PERFORM pg_temp.act_as(v_user_a);

  SELECT count(*) INTO v_count FROM public.leads WHERE id = v_lead_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL leads: user A saw tenant B lead'; END IF;
  SELECT count(*) INTO v_count FROM public.leads WHERE id = v_lead_a;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL leads: user A cannot see own lead (%)', v_count; END IF;

  SELECT count(*) INTO v_count FROM public.sales WHERE id = v_sale_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL sales: user A saw tenant B sale'; END IF;
  SELECT count(*) INTO v_count FROM public.sales WHERE id = v_sale_a;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL sales: user A cannot see own sale'; END IF;

  SELECT count(*) INTO v_count FROM public.appointments WHERE id = v_appt_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL appointments: user A saw tenant B appt'; END IF;

  SELECT count(*) INTO v_count FROM public.patients WHERE id = v_pat_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL patients: user A saw tenant B patient'; END IF;

  SELECT count(*) INTO v_count FROM public.conversations WHERE id = v_conv_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL conversations: user A saw tenant B conv'; END IF;

  SELECT count(*) INTO v_count FROM public.lead_tasks WHERE id = v_task_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL lead_tasks: user A saw tenant B task'; END IF;

  SELECT count(*) INTO v_count FROM public.medical_records WHERE id = v_mr_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL medical_records: user A saw tenant B MR'; END IF;

  SELECT count(*) INTO v_count FROM public.campaign_insights WHERE id = v_ci_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL campaign_insights: user A saw tenant B insight'; END IF;

  SELECT count(*) INTO v_count FROM public.campaign_spend WHERE id = v_cs_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL campaign_spend: user A saw tenant B spend'; END IF;

  SELECT count(*) INTO v_count FROM public.lead_status_events WHERE lead_id = v_lead_b;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL lead_status_events: user A saw tenant B events'; END IF;

  -- Writes: user A must NOT be able to update/delete tenant B rows
  UPDATE public.leads SET nome_completo = 'HACKED' WHERE id = v_lead_b;
  IF FOUND THEN RAISE EXCEPTION 'FAIL leads UPDATE: user A modified tenant B lead'; END IF;
  DELETE FROM public.sales WHERE id = v_sale_b;
  IF FOUND THEN RAISE EXCEPTION 'FAIL sales DELETE: user A deleted tenant B sale'; END IF;
  DELETE FROM public.appointments WHERE id = v_appt_b;
  IF FOUND THEN RAISE EXCEPTION 'FAIL appointments DELETE: user A deleted tenant B appt'; END IF;

  -- =================================================================
  -- Symmetric check: act as USER B — must NOT see tenant A rows
  -- =================================================================
  PERFORM pg_temp.act_as(v_user_b);

  SELECT count(*) INTO v_count FROM public.leads WHERE id = v_lead_a;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL leads: user B saw tenant A lead'; END IF;
  SELECT count(*) INTO v_count FROM public.sales WHERE id = v_sale_a;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL sales: user B saw tenant A sale'; END IF;
  SELECT count(*) INTO v_count FROM public.appointments WHERE id = v_appt_a;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL appointments: user B saw tenant A appt'; END IF;
  SELECT count(*) INTO v_count FROM public.patients WHERE id = v_pat_a;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL patients: user B saw tenant A patient'; END IF;
  SELECT count(*) INTO v_count FROM public.conversations WHERE id = v_conv_a;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL conversations: user B saw tenant A conv'; END IF;
  SELECT count(*) INTO v_count FROM public.medical_records WHERE id = v_mr_a;
  IF v_count <> 0 THEN RAISE EXCEPTION 'FAIL medical_records: user B saw tenant A MR'; END IF;

  -- User B's OWN rows must still be visible
  SELECT count(*) INTO v_count FROM public.sales WHERE id = v_sale_b;
  IF v_count <> 1 THEN RAISE EXCEPTION 'FAIL sales: user B cannot see own sale'; END IF;

  PERFORM pg_temp.act_as_service();
  RAISE NOTICE 'ALL TENANT ISOLATION TESTS PASSED ✓';
END;
$test$;

ROLLBACK;
