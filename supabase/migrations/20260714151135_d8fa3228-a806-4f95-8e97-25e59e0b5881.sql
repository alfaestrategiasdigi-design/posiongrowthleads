
CREATE TABLE IF NOT EXISTS public.tenant_sale_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, nome)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_sale_channels TO authenticated;
GRANT ALL ON public.tenant_sale_channels TO service_role;

ALTER TABLE public.tenant_sale_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant members read channels"
  ON public.tenant_sale_channels FOR SELECT
  TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "tenant members insert channels"
  ON public.tenant_sale_channels FOR INSERT
  TO authenticated
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "tenant admin update channels"
  ON public.tenant_sale_channels FOR UPDATE
  TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "tenant admin delete channels"
  ON public.tenant_sale_channels FOR DELETE
  TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_tenant_sale_channels_updated
  BEFORE UPDATE ON public.tenant_sale_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
