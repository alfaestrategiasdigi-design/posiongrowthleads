
CREATE TABLE public.kommo_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  subdomain text NOT NULL,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  account_id bigint,
  account_name text,
  status text NOT NULL DEFAULT 'disconnected',
  last_import_at timestamptz,
  last_import_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kommo_connections TO authenticated;
GRANT ALL ON public.kommo_connections TO service_role;

ALTER TABLE public.kommo_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and tenant members can view kommo connection"
  ON public.kommo_connections FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "Admins and tenant admins can insert kommo connection"
  ON public.kommo_connections FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY "Admins and tenant admins can update kommo connection"
  ON public.kommo_connections FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.is_tenant_admin(auth.uid(), tenant_id));

CREATE POLICY "Admins and tenant admins can delete kommo connection"
  ON public.kommo_connections FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_kommo_connections_updated_at
  BEFORE UPDATE ON public.kommo_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.kommo_import_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kommo_entity_type text NOT NULL,
  kommo_id text NOT NULL,
  local_id uuid,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kommo_entity_type, kommo_id)
);

CREATE INDEX idx_kommo_import_map_tenant ON public.kommo_import_map(tenant_id, kommo_entity_type);

GRANT SELECT ON public.kommo_import_map TO authenticated;
GRANT ALL ON public.kommo_import_map TO service_role;

ALTER TABLE public.kommo_import_map ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and tenant members can view kommo import map"
  ON public.kommo_import_map FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_tenant_access(auth.uid(), tenant_id));
