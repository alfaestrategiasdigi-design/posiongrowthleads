ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS especialidade text,
  ADD COLUMN IF NOT EXISTS num_profissionais text,
  ADD COLUMN IF NOT EXISTS investiu_trafego text,
  ADD COLUMN IF NOT EXISTS faturamento_mensal text;

ALTER TABLE public.leads ALTER COLUMN cnpj DROP NOT NULL;
ALTER TABLE public.leads ALTER COLUMN tipo_purchase DROP NOT NULL;