
-- =====================================================================
-- FUNIL PADRONIZADO — 8 ETAPAS FIXAS
-- =====================================================================
-- Canonical stages: lead, qualificado, reuniao_agendada, compareceu,
--                   negociacao, ganho, perdido, no_show

-- 1) Normalize leads.status
UPDATE public.leads SET status = CASE lower(coalesce(status,''))
  WHEN 'novo' THEN 'lead'
  WHEN 'contato' THEN 'lead'
  WHEN 'mql' THEN 'lead'
  WHEN 'sql' THEN 'lead'
  WHEN 'reuniao_realizada' THEN 'lead'
  WHEN 'proposta' THEN 'lead'
  WHEN 'qualificado' THEN 'qualificado'
  WHEN 'agendado' THEN 'reuniao_agendada'
  WHEN 'reuniao_agendada' THEN 'reuniao_agendada'
  WHEN 'compareceu' THEN 'compareceu'
  WHEN 'negociacao' THEN 'negociacao'
  WHEN 'negociando' THEN 'negociacao'
  WHEN 'ganho' THEN 'ganho'
  WHEN 'fechado_ganho' THEN 'ganho'
  WHEN 'perdido' THEN 'perdido'
  WHEN 'fechado_perdido' THEN 'perdido'
  WHEN 'no_show' THEN 'no_show'
  ELSE 'lead'
END
WHERE status IS DISTINCT FROM CASE lower(coalesce(status,''))
  WHEN 'qualificado' THEN 'qualificado'
  WHEN 'reuniao_agendada' THEN 'reuniao_agendada'
  WHEN 'compareceu' THEN 'compareceu'
  WHEN 'negociacao' THEN 'negociacao'
  WHEN 'ganho' THEN 'ganho'
  WHEN 'perdido' THEN 'perdido'
  WHEN 'no_show' THEN 'no_show'
  ELSE 'lead'
END;

ALTER TABLE public.leads ALTER COLUMN status SET DEFAULT 'lead';

-- 2) Normalize clinic_leads.stage
UPDATE public.clinic_leads SET stage = CASE lower(coalesce(stage,''))
  WHEN 'contato_iniciado' THEN 'lead'
  WHEN 'qualificando' THEN 'qualificado'
  WHEN 'avaliacao_agendada' THEN 'reuniao_agendada'
  WHEN 'avaliacao_realizada' THEN 'compareceu'
  WHEN 'negociando' THEN 'negociacao'
  WHEN 'fechado_ganho' THEN 'ganho'
  WHEN 'fechado_perdido' THEN 'perdido'
  WHEN 'no_show' THEN 'no_show'
  WHEN 'futuro' THEN 'lead'
  WHEN 'lead' THEN 'lead'
  WHEN 'qualificado' THEN 'qualificado'
  WHEN 'reuniao_agendada' THEN 'reuniao_agendada'
  WHEN 'compareceu' THEN 'compareceu'
  WHEN 'negociacao' THEN 'negociacao'
  WHEN 'ganho' THEN 'ganho'
  WHEN 'perdido' THEN 'perdido'
  ELSE 'lead'
END;

ALTER TABLE public.clinic_leads ALTER COLUMN stage SET DEFAULT 'lead';

-- 3) CHECK constraints (drop-if-exists then add)
ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_status_canonical;
ALTER TABLE public.leads ADD CONSTRAINT leads_status_canonical
  CHECK (status IN ('lead','qualificado','reuniao_agendada','compareceu','negociacao','ganho','perdido','no_show'));

ALTER TABLE public.clinic_leads DROP CONSTRAINT IF EXISTS clinic_leads_stage_canonical;
ALTER TABLE public.clinic_leads ADD CONSTRAINT clinic_leads_stage_canonical
  CHECK (stage IN ('lead','qualificado','reuniao_agendada','compareceu','negociacao','ganho','perdido','no_show'));
