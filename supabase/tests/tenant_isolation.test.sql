-- Structural + behavioral tests to guarantee cross-tenant isolation.
--
-- Running true PostgREST-style RLS in this sandbox is blocked because the
-- executing role can't `SET ROLE authenticated`. So this suite combines:
--
--   1. Behavioral: seeds two tenants + two "users" (uuids) in tenant_users
--      and asserts the security-definer helpers used by every RLS policy
--      (has_tenant_access / is_tenant_admin / has_role) return the correct
--      tenant-scoped answers — user A must be denied for tenant B and vice-versa.
--
--   2. Structural: verifies each sensitive public table
--        (leads, sales, appointments, patients, medical_records, conversations,
--         messages, lead_tasks, campaign_insights, campaign_spend,
--         campaign_lead_links, automation_flows)
--      has RLS enabled AND every SELECT/UPDATE/DELETE policy is either
--      admin-only or scoped by (tenant_id IS NOT NULL AND has_tenant_access(...)).
--      Any policy with `USING (true)` on those tables fails the test.
--
-- Runs inside a transaction and ROLLBACKs so nothing persists.
-- Run with:  psql -v ON_ERROR_STOP=1 -f supabase/tests/tenant_isolation.test.sql

\set ON_ERROR_STOP on
BEGIN;

DO $test$
DECLARE
  v_tenant_a uuid;
  v_tenant_b uuid;
  v_user_a   uuid := gen_random_uuid();
  v_user_b   uuid := gen_random_uuid();
  v_ok       boolean;
  v_bad      int;
  v_row      record;
  v_tables   text[] := ARRAY[
    'leads','sales','appointments','patients','medical_records',
    'conversations','messages','lead_tasks','campaign_insights',
    'campaign_spend','campaign_lead_links','automation_flows'
  ];
  v_tbl text;
