ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'clinica';

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_business_type_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_business_type_check
  CHECK (business_type IN ('clinica','infoproduto'));