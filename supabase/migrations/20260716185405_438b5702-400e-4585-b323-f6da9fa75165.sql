
CREATE TABLE public.tenant_whatsapp_numbers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  phone_jid text,
  label text,
  zapi_connection_id uuid REFERENCES public.zapi_connections(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending',
  is_primary boolean NOT NULL DEFAULT false,
  verified_at timestamptz,
  verified_owner_jid text,
  last_check_at timestamptz,
  last_check_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_whatsapp_numbers_status_check CHECK (status IN ('pending','verified','mismatch'))
);

CREATE UNIQUE INDEX tenant_whatsapp_numbers_phone_uniq ON public.tenant_whatsapp_numbers (phone_e164);
CREATE INDEX tenant_whatsapp_numbers_tenant_idx ON public.tenant_whatsapp_numbers (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_whatsapp_numbers TO authenticated;
GRANT ALL ON public.tenant_whatsapp_numbers TO service_role;

ALTER TABLE public.tenant_whatsapp_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin master manages all whatsapp numbers"
  ON public.tenant_whatsapp_numbers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant admins manage their whatsapp numbers"
  ON public.tenant_whatsapp_numbers FOR ALL TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY "Tenant members view their whatsapp numbers"
  ON public.tenant_whatsapp_numbers FOR SELECT TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id));

CREATE TRIGGER trg_tenant_whatsapp_numbers_updated_at
  BEFORE UPDATE ON public.tenant_whatsapp_numbers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