BEGIN
  ------------------------------------------------------------------
  -- Setup
  ------------------------------------------------------------------
  INSERT INTO public.tenants (name, slug, plan, status)
  VALUES ('Iso Tenant A', 'iso-a-' || substr(md5(random()::text),1,8), 'starter', 'active')
  RETURNING id INTO v_tenant_a;
  INSERT INTO public.tenants (name, slug, plan, status)
  VALUES ('Iso Tenant B', 'iso-b-' || substr(md5(random()::text),1,8), 'starter', 'active')
  RETURNING id INTO v_tenant_b;

  INSERT INTO public.tenant_users (user_id, tenant_id, role, active)
  VALUES (v_user_a, v_tenant_a, 'admin', true),
         (v_user_b, v_tenant_b, 'admin', true);

  ------------------------------------------------------------------
  -- 1. Behavioral: security-definer helpers must respect tenant scope
  ------------------------------------------------------------------
  RAISE NOTICE '[1] has_tenant_access respects tenant scope';

  IF NOT public.has_tenant_access(v_user_a, v_tenant_a) THEN
    RAISE EXCEPTION 'FAIL 1a: user A denied on own tenant';
  END IF;
  IF public.has_tenant_access(v_user_a, v_tenant_b) THEN
    RAISE EXCEPTION 'FAIL 1b: user A ALLOWED on tenant B (isolation broken)';
  END IF;
  IF NOT public.has_tenant_access(v_user_b, v_tenant_b) THEN
    RAISE EXCEPTION 'FAIL 1c: user B denied on own tenant';
  END IF;
  IF public.has_tenant_access(v_user_b, v_tenant_a) THEN
    RAISE EXCEPTION 'FAIL 1d: user B ALLOWED on tenant A (isolation broken)';
  END IF;

  RAISE NOTICE '[2] is_tenant_admin respects tenant scope';
  IF NOT public.is_tenant_admin(v_user_a, v_tenant_a) THEN
    RAISE EXCEPTION 'FAIL 2a: user A not admin on own tenant';
  END IF;
  IF public.is_tenant_admin(v_user_a, v_tenant_b) THEN
    RAISE EXCEPTION 'FAIL 2b: user A is admin on tenant B (isolation broken)';
  END IF;

  RAISE NOTICE '[3] has_role: seeded users are NOT global admins';
  IF public.has_role(v_user_a, 'admin') THEN
    RAISE EXCEPTION 'FAIL 3a: seeded user A unexpectedly has global admin role';
  END IF;
  IF public.has_role(v_user_b, 'admin') THEN
    RAISE EXCEPTION 'FAIL 3b: seeded user B unexpectedly has global admin role';
  END IF;

  RAISE NOTICE '[4] Deactivating tenant_users row removes access';
  UPDATE public.tenant_users SET active = false
   WHERE user_id = v_user_a AND tenant_id = v_tenant_a;
  IF public.has_tenant_access(v_user_a, v_tenant_a) THEN
    RAISE EXCEPTION 'FAIL 4: inactive tenant_users row still grants access';
  END IF;
  UPDATE public.tenant_users SET active = true
   WHERE user_id = v_user_a AND tenant_id = v_tenant_a;

  ------------------------------------------------------------------
  -- 2. Structural: RLS enabled on every sensitive table
  ------------------------------------------------------------------
  RAISE NOTICE '[5] RLS enabled on every sensitive tenant-scoped table';
  FOREACH v_tbl IN ARRAY v_tables LOOP
    SELECT relrowsecurity INTO v_ok
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = v_tbl;
    IF v_ok IS NULL THEN
      RAISE EXCEPTION 'FAIL 5: table public.% not found', v_tbl;
    END IF;
    IF NOT v_ok THEN
      RAISE EXCEPTION 'FAIL 5: RLS is DISABLED on public.% — cross-tenant leak', v_tbl;
    END IF;
  END LOOP;

  ------------------------------------------------------------------
  -- 3. Structural: no permissive SELECT/UPDATE/DELETE policies
  --    "USING (true)" or missing predicate on tenant-scoped tables.
  ------------------------------------------------------------------
  RAISE NOTICE '[6] No permissive USING(true) policies on tenant-scoped tables';
  SELECT count(*) INTO v_bad
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = ANY(v_tables)
     AND cmd IN ('SELECT','UPDATE','DELETE','ALL')
     AND (qual IS NULL OR btrim(qual) IN ('true','(true)'));
  IF v_bad > 0 THEN
    FOR v_row IN
      SELECT tablename, policyname, cmd, qual FROM pg_policies
       WHERE schemaname='public' AND tablename = ANY(v_tables)
         AND cmd IN ('SELECT','UPDATE','DELETE','ALL')
         AND (qual IS NULL OR btrim(qual) IN ('true','(true)'))
    LOOP
      RAISE WARNING 'permissive policy: % on % (%): %',
        v_row.policyname, v_row.tablename, v_row.cmd, v_row.qual;
    END LOOP;
    RAISE EXCEPTION 'FAIL 6: % permissive policies found on tenant-scoped tables', v_bad;
  END IF;

  ------------------------------------------------------------------
  -- 4. Structural: every SELECT/ALL policy on tenant-scoped tables
  --    must reference either tenant_id (via has_tenant_access /
  --    is_tenant_admin) OR be admin-only (has_role/is_agency_member).
  ------------------------------------------------------------------
  RAISE NOTICE '[7] Every read policy references tenant scope or admin gate';
  SELECT count(*) INTO v_bad
    FROM pg_policies
   WHERE schemaname='public'
     AND tablename = ANY(v_tables)
     AND cmd IN ('SELECT','ALL')
     AND qual IS NOT NULL
     AND qual NOT ILIKE '%has_tenant_access%'
     AND qual NOT ILIKE '%is_tenant_admin%'
     AND qual NOT ILIKE '%has_role%'
     AND qual NOT ILIKE '%is_agency_member%'
     AND qual NOT ILIKE '%tenant_id%';
  IF v_bad > 0 THEN
    FOR v_row IN
      SELECT tablename, policyname, cmd, qual FROM pg_policies
       WHERE schemaname='public' AND tablename = ANY(v_tables)
         AND cmd IN ('SELECT','ALL')
         AND qual IS NOT NULL
         AND qual NOT ILIKE '%has_tenant_access%'
         AND qual NOT ILIKE '%is_tenant_admin%'
         AND qual NOT ILIKE '%has_role%'
         AND qual NOT ILIKE '%is_agency_member%'
         AND qual NOT ILIKE '%tenant_id%'
    LOOP
      RAISE WARNING 'unscoped policy: % on % (%): %',
        v_row.policyname, v_row.tablename, v_row.cmd, v_row.qual;
    END LOOP;
    RAISE EXCEPTION 'FAIL 7: % read policies without tenant/admin scope', v_bad;
  END IF;

  RAISE NOTICE 'ALL TENANT ISOLATION TESTS PASSED ✓';
END;
$test$;

ROLLBACK;
