-- ============ Multi-tenant SaaS foundation ============

-- Tenant role enum (per-tenant role)
DO $$ BEGIN
  CREATE TYPE public.tenant_role AS ENUM ('owner','admin','vendedor','recepcao','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ tenants ============
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  logo_url text,
  plan text NOT NULL DEFAULT 'starter',
  status text NOT NULL DEFAULT 'active',
  segment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

-- ============ tenant_users ============
CREATE TABLE IF NOT EXISTS public.tenant_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role public.tenant_role NOT NULL DEFAULT 'viewer',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_users TO authenticated;
GRANT ALL ON public.tenant_users TO service_role;
ALTER TABLE public.tenant_users ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_tenant_access(_user_id uuid, _tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tenant_users WHERE user_id = _user_id AND tenant_id = _tenant_id
  ) OR public.has_role(_user_id, 'admin');
$$;

CREATE OR REPLACE FUNCTION public.current_tenant_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT tenant_id FROM public.tenant_users WHERE user_id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'admin');
$$;

CREATE POLICY "Users see their tenants" ON public.tenants FOR SELECT TO authenticated
  USING (id IN (SELECT public.current_tenant_ids()) OR public.is_super_admin(auth.uid()));
CREATE POLICY "Super admins manage tenants" ON public.tenants FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "Users see own memberships" ON public.tenant_users FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_super_admin(auth.uid()));
CREATE POLICY "Super admins manage memberships" ON public.tenant_users FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));

-- ============ sellers ============
CREATE TABLE IF NOT EXISTS public.sellers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sellers TO authenticated;
GRANT ALL ON public.sellers TO service_role;
ALTER TABLE public.sellers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access sellers" ON public.sellers FOR ALL TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

-- ============ channels ============
CREATE TABLE IF NOT EXISTS public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL, active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO authenticated;
GRANT ALL ON public.channels TO service_role;
ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access channels" ON public.channels FOR ALL TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

-- ============ patients ============
CREATE TABLE IF NOT EXISTS public.patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL, whatsapp text, email text, origem text,
  primeiro_contato date, observacoes text,
  status text NOT NULL DEFAULT 'novo',
  recorrente boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access patients" ON public.patients FOR ALL TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

-- ============ sales ============
CREATE TABLE IF NOT EXISTS public.sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  patient_name text NOT NULL, seller_name text, product text, category text,
  channel text, payment_method text,
  amount numeric NOT NULL DEFAULT 0,
  sale_date date NOT NULL, first_contact_date date,
  attended text, international boolean NOT NULL DEFAULT false, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sales_tenant_date_idx ON public.sales(tenant_id, sale_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales TO authenticated;
GRANT ALL ON public.sales TO service_role;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access sales" ON public.sales FOR ALL TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

-- ============ monthly_goals ============
CREATE TABLE IF NOT EXISTS public.monthly_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  year int NOT NULL, month int NOT NULL,
  goal_1 numeric NOT NULL DEFAULT 0,
  goal_2 numeric NOT NULL DEFAULT 0,
  goal_3 numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, year, month)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.monthly_goals TO authenticated;
GRANT ALL ON public.monthly_goals TO service_role;
ALTER TABLE public.monthly_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access goals" ON public.monthly_goals FOR ALL TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

-- ============ evaluations ============
CREATE TABLE IF NOT EXISTS public.evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_name text NOT NULL,
  scheduled_for date NOT NULL,
  attended text NOT NULL DEFAULT 'agendado',
  outcome text, amount numeric DEFAULT 0, notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evaluations TO authenticated;
