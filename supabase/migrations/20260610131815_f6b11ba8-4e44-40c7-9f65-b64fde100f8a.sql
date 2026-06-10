
-- 1) Vincular Instituto Roar ao usuário grupolucasbrasil@gmail.com
-- Remove membership do master admin no tenant da clínica
DELETE FROM public.tenant_users
WHERE tenant_id = (SELECT id FROM public.tenants WHERE slug='instituto-roar')
  AND user_id = 'e2015f21-b5e1-4549-a96d-5afc2bfb910f';

-- Adiciona o dono da clínica
INSERT INTO public.tenant_users (tenant_id, user_id, role)
SELECT id, '7f1d81a9-46ba-4e26-849f-49fcf8036bc3', 'owner'
FROM public.tenants WHERE slug='instituto-roar'
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role='owner';

-- Garante que o dono da clínica NÃO seja super admin Posion
DELETE FROM public.user_roles
WHERE user_id = '7f1d81a9-46ba-4e26-849f-49fcf8036bc3' AND role = 'admin';

-- 2) Inspirado nos principais CRMs de clínica (Estetia, Oatmos, UNO, Plotado):
-- Prontuário/Anamnese, Recall automático, Tags de paciente.

-- Prontuário eletrônico (anamnese + evolução)
CREATE TABLE public.medical_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.clinic_leads(id) ON DELETE SET NULL,
  record_type TEXT NOT NULL DEFAULT 'anamnese', -- anamnese | evolucao | retorno | foto
  professional_name TEXT,
  chief_complaint TEXT,
  allergies TEXT,
  medications TEXT,
  medical_history TEXT,
  aesthetic_history TEXT,
  exam_findings TEXT,
  diagnosis TEXT,
  treatment_plan TEXT,
  notes TEXT,
  attachments JSONB DEFAULT '[]'::jsonb,
  consent_signed BOOLEAN DEFAULT false,
  consent_signed_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.medical_records TO authenticated;
GRANT ALL ON public.medical_records TO service_role;
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access medical_records" ON public.medical_records
  FOR ALL TO authenticated
  USING (has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (has_tenant_access(auth.uid(), tenant_id));

CREATE TRIGGER update_medical_records_updated_at
  BEFORE UPDATE ON public.medical_records
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_medical_records_tenant_patient ON public.medical_records(tenant_id, patient_id);

-- Campanhas de recall automático via WhatsApp
CREATE TABLE public.recall_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL, -- pos_procedimento | aniversario | inativo_90d | retorno | no_show
  trigger_days INT DEFAULT 0,
  procedure_id UUID REFERENCES public.procedures(id) ON DELETE SET NULL,
  message_template TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  send_window_start TIME DEFAULT '09:00',
  send_window_end TIME DEFAULT '18:00',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recall_campaigns TO authenticated;
GRANT ALL ON public.recall_campaigns TO service_role;
ALTER TABLE public.recall_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access recall_campaigns" ON public.recall_campaigns
  FOR ALL TO authenticated
  USING (has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (has_tenant_access(auth.uid(), tenant_id));

CREATE TRIGGER update_recall_campaigns_updated_at
  BEFORE UPDATE ON public.recall_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Execuções/disparos do recall (auditoria + status)
CREATE TABLE public.recall_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  campaign_id UUID NOT NULL REFERENCES public.recall_campaigns(id) ON DELETE CASCADE,
  patient_id UUID REFERENCES public.patients(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES public.clinic_leads(id) ON DELETE SET NULL,
  whatsapp TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | sent | failed | replied | converted
  rendered_message TEXT,
  scheduled_for TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  replied_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.recall_executions TO authenticated;
GRANT ALL ON public.recall_executions TO service_role;
ALTER TABLE public.recall_executions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access recall_executions" ON public.recall_executions
  FOR ALL TO authenticated
  USING (has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (has_tenant_access(auth.uid(), tenant_id));

CREATE INDEX idx_recall_executions_status ON public.recall_executions(tenant_id, status, scheduled_for);

-- Tags de paciente (segmentação) — feature comum em UNO/Estetia
CREATE TABLE public.patient_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  color TEXT DEFAULT '#8b5cf6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (patient_id, tag)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_tags TO authenticated;
GRANT ALL ON public.patient_tags TO service_role;
ALTER TABLE public.patient_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant access patient_tags" ON public.patient_tags
  FOR ALL TO authenticated
  USING (has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK (has_tenant_access(auth.uid(), tenant_id));

-- Seed: campanhas de recall padrão para Instituto Roar
INSERT INTO public.recall_campaigns (tenant_id, name, trigger_type, trigger_days, message_template)
SELECT id, 'Recall pós-procedimento (15 dias)', 'pos_procedimento', 15,
  'Oi {{nome}}! 💛 Aqui é da {{clinica}}. Já fazem 15 dias do seu procedimento — como você está se sentindo? Que tal agendar uma avaliação de retorno?'
FROM public.tenants WHERE slug='instituto-roar'
UNION ALL
SELECT id, 'Aniversário do paciente', 'aniversario', 0,
  'Feliz aniversário, {{nome}}! 🎉 A equipe da {{clinica}} preparou uma condição especial pra você este mês. Quer saber qual?'
FROM public.tenants WHERE slug='instituto-roar'
UNION ALL
SELECT id, 'Reativação inativos 90 dias', 'inativo_90d', 90,
  'Oi {{nome}}, sentimos sua falta na {{clinica}}! Quer agendar uma avaliação gratuita pra atualizar seu plano de cuidados?'
FROM public.tenants WHERE slug='instituto-roar'
UNION ALL
SELECT id, 'No-show — reagendamento', 'no_show', 1,
  'Olá {{nome}}, notamos que você não conseguiu comparecer ontem. Tudo bem? Posso reagendar pra esta semana?'
FROM public.tenants WHERE slug='instituto-roar';
