ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS ja_realizou_procedimento text,
  ADD COLUMN IF NOT EXISTS expectativa_investimento text;