CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  stage_key text NOT NULL,
  title text NOT NULL,
  short text NOT NULL,
  color text NOT NULL DEFAULT 'from-blue-500 to-blue-600',
  hex text NOT NULL DEFAULT '#3b82f6',
  position integer NOT NULL DEFAULT 0,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX pipeline_stages_scope_key_uidx
  ON public.pipeline_stages (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), stage_key);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pipeline_stages TO authenticated;
GRANT ALL ON public.pipeline_stages TO service_role;

ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read pipeline stages"
  ON public.pipeline_stages FOR SELECT TO authenticated
  USING (tenant_id IS NULL OR public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "Super admins manage master pipeline stages"
  ON public.pipeline_stages FOR ALL TO authenticated
  USING (tenant_id IS NULL AND public.is_super_admin(auth.uid()))
  WITH CHECK (tenant_id IS NULL AND public.is_super_admin(auth.uid()));

CREATE POLICY "Tenant admins manage their pipeline stages"
  ON public.pipeline_stages FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER update_pipeline_stages_updated_at
  BEFORE UPDATE ON public.pipeline_stages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Permite etapas personalizadas (custom_xxxx) além das etapas padrão
ALTER TABLE public.leads DROP CONSTRAINT leads_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_check CHECK (
  status = ANY (ARRAY['lead','qualificado','agendar_reuniao','reuniao_agendada','compareceu','proposta','negociacao','ganho','ativo','perdido','no_show'])
  OR status ~ '^custom_[a-z0-9]{6,20}$'
);