CREATE OR REPLACE FUNCTION public.trg_link_appointment_to_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_phone text; v_name text; v_lead_id uuid; v_match_count int;
BEGIN
  IF NEW.lead_id IS NOT NULL THEN RETURN NEW; END IF;
  v_phone := public.normalize_phone(NEW.client_phone); v_name := NULLIF(trim(NEW.client_name),'');
  IF v_phone IS NOT NULL AND length(v_phone)>=8 THEN
    SELECT id INTO v_lead_id FROM public.leads WHERE tenant_id IS NOT DISTINCT FROM NEW.tenant_id
      AND public.normalize_phone(whatsapp)=v_phone ORDER BY created_at DESC LIMIT 1;
  END IF;
  IF v_lead_id IS NULL AND v_name IS NOT NULL AND NEW.tenant_id IS NOT NULL AND length(v_name)>=3 THEN
    SELECT count(*) INTO v_match_count FROM public.leads WHERE tenant_id=NEW.tenant_id
      AND lower(regexp_replace(trim(nome_completo),'\s+',' ','g'))=lower(regexp_replace(v_name,'\s+',' ','g'));
    IF v_match_count=1 THEN
      SELECT id INTO v_lead_id FROM public.leads WHERE tenant_id=NEW.tenant_id
        AND lower(regexp_replace(trim(nome_completo),'\s+',' ','g'))=lower(regexp_replace(v_name,'\s+',' ','g')) LIMIT 1;
    END IF;
  END IF;
  IF v_lead_id IS NULL AND NEW.tenant_id IS NOT NULL AND v_name IS NOT NULL THEN
    INSERT INTO public.leads (tenant_id,nome_completo,whatsapp,origem,status,reuniao_agendada_em,reuniao_realizada_em)
    VALUES (NEW.tenant_id,v_name,COALESCE(NEW.client_phone,''),'agenda',
      CASE WHEN NEW.status IN ('compareceu','realizado','fechado') THEN 'compareceu' ELSE 'reuniao_agendada' END,
      NEW.date_time,CASE WHEN NEW.status IN ('compareceu','realizado','fechado') THEN NEW.date_time ELSE NULL END)
    RETURNING id INTO v_lead_id;
  END IF;
  NEW.lead_id:=v_lead_id; RETURN NEW;
END;$function$;
DROP TRIGGER IF EXISTS trg_link_appointment_to_lead ON public.appointments;
CREATE TRIGGER trg_link_appointment_to_lead BEFORE INSERT OR UPDATE OF client_phone,client_name,tenant_id,lead_id ON public.appointments
FOR EACH ROW EXECUTE FUNCTION public.trg_link_appointment_to_lead();

