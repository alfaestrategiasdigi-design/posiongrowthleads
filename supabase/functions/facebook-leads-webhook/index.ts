// Facebook Lead Ads webhook + relay genérico
// GET  → verificação do Meta (hub.challenge)
// POST → recebe leadgen events da Meta OU JSON direto (Zapier/Make/curl)
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

// pega o primeiro valor não-vazio de uma lista de chaves do payload
const pick = (obj: Record<string, any>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
};

// Normaliza field_data do formato Meta { field_data: [{ name, values: ["foo"] }] }
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

async function insertLead(payload: Record<string, string>, meta: {
  facebook_lead_id?: string | null;
  facebook_form_id?: string | null;
  facebook_campaign?: string | null;
  facebook_form_name?: string | null;
  facebook_ad_name?: string | null;
  facebook_adset_name?: string | null;
}) {
  const nome      = pick(payload, ["full_name","nome","nome_completo","name","first_name"]);
  let whatsapp    = pick(payload, ["phone_number","phone","whatsapp","telefone","celular"]);
  if (whatsapp) whatsapp = whatsapp.replace(/^p:\+?/i, "").replace(/\D/g, "");
  const email     = pick(payload, ["email","e_mail"]);
  const empresa   = pick(payload, ["company_name","empresa","clinica","nome_empresa","nome_clinica"]);
  const cidade    = pick(payload, ["city","cidade","cidade_estado"]);
  const especialidade = pick(payload, ["especialidade","specialty","nicho"]);
  const faturamento   = pick(payload, ["faturamento","revenue","faturamento_mensal"]);

  if (!nome && !whatsapp && !email) {
    return { ok: false, error: "Lead sem nome/whatsapp/email — payload não reconhecido" };
  }

  // dedup por facebook_lead_id
  if (meta.facebook_lead_id) {
    const { data: existing } = await admin
      .from("leads").select("id").eq("facebook_lead_id", meta.facebook_lead_id).maybeSingle();
    if (existing) return { ok: true, deduped: true, id: existing.id };
  }

  const { data, error } = await admin.from("leads").insert({
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
    facebook_lead_id: meta.facebook_lead_id,
    facebook_form_id: meta.facebook_form_id,
    facebook_campaign: meta.facebook_campaign,
    utm_source: "facebook",
    utm_medium: "lead_ads",
    utm_campaign: meta.facebook_campaign,
  }).select("id").single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);

  // === Meta verification challenge ===
  if (req.method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    const { data: cfg } = await admin
      .from("facebook_webhook_config").select("verify_token").limit(1).maybeSingle();

    if (mode === "subscribe" && token && cfg?.verify_token && token === cfg.verify_token) {
      return new Response(challenge ?? "", { status: 200, headers: corsHeaders });
    }
    return new Response("forbidden", { status: 403, headers: corsHeaders });
  }

  // === POST: receive lead ===
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }}); }

  const results: any[] = [];

  // Caso 1: Meta webhook { entry: [{ changes: [{ value: { leadgen_id, form_id, page_id, ad_id, campaign_id } }] }] }
  if (Array.isArray(body?.entry)) {
    for (const entry of body.entry) {
      for (const change of entry?.changes ?? []) {
        const v = change?.value ?? {};
        // Sem page_access_token configurado, não conseguimos hidratar via Graph API.
        // Registramos lead com IDs e o usuário pode completar manualmente.
        const r = await insertLead(
          {}, // sem field_data
          {
            facebook_lead_id: v.leadgen_id ?? null,
            facebook_form_id: v.form_id ?? null,
            facebook_campaign: v.campaign_id ?? v.ad_id ?? null,
          }
        );
        results.push(r);
      }
    }
  } else if (Array.isArray(body?.field_data)) {
    // Caso 2: campo único Meta enviado direto
    const flat = flattenFieldData(body.field_data);
    const r = await insertLead(flat, {
      facebook_lead_id: body.id ?? body.leadgen_id ?? null,
      facebook_form_id: body.form_id ?? null,
      facebook_campaign: body.campaign_name ?? body.campaign_id ?? null,
    });
    results.push(r);
  } else {
    // Caso 3: JSON direto (Zapier/Make/etc) — { nome, whatsapp, email, ... }
    const r = await insertLead(body, {
      facebook_lead_id: body.facebook_lead_id ?? body.lead_id ?? null,
      facebook_form_id: body.form_id ?? null,
      facebook_campaign: body.campaign_name ?? body.utm_campaign ?? null,
    });
    results.push(r);
  }

  return new Response(JSON.stringify({ received: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