GRANT ALL ON public.evaluations TO service_role;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access evals" ON public.evaluations FOR ALL TO authenticated
  USING (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (public.has_tenant_access(auth.uid(), tenant_id));

-- ============ tenant_id on existing tables ============
ALTER TABLE public.leads            ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.conversations    ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.messages         ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.appointments     ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;
ALTER TABLE public.zapi_connections ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE;

-- ============ SEED ============
DO $seed$
DECLARE v_posion uuid; v_roar uuid;
BEGIN
  INSERT INTO public.tenants (slug, name, plan, status, segment)
  VALUES ('posion','Posion','master','active','agencia')
  ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id INTO v_posion;

  INSERT INTO public.tenants (slug, name, plan, status, segment)
  VALUES ('instituto-roar','Instituto Roar','pro','active','clinica')
  ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name RETURNING id INTO v_roar;

  INSERT INTO public.tenant_users (tenant_id, user_id, role)
  SELECT v_posion, ur.user_id, 'owner'::tenant_role FROM public.user_roles ur WHERE ur.role='admin'
  ON CONFLICT DO NOTHING;
  INSERT INTO public.tenant_users (tenant_id, user_id, role)
  SELECT v_roar, ur.user_id, 'owner'::tenant_role FROM public.user_roles ur WHERE ur.role='admin'
  ON CONFLICT DO NOTHING;

  UPDATE public.leads            SET tenant_id = v_posion WHERE tenant_id IS NULL;
  UPDATE public.conversations    SET tenant_id = v_posion WHERE tenant_id IS NULL;
  UPDATE public.messages         SET tenant_id = v_posion WHERE tenant_id IS NULL;
  UPDATE public.appointments     SET tenant_id = v_posion WHERE tenant_id IS NULL;
  UPDATE public.zapi_connections SET tenant_id = v_posion WHERE tenant_id IS NULL;

  INSERT INTO public.sellers (tenant_id, name) VALUES
    (v_roar,'DR MATHEUS'),(v_roar,'ALINE'),(v_roar,'TAMARA'),(v_roar,'ISABELLE'),(v_roar,'MAYARA');

  INSERT INTO public.channels (tenant_id, name) VALUES
    (v_roar,'Instagram Orgânico'),(v_roar,'Paciente'),(v_roar,'Tráfego Pago'),
    (v_roar,'Indicação'),(v_roar,'Clinica São Caetano'),(v_roar,'TikTok'),
    (v_roar,'Influenciadores'),(v_roar,'Site Goldincision');

  INSERT INTO public.monthly_goals (tenant_id, year, month, goal_1, goal_2, goal_3) VALUES
    (v_roar, 2026, 3, 280000, 340000, 390000),
    (v_roar, 2026, 4, 300000, 350000, 400000),
    (v_roar, 2026, 5, 320000, 380000, 410000),
    (v_roar, 2026, 6, 340000, 390000, 420000)
  ON CONFLICT (tenant_id, year, month) DO NOTHING;

  INSERT INTO public.sales (tenant_id, seller_name, sale_date, patient_name, product, amount, payment_method, channel, attended, first_contact_date) VALUES
    (v_roar, 'TAMARA', '2026-05-04', 'Raiana Ferreira', 'AVALIAÇÃO GOLD', 400, 'PIX', 'Instagram Orgânico', 'NÃO', '2026-04-06'),
    (v_roar, 'TAMARA', '2026-05-04', 'Waneria de Melo Gelio', 'AVALIAÇÃO GOLD', 400, 'CRÉDITO', 'Tráfego Pago', 'SIM', '2026-04-08'),
    (v_roar, 'TAMARA', '2026-05-05', 'Marta Lucia Albuquerque', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Tráfego Pago', 'SIM', '2026-05-05'),
    (v_roar, 'TAMARA', '2026-05-05', 'Paula Serra Miranda', 'AVALIAÇÃO GOLD', 400, 'PIX', 'TikTok', 'SIM', '2026-01-21'),
    (v_roar, 'ALINE', '2026-05-05', 'Thalita Richelmy', 'GOLD + LINNEA SAFE', 14600, 'PIX', 'Tráfego Pago', 'FUTURA', '2026-04-20'),
    (v_roar, 'TAMARA', '2026-05-06', 'Elaine Danelon', 'AVALIAÇÃO GOLD', 400, 'PIX', 'Tráfego Pago', 'SIM', '2025-12-26'),
    (v_roar, 'TAMARA', '2026-05-06', 'Gleice Corrêa', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'SIM', '2026-05-06'),
    (v_roar, 'ALINE', '2026-05-06', 'Kamis Aramis', 'AMPOLA TIRZEPATIDA + HORMONIO', 6000, 'CRÉDITO', 'Clinica São Caetano', '-', NULL),
    (v_roar, 'TAMARA', '2026-05-06', 'Elizabeth Haddad Lima', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Tráfego Pago', 'SIM', '2026-01-12'),
    (v_roar, 'TAMARA', '2026-05-06', 'Patrícia Oliveira Ladeia', 'AVALIAÇÃO GOLD', 600, 'PIX', 'TikTok', 'SIM', '2026-04-18'),
    (v_roar, 'TAMARA', '2026-05-06', 'Alessandra Cristina Morales', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Indicação', 'SIM', '2026-05-06'),
    (v_roar, 'TAMARA', '2026-05-06', 'Nathalia Naumoff Arouca', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'NÃO', '2026-04-06'),
    (v_roar, 'ISABELLE', '2026-05-06', 'Rodolfo Henrique Previato', 'CONSULTA NUTRO', 800, 'PIX', 'Clinica São Caetano', '-', NULL),
    (v_roar, 'DR MATHEUS', '2026-05-06', 'Alessandra Cristina Morales', 'GOLD + REMODELAÇÃO', 30000, 'PIX + CARTÃO', 'Tráfego Pago', 'SIM', '2026-05-06'),
    (v_roar, 'ALINE', '2026-05-06', 'Gianlucca Salomão', 'VITAMINAS + HORMONIO', 2400, 'CRÉDITO', 'Paciente', '-', NULL),
    (v_roar, 'MAYARA', '2026-05-06', 'Gianlucca Salomão', 'CONSULTA NUTRO', 700, 'CRÉDITO', 'Indicação', '-', NULL),
    (v_roar, 'TAMARA', '2026-05-09', 'Aliane Celeste Andrade', 'AVALIAÇÃO GOLD', 400, 'PIX', 'Instagram Orgânico', 'SIM', '2026-04-07'),
    (v_roar, 'TAMARA', '2026-05-11', 'Larissa Moreira', 'AVALIAÇÃO GOLD', 600, 'CRÉDITO', 'Indicação', 'SIM', '2026-05-11'),
    (v_roar, 'ALINE', '2026-05-12', 'Andrea Emy', 'GOLD + HARMONIZE', 15900, 'CRÉDITO', 'Instagram Orgânico', '-', '2026-04-23'),
    (v_roar, 'TAMARA', '2026-05-13', 'Michele Monteiro', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'SIM', '2026-05-13'),
    (v_roar, 'ALINE', '2026-05-13', 'Larissa Moreira', 'GOLD + LINNEA SAFE', 23000, 'CRÉDITO', 'Indicação', 'FUTURA', '2026-05-11'),
    (v_roar, 'MAYARA', '2026-05-13', 'Raissa Mariana Viana', 'REMODELAÇÃO GLÚTEA', 8000, 'CRÉDITO', 'Paciente', '-', NULL),
    (v_roar, 'DR MATHEUS', '2026-05-13', 'Michele Monteiro', 'GOLD + HARMONIZE + REMODELAÇÃO', 36000, 'CRÉDITO', 'Instagram Orgânico', 'SIM', '2026-05-13'),
    (v_roar, 'ISABELLE', '2026-05-14', 'Urubatan Helou Júnior', 'HORMÔNIOS', 5250, 'PIX', 'Paciente', '-', NULL),
    (v_roar, 'TAMARA', '2026-05-15', 'Marianne Samed', 'AVALIAÇÃO GOLD', 400, 'PIX', 'Tráfego Pago', 'SIM', NULL),
    (v_roar, 'MAYARA', '2026-05-15', 'Adriana Ognebene', 'BIOESTIMULADOR', 3000, 'CRÉDITO', 'Paciente', '-', NULL),
    (v_roar, 'MAYARA', '2026-05-15', 'Alana Carla Ormastroni', 'CONTOUR - EMAGRECIMENTO', 12000, 'PIX + CARTÃO', 'Paciente', '-', NULL),
    (v_roar, 'MAYARA', '2026-05-15', 'Fernanda El Jaick Franco', 'BIOESTIMULADOR', 2000, 'CRÉDITO', 'Paciente', '-', NULL),
    (v_roar, 'DR MATHEUS', '2026-05-15', 'Cristiani Lemos Trindade', 'VITAMINA B12', 250, 'PIX', 'Clinica São Caetano', '-', NULL),
    (v_roar, 'ISABELLE', '2026-05-15', 'Michele Magalhães', 'PEPTIDEOS', 2700, 'PIX', 'Paciente', '-', NULL),
    (v_roar, 'TAMARA', '2026-05-16', 'Daniele Cardoso', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'SIM', '2026-05-16'),
    (v_roar, 'MAYARA', '2026-05-19', 'Wanda Ceneviva Di Francesco', 'IMPLANTE + TOXINA + PTOLOMEU + ENDOLASER', 30000, 'CRÉDITO', 'Paciente', '-', NULL),
    (v_roar, 'TAMARA', '2026-05-19', 'Daniela Cristine', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Tráfego Pago', 'SIM', '2026-04-22'),
    (v_roar, 'TAMARA', '2026-05-19', 'Fernanda Monjelo', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'NÃO', '2026-05-09'),
    (v_roar, 'ISABELLE', '2026-05-19', 'Jane Rodrigues Nunes', 'BIOESTIMULADOR', 3000, 'CRÉDITO', 'Paciente', '-', NULL),
    (v_roar, 'ALINE', '2026-05-19', 'Marianne Samed', 'GOLD + HARMONIZE', 15500, 'PIX + CARTÃO', 'Tráfego Pago', 'SIM', NULL),
    (v_roar, 'TAMARA', '2026-05-20', 'Ezunildes Aquino Lima', 'CONSULTA NUTRO', 800, 'PIX', 'Tráfego Pago', 'FUTURA', '2026-05-20'),
    (v_roar, 'MAYARA', '2026-05-20', 'Eliana Carvalho Felix', 'PEPTIDEOS', 70, 'PIX', 'Paciente', '-', NULL),
    (v_roar, 'ALINE', '2026-05-21', 'Helio Salastino', 'IMPLANTE MASC', 7500, 'CRÉDITO', 'Paciente', '-', NULL),
    (v_roar, 'TAMARA', '2026-05-21', 'Luciana Andrade Duran', 'AVALIAÇÃO GOLD', 600, 'PIX', 'TikTok', 'SIM', '2025-11-02'),
    (v_roar, 'TAMARA', '2026-05-22', 'Ana Lucia Garcia', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Tráfego Pago', 'SIM', '2026-01-21'),
    (v_roar, 'ISABELLE', '2026-05-22', 'Rose Natálie Farinha', 'IMPLANTE FEM', 4000, 'PIX', 'Paciente', '-', NULL),
    (v_roar, 'ISABELLE', '2026-05-22', 'Katia da Rocha Sonsin', 'BIOESTIMULADOR', 1800, 'PIX', 'Paciente', '-', NULL),
    (v_roar, 'DR MATHEUS', '2026-05-22', 'Vanessa de Pinho', 'BIOESTIMULADOR', 3000, 'PIX', 'Paciente', '-', NULL),
    (v_roar, 'TAMARA', '2026-05-23', 'Linda Beca Henrich', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'SIM', '2026-05-23'),
    (v_roar, 'ISABELLE', '2026-05-23', 'Uhrany Guedes de Sa', 'CONSULTA NUTRO', 600, 'PIX', 'Paciente', '-', NULL),
    (v_roar, 'TAMARA', '2026-05-25', 'Karen Ambra', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'SIM', '2026-05-20'),
    (v_roar, 'DR MATHEUS', '2026-05-26', 'Karen Ambra', 'GOLD + HARMONIZE', 19000, 'PIX', 'Instagram Orgânico', 'SIM', '2026-05-20'),
    (v_roar, 'ALINE', '2026-05-26', 'Andreia Paro', 'BIOESTIMULADOR', 1800, 'CRÉDITO', 'Paciente', '-', NULL),
    (v_roar, 'ISABELLE', '2026-05-26', 'Urubatan Helou Júnior', 'RETATRUTIDA', 4500, 'PIX', 'Paciente', '-', NULL),
    (v_roar, 'TAMARA', '2026-05-26', 'Vivian Pedreira Stral', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Tráfego Pago', 'SIM', '2026-05-27'),
    (v_roar, 'TAMARA', '2026-05-26', 'Ana Flávia de Carvalho', 'AVALIAÇÃO GOLD', 400, 'PIX', 'Tráfego Pago', 'FUTURA', '2026-05-25'),
    (v_roar, 'MAYARA', '2026-05-27', 'Karen Ambra', 'TOXINA BOTULÍNICA', 1500, 'PIX', 'Instagram Orgânico', 'SIM', '2026-05-20'),
    (v_roar, 'TAMARA', '2026-05-27', 'Luiza Sereno Fernandes', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'FUTURA', '2026-05-17'),
    (v_roar, 'ALINE', '2026-05-27', 'Douglas Costa Dias', 'AMPOLA TIRZEPATIDA', 3800, 'CRÉDITO', 'Clinica São Caetano', '-', NULL),
    (v_roar, 'ALINE', '2026-05-28', 'Ana Lucia Garcia', 'GOLD + HARMONIZE', 25000, 'PIX + CARTÃO', 'Tráfego Pago', 'SIM', '2026-01-21'),
    (v_roar, 'TAMARA', '2026-05-28', 'Vera Rezende (USA)', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'FUTURA', '2026-05-28'),
    (v_roar, 'TAMARA', '2026-05-28', 'Cris Collazo (USA)', 'AVALIAÇÃO GOLD', 600, 'PIX', 'Instagram Orgânico', 'SIM', '2026-05-25'),
    (v_roar, 'TAMARA', '2026-05-28', 'Giullia Resplandes Souza', 'AVALIAÇÃO GOLD', 400, 'PIX', 'Tráfego Pago', 'SIM', '2026-04-30'),
    (v_roar, 'MAYARA', '2026-05-28', 'Ana Elizabeth de Castro', 'REMODELAÇÃO GLÚTEA', 13600, 'CRÉDITO', 'Paciente', '-', NULL),
    (v_roar, 'ALINE', '2026-05-29', 'Cris Collazo (USA)', 'GOLD + HARMONIZE', 37000, 'PIX + CARTÃO', 'Instagram Orgânico', 'FUTURA', '2026-05-25'),
    (v_roar, 'ALINE', '2026-05-30', 'Fanny Beteta (USA)', 'GOLD + REMODELAÇÃO', 50000, 'PIX', 'Instagram Orgânico', 'FUTURA', '2026-04-24'),
    (v_roar, 'TAMARA', '2026-05-30', 'Lucilene Gonçalves Moreira', 'AVALIAÇÃO GOLD', 400, 'PIX', 'Tráfego Pago', 'SIM', '2026-05-18');

END $seed$;