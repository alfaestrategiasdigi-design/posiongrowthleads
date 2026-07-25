-- Enum for task type
DO $$ BEGIN
  CREATE TYPE public.lead_task_type AS ENUM ('geral','lembrete','mensagem');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.lead_task_frequency AS ENUM ('once','daily','weekly','monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.lead_tasks
  ADD COLUMN IF NOT EXISTS task_type public.lead_task_type NOT NULL DEFAULT 'geral',
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS scheduled_time time,
  ADD COLUMN IF NOT EXISTS frequency public.lead_task_frequency NOT NULL DEFAULT 'once',
  ADD COLUMN IF NOT EXISTS message_body text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS next_send_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_lead_tasks_next_send
  ON public.lead_tasks (next_send_at)
  WHERE task_type = 'mensagem' AND done = false AND next_send_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_tasks_due_date
  ON public.lead_tasks (due_date) WHERE done = false;

-- Realtime for the global tasks page
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_tasks;
EXCEPTION WHEN duplicate_object THEN NULL;
         WHEN others THEN NULL;
END $$;
ALTER TABLE public.lead_tasks REPLICA IDENTITY FULL;