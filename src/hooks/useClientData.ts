import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type ClientKind = "patient" | "tenant_client";

export interface PatientRow {
  id: string;
  tenant_id: string;
  name: string;
  whatsapp: string | null;
  email: string | null;
  birth_date: string | null;
  cpf: string | null;
  sexo: string | null;
  endereco: any;
  tags: string[] | null;
  origem: string | null;
  status: string | null;
  primeiro_contato: string | null;
  observacoes: string | null;
  promoted_at: string | null;
  source_lead_id: string | null;
  source_form_lead_id: string | null;
  extras: any;
  created_at: string;
}

export interface TenantClientRow {
  id: string;
  tenant_id: string;
  cnpj: string | null;
  cidade: string | null;
  estado: string | null;
  especialidade: string | null;
  num_profissionais: string | null;
  responsavel_nome: string | null;
  responsavel_whatsapp: string | null;
  responsavel_email: string | null;
  responsavel_cs: string | null;
  proximo_checkin_at: string | null;
  observacoes_conta: string | null;
  onboarding_completed_at: string | null;
  source_agency_lead_id: string | null;
  extras: any;
  created_at: string;
  tenant_name?: string | null;
  tenant_slug?: string | null;
}

export interface PatientOnboardingRow {
  id: string;
  patient_id: string;
  objetivo_principal: string | null;
  procedimento_interesse: string | null;
  negociacao_status: string | null;
  valor_negociado: number | null;
  forma_pagamento: string | null;
  como_conheceu: string | null;
  melhor_horario_contato: string | null;
  proximo_retorno_at: string | null;
  responsavel_clinico: string | null;
  observacoes: string | null;
  onboarding_completed_at: string | null;
}

export interface MedicalRecordRow {
  id: string;
  patient_id: string | null;
  record_type: string;
  chief_complaint: string | null;
  allergies: string | null;
  medications: string | null;
  medical_history: string | null;
  aesthetic_history: string | null;
  diagnosis: string | null;
  treatment_plan: string | null;
  attachments: any;
  consent_signed: boolean | null;
  consent_signed_at: string | null;
  professional_name: string | null;
  notes: string | null;
  created_at: string;
}

export interface SaleRow {
  id: string;
  amount: number;
  amount_paid: number;
  amount_pending: number;
  sale_date: string;
  payment_status: string;
  procedure_name: string | null;
  seller_name: string | null;
}

export interface AgencyContractRow {
  id: string;
  cliente_nome: string;
  valor_total: number;
  valor_comissao: number | null;
  status: string;
  data_assinatura: string;
  duracao_meses: number | null;
  observacoes: string | null;
}

export interface SaasContractRow {
  id: string;
  plan: string;
  mrr: number;
  billing_cycle: string;
  status: string;
  started_at: string;
  renews_at: string | null;
  canceled_at: string | null;
  notes: string | null;
}

export interface ClientData {
  kind: ClientKind;
  patient?: PatientRow;
  tenantClient?: TenantClientRow;
  onboarding: PatientOnboardingRow | null;
  medicalRecords: MedicalRecordRow[];
  sales: SaleRow[];
  agencyContracts: AgencyContractRow[];
  saasContracts: SaasContractRow[];
}

export function useClientData(kind: ClientKind | null, id: string | null) {
  const [data, setData] = useState<ClientData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!kind || !id) return;
    setLoading(true);
    try {
      if (kind === "patient") {
        const { data: p } = await supabase.from("patients").select("*").eq("id", id).maybeSingle();
        if (!p) { setData(null); return; }
        const [{ data: onb }, { data: mrs }, { data: sls }] = await Promise.all([
          supabase.from("patient_onboarding").select("*").eq("patient_id", id).maybeSingle(),
          supabase.from("medical_records").select("*").eq("patient_id", id).order("created_at", { ascending: false }),
          supabase.from("sales").select("id,amount,amount_paid,amount_pending,sale_date,payment_status,procedure_name,seller_name").eq("patient_id", id).order("sale_date", { ascending: false }),
        ]);
        setData({
          kind: "patient",
          patient: p as PatientRow,
          onboarding: (onb as PatientOnboardingRow) ?? null,
          medicalRecords: (mrs as MedicalRecordRow[]) ?? [],
          sales: (sls as SaleRow[]) ?? [],
          agencyContracts: [],
          saasContracts: [],
        });
      } else {
        // tenant_client: id is tenant_id
        const [{ data: tc }, { data: tenant }] = await Promise.all([
          supabase.from("tenant_client_profile").select("*").eq("tenant_id", id).maybeSingle(),
          supabase.from("tenants").select("name,slug").eq("id", id).maybeSingle(),
        ]);
        const [{ data: ac }, { data: sc }] = await Promise.all([
          supabase.from("agency_contracts").select("*").eq("tenant_id", id).order("data_assinatura", { ascending: false }),
          supabase.from("saas_contracts").select("*").eq("tenant_id", id).order("started_at", { ascending: false }),
        ]);
        const tcRow: TenantClientRow = (tc as any) ?? {
          id: "", tenant_id: id, cnpj: null, cidade: null, estado: null,
          especialidade: null, num_profissionais: null, responsavel_nome: null,
          responsavel_whatsapp: null, responsavel_email: null, responsavel_cs: null,
          proximo_checkin_at: null, observacoes_conta: null, onboarding_completed_at: null,
          source_agency_lead_id: null, extras: {}, created_at: "",
        };
        tcRow.tenant_name = (tenant as any)?.name ?? null;
        tcRow.tenant_slug = (tenant as any)?.slug ?? null;
        setData({
          kind: "tenant_client",
          tenantClient: tcRow,
          onboarding: null,
          medicalRecords: [],
          sales: [],
          agencyContracts: (ac as AgencyContractRow[]) ?? [],
          saasContracts: (sc as SaasContractRow[]) ?? [],
        });
      }
    } finally {
      setLoading(false);
    }
  }, [kind, id]);

  useEffect(() => {
    if (kind && id) load();
    else setData(null);
  }, [kind, id, load]);

  return { data, loading, reload: load };
}
