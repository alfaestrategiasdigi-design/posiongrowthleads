
-- Update founder plan to monthly recurring, R$ 389/mo (first month R$ 250 via founder_slots)
UPDATE public.plan_catalog
   SET interval = 'month',
       amount_cents = 38900,
       name = 'POSION Fundadores',
       description = '1º mês R$ 250 (Fundador) · depois R$ 389/mês',
       active = true,
       sort_order = 0
 WHERE lookup_key = 'posion_founder_v1';

-- Track founder subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS is_founder boolean NOT NULL DEFAULT false;

-- Schedule next charge
ALTER TABLE public.founder_slots
  ADD COLUMN IF NOT EXISTS next_charge_at timestamptz;
