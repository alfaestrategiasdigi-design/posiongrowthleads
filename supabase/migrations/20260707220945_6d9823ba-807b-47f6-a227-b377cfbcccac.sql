ALTER TABLE public.automation_executions
  DROP CONSTRAINT IF EXISTS automation_executions_status_check;

ALTER TABLE public.automation_executions
  ADD CONSTRAINT automation_executions_status_check
  CHECK (status IN ('running','waiting','waiting_response','waiting_delay','completed','failed','cancelled'));

DROP INDEX IF EXISTS idx_exec_wait;
CREATE INDEX IF NOT EXISTS idx_exec_wait ON public.automation_executions(wait_until) WHERE status IN ('waiting','waiting_delay');
CREATE INDEX IF NOT EXISTS automation_executions_resume_idx
  ON public.automation_executions (tenant_id, contact_phone, status)
  WHERE status = 'waiting_response';
CREATE INDEX IF NOT EXISTS automation_executions_wait_until_idx
  ON public.automation_executions (wait_until)
  WHERE status = 'waiting_delay';