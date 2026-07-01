CREATE TABLE IF NOT EXISTS public.whatsapp_jid_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  tenant_scope text GENERATED ALWAYS AS (COALESCE(tenant_id::text, 'master')) STORED,
  instance_name text,
  lid_jid text NOT NULL,
  phone_jid text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_jid_aliases_scope_lid_uniq
  ON public.whatsapp_jid_aliases (tenant_scope, lid_jid);

CREATE INDEX IF NOT EXISTS idx_whatsapp_jid_aliases_phone
  ON public.whatsapp_jid_aliases (tenant_scope, phone_jid);

GRANT ALL ON public.whatsapp_jid_aliases TO service_role;
GRANT SELECT ON public.whatsapp_jid_aliases TO authenticated;

ALTER TABLE public.whatsapp_jid_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view whatsapp jid aliases" ON public.whatsapp_jid_aliases;
CREATE POLICY "Admins can view whatsapp jid aliases" ON public.whatsapp_jid_aliases
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_whatsapp_jid_aliases_updated_at ON public.whatsapp_jid_aliases;
CREATE TRIGGER trg_whatsapp_jid_aliases_updated_at
  BEFORE UPDATE ON public.whatsapp_jid_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();