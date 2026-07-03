
-- 1) SDR qualification (GPCT) columns
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS sdr_qualification jsonb;
ALTER TABLE public.agency_leads
  ADD COLUMN IF NOT EXISTS sdr_qualification jsonb;

-- 2) Link appointments to agency leads (POSION) too
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS agency_lead_id uuid REFERENCES public.agency_leads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_appointments_agency_lead_id
  ON public.appointments(agency_lead_id);

-- 3) lead_tasks
CREATE TABLE IF NOT EXISTS public.lead_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_task_id uuid REFERENCES public.lead_tasks(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  agency_lead_id uuid REFERENCES public.agency_leads(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  title text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  due_date timestamptz,
  assignee_user_id uuid,
  position integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_tasks_one_owner CHECK (
    (lead_id IS NOT NULL)::int + (agency_lead_id IS NOT NULL)::int = 1
  )
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_tasks TO authenticated;
GRANT ALL ON public.lead_tasks TO service_role;
ALTER TABLE public.lead_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all lead tasks"
  ON public.lead_tasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant members manage own lead tasks"
  ON public.lead_tasks FOR ALL TO authenticated
  USING (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (tenant_id IS NOT NULL AND public.has_tenant_access(auth.uid(), tenant_id));

CREATE INDEX IF NOT EXISTS idx_lead_tasks_lead_id ON public.lead_tasks(lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_agency_lead_id ON public.lead_tasks(agency_lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_parent ON public.lead_tasks(parent_task_id);

CREATE TRIGGER trg_lead_tasks_updated_at
  BEFORE UPDATE ON public.lead_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) lead_task_comments
CREATE TABLE IF NOT EXISTS public.lead_task_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.lead_tasks(id) ON DELETE CASCADE,
  author_user_id uuid,
  author_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_task_comments TO authenticated;
GRANT ALL ON public.lead_task_comments TO service_role;
ALTER TABLE public.lead_task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage all task comments"
  ON public.lead_task_comments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Tenant members manage task comments of own tasks"
  ON public.lead_task_comments FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.lead_tasks t
    WHERE t.id = lead_task_comments.task_id
      AND t.tenant_id IS NOT NULL
      AND public.has_tenant_access(auth.uid(), t.tenant_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.lead_tasks t
    WHERE t.id = lead_task_comments.task_id
      AND t.tenant_id IS NOT NULL
      AND public.has_tenant_access(auth.uid(), t.tenant_id)
  ));

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.lead_task_comments(task_id);
