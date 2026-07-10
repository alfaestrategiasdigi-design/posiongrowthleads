-- 1. Table
CREATE TABLE public.founder_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  payment_id text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','expired','cancelled')),
  amount_cents integer NOT NULL DEFAULT 25000,
  qr_code_base64 text,
  qr_code_text text,
  ticket_url text,
  payer_email text,
  expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.founder_slots TO authenticated;
GRANT ALL ON public.founder_slots TO service_role;

ALTER TABLE public.founder_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant users can view their founder slot"
  ON public.founder_slots FOR SELECT TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant admins can insert their founder slot"
  ON public.founder_slots FOR INSERT TO authenticated
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant admins can update their founder slot"
  ON public.founder_slots FOR UPDATE TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER founder_slots_updated_at
  BEFORE UPDATE ON public.founder_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Slots taken helper
CREATE OR REPLACE FUNCTION public.count_founder_slots_taken()
RETURNS integer
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::int
  FROM public.founder_slots
  WHERE status = 'paid'
     OR (status = 'pending' AND expires_at IS NOT NULL AND expires_at > now());
$$;

GRANT EXECUTE ON FUNCTION public.count_founder_slots_taken() TO authenticated, anon, service_role;

-- 3. Catalog entry
INSERT INTO public.plan_catalog (code, interval, name, description, amount_cents, currency, lookup_key, active, sort_order)
VALUES ('posion_founder', 'lifetime', 'POSION Fundadores', 'Acesso vitalício — apenas 10 primeiros clientes.', 25000, 'brl', 'posion_founder_v1', true, 0)
ON CONFLICT (lookup_key) DO NOTHING;
