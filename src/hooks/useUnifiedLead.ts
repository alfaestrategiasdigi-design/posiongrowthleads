import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LeadSource = "lead" | "agency_lead";

export interface SDRQualification {
  goals?: string;
  plans?: string;
  challenges?: string;
  timeline?: string;
  score?: number;
  notes?: string;
  updated_at?: string;
  updated_by?: string | null;
}

export interface UnifiedLeadView {
  source: LeadSource;
  id: string;
  raw: any;
  // normalized
  name: string;
  contactName: string | null;
  whatsapp: string | null;
  email: string | null;
  company: string | null;
  city: string | null;
  volume: string | null; // faturamento_mensal (leads) ou plano_interesse (agency_leads)
  volumeLabel: string;
  proposalValue: number | null;
  tipoPurchase: string | null;

  stage: string;
  origem: string | null;
  createdAt: string;
  notes: string | null;
  sdr: SDRQualification | null;
  tenantId: string | null;
  formFields?: any[];
  facebookMeta?: any;
  sourceLeadId?: string | null;
  formLead?: any | null;
}


function normalize(source: LeadSource, r: any): UnifiedLeadView {
  if (source === "lead") {
    return {
      source,
      id: r.id,
      raw: r,
      name: r.nome_completo || "Lead",
      contactName: r.nome_completo || null,
      whatsapp: r.whatsapp || null,
      email: r.email || null,
      company: r.nome_empresa || null,
      city: r.cidade_estado || null,
      volume: r.faturamento_mensal || null,
      volumeLabel: "Faturamento mensal",
      proposalValue: r.valor_proposta ?? null,
      tipoPurchase: r.tipo_purchase ?? null,

      stage: r.status || "lead",
      origem: r.origem || null,
      createdAt: r.created_at,
      notes: r.observacoes || null,
      sdr: (r.sdr_qualification as SDRQualification) || null,
      tenantId: r.tenant_id || null,
      formFields: r.extras?.form_fields ?? [],
      facebookMeta: r.extras?.facebook ?? null,
    };
  }
  return {
    source,
    id: r.id,
    raw: r,
    name: r.nome_clinica || "Lead",
    contactName: r.responsavel || null,
    whatsapp: r.whatsapp || null,
    email: r.email || null,
    company: r.nome_clinica || null,
    city: [r.cidade, r.estado].filter(Boolean).join(" / ") || null,
    volume: r.plano_interesse || null,
    volumeLabel: "Plano de interesse",
    proposalValue: r.valor_proposta ?? null,
    tipoPurchase: r.plano_interesse ?? null,

    stage: r.stage || "lead",
    origem: r.origem || null,
    createdAt: r.created_at,
    notes: r.notas || null,
    sdr: (r.sdr_qualification as SDRQualification) || null,
    tenantId: r.tenant_id_criado || null,
    formFields: [],
    facebookMeta: null,
  };
}

export function useUnifiedLead(source: LeadSource | null, id: string | null) {
  const [data, setData] = useState<UnifiedLeadView | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!source || !id) return;
    setLoading(true);
    const table = source === "lead" ? "leads" : "agency_leads";
    const { data: row, error } = await supabase.from(table).select("*").eq("id", id).maybeSingle();
    if (!error && row) setData(normalize(source, row));
    setLoading(false);
  }, [source, id]);

  useEffect(() => {
    if (source && id) load();
    else setData(null);
  }, [source, id, load]);

  const saveSDR = useCallback(
    async (sdr: SDRQualification) => {
      if (!source || !id) return { error: new Error("no lead") };
      const table = source === "lead" ? "leads" : "agency_leads";
      const user = (await supabase.auth.getUser()).data.user;
      const payload = {
        ...sdr,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      };
      const { error } = await supabase.from(table).update({ sdr_qualification: payload } as any).eq("id", id);
      if (!error) await load();
      return { error };
    },
    [source, id, load]
  );

  const savePatch = useCallback(
    async (patch: Record<string, any>) => {
      if (!source || !id) return { error: new Error("no lead") };
      const table = source === "lead" ? "leads" : "agency_leads";
      const { error } = await supabase.from(table).update(patch as any).eq("id", id);
      if (!error) await load();
      return { error };
    },
    [source, id, load]
  );

  return { data, loading, reload: load, saveSDR, savePatch };
}
