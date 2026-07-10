
ALTER TABLE public.agency_leads DROP CONSTRAINT IF EXISTS agency_leads_stage_check;
UPDATE public.agency_leads SET stage='reuniao_agendada' WHERE stage='reuniao';
ALTER TABLE public.agency_leads ADD CONSTRAINT agency_leads_stage_check
  CHECK (stage = ANY (ARRAY['lead','qualificado','agendar_reuniao','reuniao_agendada','proposta','negociacao','ganho','perdido']::text[]));

CREATE OR REPLACE FUNCTION public.map_lead_status_to_stage(_status text)
 RETURNS text
 LANGUAGE sql IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE lower(coalesce(_status,''))
    WHEN 'ganho' THEN 'ganho'
    WHEN 'perdido' THEN 'perdido'
    WHEN 'qualificado' THEN 'qualificado'
    WHEN 'agendar_reuniao' THEN 'agendar_reuniao'
    WHEN 'reuniao_agendada' THEN 'reuniao_agendada'
    WHEN 'reuniao' THEN 'reuniao_agendada'
    WHEN 'proposta' THEN 'proposta'
    WHEN 'negociacao' THEN 'negociacao'
    ELSE 'lead'
  END;
$function$;
