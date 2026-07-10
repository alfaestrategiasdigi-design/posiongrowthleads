
CREATE TABLE public.tenant_custom_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  label text NOT NULL DEFAULT 'Oferta especial',
  kind text NOT NULL DEFAULT 'custom' CHECK (kind IN ('custom','founder','standard')),
  entry_amount_cents integer NOT NULL,
  entry_cycles integer NOT NULL DEFAULT 1 CHECK (entry_cycles >= 1),
  interval text NOT NULL DEFAULT 'month' CHECK (interval IN ('month','quarter','semester')),
  recurring_amount_cents integer NOT NULL,
  description text,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX tenant_custom_offers_active_uk
  ON public.tenant_custom_offers(tenant_id)
  WHERE active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_custom_offers TO authenticated;
GRANT ALL ON public.tenant_custom_offers TO service_role;

ALTER TABLE public.tenant_custom_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view their tenant offer"
  ON public.tenant_custom_offers FOR SELECT
  USING (public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "Admins can insert offers"
  ON public.tenant_custom_offers FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update offers"
  ON public.tenant_custom_offers FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete offers"
  ON public.tenant_custom_offers FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_tenant_custom_offers_updated_at
  BEFORE UPDATE ON public.tenant_custom_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
