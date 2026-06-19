// Importação retroativa de leads do Facebook Lead Ads.
// POST body: { form_ids?: string[], max_per_form?: number }
// Se form_ids estiver vazio, busca todos os formulários da página.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const FB_TOKEN_ENV = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") ?? "";

const pick = (obj: Record<string, any>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
};
function flattenFieldData(arr: any[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    const name = (item?.name ?? "").toString().toLowerCase();
    const value = Array.isArray(item?.values) ? item.values[0] : item?.value;
    if (name && value != null) out[name] = String(value);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (!claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roleOk } = await admin.rpc("has_role", {
    _user_id: claims.claims.sub, _role: "admin",
  });
  if (!roleOk) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: any = {};
  try { payload = await req.json(); } catch { /* no body */ }
  const requestedForms: string[] = Array.isArray(payload.form_ids) ? payload.form_ids : [];
  const maxPerForm: number = Number(payload.max_per_form ?? 200);

  const { data: cfg } = await admin
    .from("facebook_webhook_config").select("page_access_token, page_id, default_tenant_id").limit(1).maybeSingle();
  const token = cfg?.page_access_token || FB_TOKEN_ENV;
  if (!token) {
    return new Response(JSON.stringify({ error: "Token do Facebook não configurado (banco e secret vazios)" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Resolve list of forms to import
  let formIds: string[] = requestedForms.slice();
  let formsMeta: Record<string, { name?: string }> = {};
  if (!formIds.length) {
    if (!cfg?.page_id) {
      return new Response(JSON.stringify({ error: "page_id não configurado e nenhum form_ids enviado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const r = await fetch(`https://graph.facebook.com/v21.0/${cfg.page_id}/leadgen_forms?fields=id,name&limit=100&access_token=${encodeURIComponent(token)}`);
    const j = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Falha listando forms", detail: j }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    for (const f of j.data ?? []) {
      formIds.push(f.id);
      formsMeta[f.id] = { name: f.name };
    }
  }

  const summary: any[] = [];

  for (const formId of formIds) {
    // pega metadata do form (nome) se ainda não temos
    if (!formsMeta[formId]) {
      try {
        const r = await fetch(`https://graph.facebook.com/v21.0/${formId}?fields=name&access_token=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (r.ok) formsMeta[formId] = { name: j.name };
      } catch { /* ignore */ }
    }
    const formName = formsMeta[formId]?.name ?? null;

    let imported = 0, deduped = 0, failed = 0, fetched = 0;
    let url: string | null =
      `https://graph.facebook.com/v21.0/${formId}/leads?fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&limit=50&access_token=${encodeURIComponent(token)}`;

    while (url && fetched < maxPerForm) {
      const r = await fetch(url);
      const j: any = await r.json();
      if (!r.ok) {
        summary.push({ form_id: formId, form_name: formName, error: j?.error?.message ?? `HTTP ${r.status}`, imported, deduped, failed, fetched });
        url = null;
        break;
      }
      for (const lead of j.data ?? []) {
        fetched++;
        const flat = flattenFieldData(lead.field_data);
        const nome      = pick(flat, ["full_name","nome","nome_completo","name","first_name"]);
        let whatsapp    = pick(flat, ["phone_number","phone","whatsapp","telefone","celular"]);
        if (whatsapp) whatsapp = whatsapp.replace(/^p:\+?/i, "").replace(/\D/g, "");
        const email     = pick(flat, ["email","e_mail"]);
        const empresa   = pick(flat, ["company_name","empresa","clinica","nome_empresa","nome_clinica"]);
        const cidade    = pick(flat, ["city","cidade","cidade_estado"]);
        const especialidade = pick(flat, ["especialidade","specialty","nicho","você_já_realiza_cirurgias_de_transplante_capilar?"]);
        const faturamento   = pick(flat, ["faturamento","revenue","faturamento_mensal","qual_o_faturamento_médio_mensal_da_sua_clínica_hoje?"]);
        const instagram = pick(flat, ["instagram","qual_o_@_do_seu_instagram?"]);
        const trafego   = pick(flat, ["já_investiu_em_tráfego_pago?","trafego_pago"]);

        if (!nome && !whatsapp && !email) { failed++; continue; }

        const { data: existing } = await admin
          .from("leads").select("id").eq("facebook_lead_id", lead.id).maybeSingle();
        if (existing) { deduped++; continue; }

        const observacoesParts: string[] = [];
        if (instagram) observacoesParts.push(`Instagram: ${instagram}`);
        if (trafego)   observacoesParts.push(`Tráfego pago: ${trafego}`);

        const { error } = await admin.from("leads").insert({
          nome_completo: nome ?? "Lead Facebook Ads",
          whatsapp: whatsapp ?? "",
          email,
          nome_empresa: empresa,
          cidade_estado: cidade,
          especialidade,
          faturamento_mensal: faturamento,
          status: "novo",
          origem: "facebook_ads",
          revendedor_iniciante: false,
          facebook_lead_id: lead.id,
          facebook_form_id: lead.form_id ?? formId,
          facebook_form_name: formName,
          facebook_campaign: lead.campaign_name ?? null,
          facebook_ad_name: lead.ad_name ?? null,
          facebook_adset_name: lead.adset_name ?? null,
          observacoes: observacoesParts.length ? observacoesParts.join(" | ") : null,
          utm_source: "facebook",
          utm_medium: "paid",
          utm_campaign: lead.campaign_name ?? null,
          utm_content: lead.ad_name ?? null,
          utm_term: lead.adset_name ?? null,
          tenant_id: (cfg as any)?.default_tenant_id ?? null,
          created_at: lead.created_time ?? undefined,
        } as any);
        if (error) {
          console.error("[backfill] erro insert:", error.message);
          failed++;
        } else {
          imported++;
        }
      }
      url = j.paging?.next ?? null;
    }

    summary.push({ form_id: formId, form_name: formName, fetched, imported, deduped, failed });
  }

  const totals = summary.reduce((acc, s) => ({
    fetched: acc.fetched + (s.fetched ?? 0),
    imported: acc.imported + (s.imported ?? 0),
    deduped: acc.deduped + (s.deduped ?? 0),
    failed: acc.failed + (s.failed ?? 0),
  }), { fetched: 0, imported: 0, deduped: 0, failed: 0 });

  return new Response(JSON.stringify({ ok: true, totals, by_form: summary }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
