ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS trial_active boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;