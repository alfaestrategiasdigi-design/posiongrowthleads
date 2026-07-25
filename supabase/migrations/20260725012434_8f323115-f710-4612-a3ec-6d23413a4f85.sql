
-- 1) qualification_criteria: restrict SELECT to authenticated users
DROP POLICY IF EXISTS "Anyone can read active criteria" ON public.qualification_criteria;
DROP POLICY IF EXISTS "Authenticated can read active criteria" ON public.qualification_criteria;
CREATE POLICY "Authenticated can read active criteria"
  ON public.qualification_criteria
  FOR SELECT
  TO authenticated
  USING (active = true OR public.has_role(auth.uid(), 'admin'));
REVOKE SELECT ON public.qualification_criteria FROM anon;

-- 2) qualification_fields: restrict SELECT to authenticated users
DROP POLICY IF EXISTS "Public can read active fields" ON public.qualification_fields;
DROP POLICY IF EXISTS "Authenticated can read qualification fields" ON public.qualification_fields;
DROP POLICY IF EXISTS "Authenticated can read active fields" ON public.qualification_fields;
CREATE POLICY "Authenticated can read active fields"
  ON public.qualification_fields
  FOR SELECT
  TO authenticated
  USING (active = true OR public.has_role(auth.uid(), 'admin'));
REVOKE SELECT ON public.qualification_fields FROM anon;

-- 3) Revoke anon EXECUTE on internal trigger helper SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.trg_reconcile_sale_links() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_sync_appointment_from_lead() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_sync_closed_sale_to_lead() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_sync_lead_stage_from_appointment() FROM anon, authenticated, PUBLIC;
