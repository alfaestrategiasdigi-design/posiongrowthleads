
CREATE OR REPLACE FUNCTION public.trg_promote_lead_to_patient()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_existing_id uuid;
  v_was_won boolean := (TG_OP = 'UPDATE' AND OLD.status IN ('ganho','ativo'));
  v_is_won  boolean := (NEW.status IN ('ganho','ativo'));
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_is_won AND (TG_OP = 'INSERT' OR NOT v_was_won) THEN
    SELECT id INTO v_existing_id FROM public.patients
     WHERE source_form_lead_id = NEW.id LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.patients (
        tenant_id, name, whatsapp, email, origem,
        source_form_lead_id, promoted_at, promoted_by,
        primeiro_contato, observacoes, status
      ) VALUES (
        NEW.tenant_id,
        COALESCE(NULLIF(trim(NEW.nome_completo), ''), 'Paciente'),
        NEW.whatsapp, NEW.email,
        COALESCE(NEW.origem, 'lead_ganho'),
        NEW.id, now(), auth.uid(),
        COALESCE(NEW.created_at::date, CURRENT_DATE),
        NEW.observacoes, 'ativo'
      );
    ELSE
      UPDATE public.patients
         SET promotion_reverted_at = NULL, updated_at = now()
       WHERE id = v_existing_id;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND v_was_won AND NOT v_is_won THEN
    UPDATE public.patients
       SET promotion_reverted_at = now(), updated_at = now()
     WHERE source_form_lead_id = NEW.id
       AND promotion_reverted_at IS NULL;
  END IF;

  RETURN NEW;
END;
$function$;
