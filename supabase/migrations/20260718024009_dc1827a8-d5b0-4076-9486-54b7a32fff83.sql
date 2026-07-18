
-- Realtime publication
ALTER TABLE public.leads REPLICA IDENTITY FULL;
ALTER TABLE public.appointments REPLICA IDENTITY FULL;
DO $$ BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.leads; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;

-- Lead -> Appointment sync: cancel future appointments when lead is lost
CREATE OR REPLACE FUNCTION public.trg_sync_appointment_from_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('perdido','cancelado') THEN
      UPDATE public.appointments
         SET status = 'cancelado', updated_at = now()
       WHERE lead_id = NEW.id
         AND status NOT IN ('cancelado','no_show','compareceu','realizado','fechado')
         AND date_time >= now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_appointment_from_lead ON public.leads;
CREATE TRIGGER trg_sync_appointment_from_lead
  AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_appointment_from_lead();
