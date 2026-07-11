
-- 1) PATIENTS: colunas novas, todas nulas/opcionais
ALTER TABLE public.patients
  ADD COLUMN IF NOT EXISTS birth_date          date,
  ADD COLUMN IF NOT EXISTS source_lead_id      uuid REFERENCES public.clinic_leads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_form_lead_id uuid REFERENCES public.leads(id)        ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promoted_at         timestamptz,
  ADD COLUMN IF NOT EXISTS promoted_by         uuid,
  ADD COLUMN IF NOT EXISTS cpf                 text,
  ADD COLUMN IF NOT EXISTS sexo                text,
  ADD COLUMN IF NOT EXISTS endereco            jsonb,
  ADD COLUMN IF NOT EXISTS tags                text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS extras              jsonb  NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_patients_birth_date
  ON public.patients (birth_date)
  WHERE birth_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_patients_source_lead_id      ON public.patients (source_lead_id);
CREATE INDEX IF NOT EXISTS idx_patients_source_form_lead_id ON public.patients (source_form_lead_id);

-- 2) PATIENT_ONBOARDING (1:1 com patients, criada lazy)
CREATE TABLE IF NOT EXISTS public.patient_onboarding (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  patient_id                uuid NOT NULL UNIQUE REFERENCES public.patients(id) ON DELETE CASCADE,
  objetivo_principal        text,
  procedimento_interesse    text,
  negociacao_status         text CHECK (negociacao_status IS NULL OR negociacao_status IN ('em_aberto','em_negociacao','fechada','perdida')),
  valor_negociado           numeric(12,2),
  forma_pagamento           text,
  como_conheceu             text,
  melhor_horario_contato    text,
  proximo_retorno_at        timestamptz,
  responsavel_clinico       uuid,
  observacoes               text,
  onboarding_completed_at   timestamptz,
  extras                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.patient_onboarding TO authenticated;
GRANT ALL                            ON public.patient_onboarding TO service_role;

ALTER TABLE public.patient_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant access patient_onboarding"
  ON public.patient_onboarding
  FOR ALL
  TO authenticated
  USING     (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK(public.has_tenant_access(auth.uid(), tenant_id));

CREATE INDEX IF NOT EXISTS idx_patient_onboarding_tenant  ON public.patient_onboarding (tenant_id);
CREATE INDEX IF NOT EXISTS idx_patient_onboarding_patient ON public.patient_onboarding (patient_id);

CREATE TRIGGER update_patient_onboarding_updated_at
  BEFORE UPDATE ON public.patient_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) TENANT_CLIENT_PROFILE (1:1 com tenants, criada lazy)
CREATE TABLE IF NOT EXISTS public.tenant_client_profile (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                 uuid NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
  source_agency_lead_id     uuid REFERENCES public.agency_leads(id) ON DELETE SET NULL,
  responsavel_nome          text,
  responsavel_whatsapp      text,
  responsavel_email         text,
  cnpj                      text,
  cidade                    text,
  estado                    text,
  especialidade             text,
  num_profissionais         text,
  observacoes_conta         text,
  responsavel_cs            uuid,
  proximo_checkin_at        timestamptz,
  onboarding_completed_at   timestamptz,
  extras                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_client_profile TO authenticated;
GRANT ALL                            ON public.tenant_client_profile TO service_role;

ALTER TABLE public.tenant_client_profile ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant access tenant_client_profile"
  ON public.tenant_client_profile
  FOR ALL
  TO authenticated
  USING     (public.has_tenant_access(auth.uid(), tenant_id))
  WITH CHECK(public.has_tenant_access(auth.uid(), tenant_id));

CREATE POLICY "agency members read tenant_client_profile"
  ON public.tenant_client_profile
  FOR SELECT
  TO authenticated
  USING (public.is_agency_member(auth.uid()));

CREATE POLICY "agency members manage tenant_client_profile"
  ON public.tenant_client_profile
  FOR ALL
  TO authenticated
  USING     (public.is_agency_member(auth.uid()))
  WITH CHECK(public.is_agency_member(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_tenant_client_profile_agency_lead
  ON public.tenant_client_profile (source_agency_lead_id);

CREATE TRIGGER update_tenant_client_profile_updated_at
  BEFORE UPDATE ON public.tenant_client_profile
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
