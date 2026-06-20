-- Modular qualification form builder
CREATE TABLE IF NOT EXISTS public.qualification_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position int NOT NULL DEFAULT 0,
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  question text NOT NULL,
  type text NOT NULL DEFAULT 'text',
  placeholder text,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  required boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  disqualify_values jsonb NOT NULL DEFAULT '[]'::jsonb,
  db_column text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.qualification_fields TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.qualification_fields TO authenticated;
GRANT ALL ON public.qualification_fields TO service_role;

ALTER TABLE public.qualification_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can read active fields"
  ON public.qualification_fields FOR SELECT
  USING (true);

CREATE POLICY "Admins manage fields"
  ON public.qualification_fields FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_qualification_fields_updated_at
  BEFORE UPDATE ON public.qualification_fields
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Add extras jsonb to leads for custom fields not mapped to columns
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS extras jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Seed initial fields matching current hardcoded form
INSERT INTO public.qualification_fields (position, key, label, question, type, placeholder, options, db_column) VALUES
(1, 'nomeCompleto', 'Quem é você', 'Qual o seu nome?', 'text', 'Nome do responsável (médico/gestor)', '[]'::jsonb, 'nome_completo'),
(2, 'whatsapp', 'Contato', 'Qual seu WhatsApp com DDD?', 'tel', '(00) 00000-0000', '[]'::jsonb, 'whatsapp'),
(3, 'nomeClinica', 'Sua clínica', 'Qual o nome da sua clínica?', 'text', 'Nome da clínica', '[]'::jsonb, 'nome_empresa'),
(4, 'cidadeEstado', 'Localização', 'Onde você está localizado? (cidade e estado)', 'text', 'Ex.: São Paulo, SP', '[]'::jsonb, 'cidade_estado'),
(5, 'especialidade', 'Especialidade', 'Qual é a sua especialidade ou nicho?', 'choice', null,
  '["Odontologia","Estética","Dermatologia","Cirurgia Plástica","Transplante Capilar","Fisioterapia","Oftalmologia","Nutrição","Outro"]'::jsonb, 'especialidade'),
(6, 'numProfissionais', 'Equipe', 'Quantos profissionais atendem na clínica?', 'choice', null,
  '["1","2 a 5","6 a 10","Acima de 10"]'::jsonb, 'num_profissionais'),
(7, 'investiuTrafego', 'Tráfego', 'Você já investiu em tráfego pago?', 'choice', null,
  '["Nunca investi","Já investi por conta própria","Já contratei uma agência no passado","Faço tráfego internamente","Tenho agência atualmente"]'::jsonb, 'investiu_trafego'),
(8, 'jaRealizouProcedimento', 'Histórico', 'Você já realizou algum procedimento estético ou tratamento antes?', 'choice', null,
  '["Sim, já realizei antes","Não, será a primeira vez","Estou pesquisando ainda"]'::jsonb, 'ja_realizou_procedimento'),
(9, 'expectativaInvestimento', 'Investimento', 'Qual sua expectativa de investimento para o procedimento desejado?', 'choice', null,
  '["Até R$ 5 mil","R$ 5 mil a R$ 15 mil","R$ 15 mil a R$ 30 mil","R$ 30 mil a R$ 60 mil","Acima de R$ 60 mil","Ainda não defini"]'::jsonb, 'expectativa_investimento'),
(10, 'faturamentoMensal', 'Faturamento', 'Qual o faturamento mensal atual?', 'choice', null,
  '["Abaixo de R$10 mil","R$10 mil a R$30 mil","R$31 mil a R$50 mil","R$51 mil a R$100 mil","R$101 mil a R$300 mil","Acima de R$300 mil"]'::jsonb, 'faturamento_mensal')
ON CONFLICT (key) DO NOTHING;