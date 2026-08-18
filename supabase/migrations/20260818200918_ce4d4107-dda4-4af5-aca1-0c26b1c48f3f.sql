CREATE TABLE public.message_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text NOT NULL,
  shortcut text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT ALL ON public.message_templates TO service_role;

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read templates of their tenants or global"
  ON public.message_templates FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR public.has_tenant_access(auth.uid(), tenant_id) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Members create templates for their tenants"
  ON public.message_templates FOR INSERT TO authenticated
  WITH CHECK ((tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Members update templates of their tenants"
  ON public.message_templates FOR UPDATE TO authenticated
  USING ((tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)) OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK ((tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)) OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Members delete templates of their tenants"
  ON public.message_templates FOR DELETE TO authenticated
  USING ((tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id)) OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_message_templates_tenant ON public.message_templates(tenant_id);

CREATE TRIGGER update_message_templates_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();