
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS appointment_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS sales_appointment_id_uidx
  ON public.sales(appointment_id) WHERE appointment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.trg_create_sale_on_appointment_done()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_done boolean := (NEW.status IN ('compareceu','fechado','realizado'));
  v_was_done boolean := (TG_OP = 'UPDATE' AND OLD.status IN ('compareceu','fechado','realizado'));
  v_amount numeric := 0;
  v_lead public.leads;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  IF NOT v_done OR v_was_done THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.sales WHERE appointment_id = NEW.id) THEN
    RETURN NEW;
  END IF;
  IF NEW.lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
    v_amount := COALESCE(v_lead.valor_proposta, 0);
  END IF;
  INSERT INTO public.sales (
    tenant_id, appointment_id, lead_id, patient_name, product, channel,
    amount, amount_paid, sale_date, notes, channel_origin,
    facebook_campaign_id, utm_source, utm_campaign, metadata
  ) VALUES (
    NEW.tenant_id, NEW.id, NEW.lead_id,
    COALESCE(NULLIF(trim(NEW.client_name),''),'Paciente'),
    COALESCE(NEW.procedure, NEW.appointment_type),
    COALESCE(NEW.channel, v_lead.origem, 'agendamento'),
    v_amount, 0,
    COALESCE(NEW.date_time::date, CURRENT_DATE),
    NEW.notes,
    v_lead.origem, v_lead.facebook_campaign,
    v_lead.utm_source, v_lead.utm_campaign,
    jsonb_build_object('appointment_id', NEW.id, 'source', 'appointment_done')
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_create_sale_on_appointment_done ON public.appointments;
CREATE TRIGGER trg_create_sale_on_appointment_done
AFTER UPDATE OF status ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.trg_create_sale_on_appointment_done();

CREATE OR REPLACE FUNCTION public.get_cost_per_appointment(
  p_start date, p_end date, p_tenant uuid DEFAULT NULL
)
RETURNS TABLE(total_spend numeric, total_appointments bigint, cost_per_appointment numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH s AS (
    SELECT COALESCE(SUM(spend),0)::numeric AS spend
      FROM public.campaign_insights
     WHERE date_start BETWEEN p_start AND p_end
       AND (p_tenant IS NULL OR tenant_id = p_tenant)
  ),
  a AS (
    SELECT COUNT(*)::bigint AS n
      FROM public.appointments
     WHERE date_time::date BETWEEN p_start AND p_end
       AND (p_tenant IS NULL OR tenant_id = p_tenant)
  )
  SELECT s.spend, a.n,
         CASE WHEN a.n > 0 THEN ROUND(s.spend / a.n, 2) ELSE 0 END
    FROM s, a;
$$;

CREATE OR REPLACE FUNCTION public.get_cost_per_appointment_by_tenant(
  p_start date, p_end date
)
RETURNS TABLE(tenant_id uuid, tenant_name text, total_spend numeric, total_appointments bigint, cost_per_appointment numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  WITH s AS (
    SELECT ci.tenant_id, COALESCE(SUM(ci.spend),0)::numeric AS spend
      FROM public.campaign_insights ci
     WHERE ci.date_start BETWEEN p_start AND p_end
       AND ci.tenant_id IS NOT NULL
     GROUP BY ci.tenant_id
  ),
  a AS (
    SELECT ap.tenant_id, COUNT(*)::bigint AS n
      FROM public.appointments ap
     WHERE ap.date_time::date BETWEEN p_start AND p_end
       AND ap.tenant_id IS NOT NULL
     GROUP BY ap.tenant_id
  )
  SELECT t.id, t.name,
         COALESCE(s.spend,0),
         COALESCE(a.n,0),
         CASE WHEN COALESCE(a.n,0) > 0 THEN ROUND(COALESCE(s.spend,0) / a.n, 2) ELSE 0 END
    FROM public.tenants t
    LEFT JOIN s ON s.tenant_id = t.id
    LEFT JOIN a ON a.tenant_id = t.id
   ORDER BY t.name;
$$;

GRANT EXECUTE ON FUNCTION public.get_cost_per_appointment(date,date,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_cost_per_appointment_by_tenant(date,date) TO authenticated, service_role;
