
-- 1) tenant_appointment_config
CREATE TABLE public.tenant_appointment_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  appointment_types text[] NOT NULL DEFAULT ARRAY['Avaliação','Consulta','Retorno','Procedimento']::text[],
  team_members jsonb NOT NULL DEFAULT '[]'::jsonb,
  working_hours jsonb NOT NULL DEFAULT '{"mon":{"start":"08:00","end":"18:00","closed":false},"tue":{"start":"08:00","end":"18:00","closed":false},"wed":{"start":"08:00","end":"18:00","closed":false},"thu":{"start":"08:00","end":"18:00","closed":false},"fri":{"start":"08:00","end":"18:00","closed":false},"sat":{"start":"09:00","end":"13:00","closed":true},"sun":{"start":"09:00","end":"13:00","closed":true}}'::jsonb,
  default_duration_minutes integer NOT NULL DEFAULT 60,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_appointment_config TO authenticated;
GRANT ALL ON public.tenant_appointment_config TO service_role;

ALTER TABLE public.tenant_appointment_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant access appt_config select"
  ON public.tenant_appointment_config FOR SELECT TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "tenant admin appt_config write"
  ON public.tenant_appointment_config FOR ALL TO authenticated
  USING (public.is_tenant_admin(auth.uid(), tenant_id))
  WITH CHECK (public.is_tenant_admin(auth.uid(), tenant_id));

CREATE TRIGGER trg_tenant_appointment_config_updated_at
  BEFORE UPDATE ON public.tenant_appointment_config
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