CREATE OR REPLACE FUNCTION public.trg_reconcile_sale_links()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_patient_id uuid; v_lead_id uuid; v_appointment_id uuid; v_name_key text; v_lead public.leads;
BEGIN
  IF NEW.tenant_id IS NULL OR NULLIF(trim(NEW.patient_name),'') IS NULL THEN RETURN NEW; END IF;
  v_name_key:=lower(regexp_replace(trim(NEW.patient_name),'\s+',' ','g')); v_appointment_id:=NEW.appointment_id; v_lead_id:=NEW.lead_id;
  IF v_appointment_id IS NULL THEN
    SELECT a.id,a.lead_id INTO v_appointment_id,v_lead_id FROM public.appointments a WHERE a.tenant_id=NEW.tenant_id
      AND lower(regexp_replace(trim(a.client_name),'\s+',' ','g'))=v_name_key AND abs(a.date_time::date-NEW.sale_date)<=45
      ORDER BY abs(a.date_time::date-NEW.sale_date),a.date_time DESC LIMIT 1;
  END IF;
  IF v_lead_id IS NULL AND v_appointment_id IS NOT NULL THEN SELECT lead_id INTO v_lead_id FROM public.appointments WHERE id=v_appointment_id; END IF;
  IF v_lead_id IS NULL THEN
    SELECT id INTO v_lead_id FROM public.leads WHERE tenant_id=NEW.tenant_id
      AND lower(regexp_replace(trim(nome_completo),'\s+',' ','g'))=v_name_key ORDER BY created_at DESC LIMIT 1;
  END IF;
  NEW.appointment_id:=COALESCE(NEW.appointment_id,v_appointment_id); NEW.lead_id:=COALESCE(NEW.lead_id,v_lead_id);
  IF NEW.patient_id IS NULL THEN
    IF NEW.lead_id IS NOT NULL THEN
      SELECT id INTO v_patient_id FROM public.patients WHERE tenant_id=NEW.tenant_id AND promotion_reverted_at IS NULL
        AND (source_form_lead_id=NEW.lead_id OR source_lead_id=NEW.lead_id) LIMIT 1;
    END IF;
    IF v_patient_id IS NULL THEN
      SELECT id INTO v_patient_id FROM public.patients WHERE tenant_id=NEW.tenant_id AND promotion_reverted_at IS NULL
        AND lower(regexp_replace(trim(name),'\s+',' ','g'))=v_name_key ORDER BY created_at LIMIT 1;
    END IF;
    IF v_patient_id IS NULL THEN
      IF NEW.lead_id IS NOT NULL THEN SELECT * INTO v_lead FROM public.leads WHERE id=NEW.lead_id; END IF;
      INSERT INTO public.patients (tenant_id,name,whatsapp,email,origem,primeiro_contato,observacoes,status,source_form_lead_id,promoted_at)
      VALUES (NEW.tenant_id,NEW.patient_name,v_lead.whatsapp,v_lead.email,COALESCE(v_lead.origem,NEW.channel_origin,NEW.channel,'fechamento'),
        COALESCE(NEW.first_contact_date,NEW.sale_date),NEW.notes,'ativo',NEW.lead_id,now())
      ON CONFLICT (source_form_lead_id) WHERE source_form_lead_id IS NOT NULL DO UPDATE
        SET promotion_reverted_at=NULL,updated_at=now()
      RETURNING id INTO v_patient_id;
    END IF;
    NEW.patient_id:=v_patient_id;
  END IF;
  RETURN NEW;
END;$function$;
DROP TRIGGER IF EXISTS trg_reconcile_sale_links ON public.sales;
CREATE TRIGGER trg_reconcile_sale_links BEFORE INSERT OR UPDATE OF tenant_id,patient_name,sale_date,lead_id,appointment_id,patient_id ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.trg_reconcile_sale_links();

CREATE OR REPLACE FUNCTION public.trg_sync_closed_sale_to_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lead_id IS NOT NULL THEN
    UPDATE public.leads SET status='ganho',fechado_em=COALESCE(fechado_em,NEW.sale_date::timestamptz),
      valor_proposta=CASE WHEN COALESCE(valor_proposta,0)=0 THEN NEW.amount ELSE valor_proposta END
    WHERE id=NEW.lead_id AND tenant_id=NEW.tenant_id AND status IS DISTINCT FROM 'ganho';
  END IF; RETURN NEW;
END;$function$;
DROP TRIGGER IF EXISTS trg_sync_closed_sale_to_lead ON public.sales;
CREATE TRIGGER trg_sync_closed_sale_to_lead AFTER INSERT OR UPDATE OF lead_id,amount,sale_date ON public.sales
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_closed_sale_to_lead();

UPDATE public.appointments SET lead_id=NULL WHERE lead_id IS NULL AND tenant_id IS NOT NULL;
UPDATE public.sales SET patient_name=patient_name WHERE tenant_id IS NOT NULL;
UPDATE public.leads l SET status='ganho',fechado_em=COALESCE(l.fechado_em,s.sale_date::timestamptz),
 valor_proposta=CASE WHEN COALESCE(l.valor_proposta,0)=0 THEN s.amount ELSE l.valor_proposta END
FROM public.sales s WHERE s.lead_id=l.id AND s.tenant_id=l.tenant_id AND l.status IS DISTINCT FROM 'ganho';