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
    sourceLeadId: r.source_lead_id ?? null,
    formLead: null,
  };
}

function mergeFormLead(view: UnifiedLeadView, formLead: any | null): UnifiedLeadView {
  if (!formLead) return view;
  return {
    ...view,
    formLead,
    // Prefer form data as source of truth for these fields
    tipoPurchase: view.tipoPurchase ?? formLead.tipo_purchase ?? null,
    formFields: formLead.extras?.form_fields ?? [],
    facebookMeta: formLead.extras?.facebook ?? {
      campaign: formLead.facebook_campaign,
      campaign_id: formLead.campaign_id_manual,
      form_id: formLead.facebook_form_id,
      form_name: formLead.facebook_form_name,
      ad_name: formLead.facebook_ad_name,
      ad_id: formLead.facebook_ad_id,
      adset_name: formLead.facebook_adset_name,
      adset_id: formLead.facebook_adset_id,
      lead_id: formLead.facebook_lead_id,
      utm_source: formLead.utm_source,
      utm_medium: formLead.utm_medium,
      utm_campaign: formLead.utm_campaign,
      utm_content: formLead.utm_content,
      utm_term: formLead.utm_term,
    },
    sdr: view.sdr ?? ((formLead.sdr_qualification as SDRQualification) ?? null),
  };
}

export function useUnifiedLead(source: LeadSource | null, id: string | null) {
  const [data, setData] = useState<UnifiedLeadView | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!source || !id) return;
    setLoading(true);
    const table = source === "lead" ? "leads" : "agency_leads";

    // No contexto do tenant (/app/...), filtramos no backend os campos de
    // prospecção B2B para evitar expô-los via network/devtools ao dono da clínica.
    const isTenantContext =
      typeof window !== "undefined" && window.location.pathname.startsWith("/app/");
    const TENANT_LEAD_COLUMNS = [
      "id","tenant_id","created_at","status","origem",
      "nome_completo","whatsapp","email","cidade_estado",
      "observacoes","valor_proposta","tipo_purchase",
      "sdr_qualification","extras",
      "facebook_form_id","facebook_form_name","facebook_campaign",
      "utm_source","utm_medium","utm_campaign",
      "mql","sql_qualified",
      "reuniao_agendada_em","reuniao_realizada_em","proposta_enviada_em","fechado_em","motivo_perda",
    ].join(",");
    const selectCols = isTenantContext && source === "lead" ? TENANT_LEAD_COLUMNS : "*";

    const { data: row, error } = await supabase.from(table).select(selectCols).eq("id", id).maybeSingle();
    if (!error && row) {
      let view = normalize(source, row);
      // For agency_leads with a linked form lead, fetch it and merge form-side data
      if (source === "agency_lead" && (row as any).source_lead_id) {
        const { data: formRow } = await supabase
          .from("leads")
          .select(isTenantContext ? TENANT_LEAD_COLUMNS : "*")
          .eq("id", (row as any).source_lead_id)
          .maybeSingle();
        view = mergeFormLead(view, formRow);
      }
      setData(view);
    }
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
