// Facebook Lead Ads webhook
// GET  → verificação do Meta (hub.challenge)
// POST → recebe leadgen events da Meta OU JSON direto (curl/manual)
// Token de página e app_secret são lidos do banco (facebook_webhook_config),
// com fallback para FACEBOOK_PAGE_ACCESS_TOKEN (secret) se o banco estiver vazio.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FB_TOKEN_ENV = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") ?? "";

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function loadConfig() {
  const { data, error } = await admin
    .from("facebook_webhook_config")
    .select("verify_token, page_access_token, app_secret, page_id, default_tenant_id")
    .limit(1).maybeSingle();
  if (error) console.error("[webhook] erro carregando config:", error.message);
  return data;
}

async function verifyHubSignature(secret: string, rawBody: string, header: string | null): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const provided = header.slice("sha256=".length);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== provided.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff === 0;
}

// Roteamento STRICT por form_id. Retorna { matched, tenantId, isMaster }.
// - matched=false  → nenhum tenant nem admin_master mapeou o form → unrouted_leads.
// - matched=true, isMaster=true → lead do POSION (tenantId=null).
// - matched=true, tenantId=uuid → lead da clínica.
async function resolveRoute(formId: string | null): Promise<{ matched: boolean; tenantId: string | null; isMaster: boolean }> {
  if (!formId) return { matched: false, tenantId: null, isMaster: false };
  const { data } = await admin.rpc("resolve_form_routing", { p_form_id: formId });
  const row: any = Array.isArray(data) ? data[0] : data;
  return {
    matched: !!row?.matched,
    tenantId: (row?.tenant_id as string | null) ?? null,
    isMaster: !!row?.is_admin_master,
  };
}

async function fetchLeadFromGraph(leadgenId: string, token: string) {
  try {
    const fields = "id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id";
    const url = `https://graph.facebook.com/v21.0/${leadgenId}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
    console.log(`[webhook] Buscando lead na Graph API: ${leadgenId}`);
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) {
      console.error(`[webhook] Graph API error ${res.status}:`, text);
      return null;
    }
    const json = JSON.parse(text);
    console.log("[webhook] Resposta Graph API:", JSON.stringify(json));
    return json;
  } catch (e) {
    console.error("[webhook] Graph fetch failed:", e);
    return null;
  }
}

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

export async function insertLead(payload: Record<string, string>, meta: {
  facebook_lead_id?: string | null;
  facebook_form_id?: string | null;
  facebook_campaign?: string | null;
  facebook_form_name?: string | null;
  facebook_ad_name?: string | null;
  facebook_adset_name?: string | null;
  tenant_id?: string | null;
}) {
  const nome      = pick(payload, ["full_name","nome","nome_completo","name","first_name"]);
  let whatsapp    = pick(payload, ["phone_number","phone","whatsapp","telefone","celular"]);
  if (whatsapp) whatsapp = whatsapp.replace(/^p:\+?/i, "").replace(/\D/g, "");
  const email     = pick(payload, ["email","e_mail"]);
  const empresa   = pick(payload, ["company_name","empresa","clinica","nome_empresa","nome_clinica"]);
  const cidade    = pick(payload, ["city","cidade","cidade_estado"]);
  const especialidade = pick(payload, ["especialidade","specialty","nicho","você_já_realiza_cirurgias_de_transplante_capilar?"]);
  const faturamento   = pick(payload, ["faturamento","revenue","faturamento_mensal","qual_o_faturamento_médio_mensal_da_sua_clínica_hoje?"]);
  const instagram = pick(payload, ["instagram","qual_o_@_do_seu_instagram?"]);
  const trafego   = pick(payload, ["já_investiu_em_tráfego_pago?","trafego_pago"]);

  const normalized = { nome, whatsapp, email, empresa, cidade, especialidade, faturamento, instagram, trafego, meta };
  console.log("[webhook] Dados normalizados:", JSON.stringify(normalized));

  if (!nome && !whatsapp && !email) {
    console.error("[webhook] Lead sem nome/whatsapp/email — payload bruto:", JSON.stringify(payload));
    return { ok: false, error: "Lead sem nome/whatsapp/email — payload não reconhecido" };
  }

  if (meta.facebook_lead_id) {
    const { data: existing } = await admin
      .from("leads").select("id").eq("facebook_lead_id", meta.facebook_lead_id).maybeSingle();
    if (existing) {
      console.log(`[webhook] Lead duplicado (já existe): ${meta.facebook_lead_id} → ${existing.id}`);
      return { ok: true, deduped: true, id: existing.id };
    }
  }

  const notesParts: string[] = [];
  if (instagram) notesParts.push(`Instagram: ${instagram}`);
  if (trafego)   notesParts.push(`Tráfego pago: ${trafego}`);
  const observacoes = notesParts.length ? notesParts.join(" | ") : null;

  const insertPayload: any = {
    nome_completo: nome ?? "Lead Facebook Ads",
    whatsapp: whatsapp ?? "",
    email,
    nome_empresa: empresa,
    cidade_estado: cidade,
    especialidade,
    faturamento_mensal: faturamento,
    status: "lead",
    origem: "facebook_ads",
    revendedor_iniciante: false,
    facebook_lead_id: meta.facebook_lead_id,
    facebook_form_id: meta.facebook_form_id,
    facebook_campaign: meta.facebook_campaign,
    facebook_form_name: meta.facebook_form_name,
    facebook_ad_name: meta.facebook_ad_name,
    facebook_adset_name: meta.facebook_adset_name,
    observacoes,
    utm_source: "facebook",
    utm_medium: "paid",
    utm_campaign: meta.facebook_campaign ?? null,
    utm_content: meta.facebook_ad_name ?? null,
    utm_term: meta.facebook_adset_name ?? null,
  };
  if (meta.tenant_id) insertPayload.tenant_id = meta.tenant_id;

  const { data, error } = await admin.from("leads").insert(insertPayload).select("id").single();

  if (error) {
    console.error("[webhook] Erro ao salvar lead:", error.message, error.details ?? "");
    return { ok: false, error: error.message };
  }
  console.log(`[webhook] Lead salvo: ${data.id} (fb_lead_id=${meta.facebook_lead_id ?? "n/a"})`);
  return { ok: true, id: data.id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const url = new URL(req.url);
  const cfg = await loadConfig();

  if (req.method === "GET") {
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    console.log(`[webhook] GET challenge mode=${mode} token_match=${token === cfg?.verify_token}`);
    if (mode === "subscribe" && token && cfg?.verify_token && token === cfg.verify_token) {
      return new Response(challenge ?? "", { status: 200, headers: corsHeaders });
    }
    return new Response("forbidden", { status: 403, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  const rawBody = await req.text();
  console.log("[webhook] Webhook recebido — body:", rawBody.slice(0, 2000));

  if (cfg?.app_secret) {
    const sig = req.headers.get("x-hub-signature-256");
    const ok = await verifyHubSignature(cfg.app_secret, rawBody, sig);
    if (!ok) {
      console.error("[webhook] Assinatura HMAC inválida — header:", sig);
      return new Response(JSON.stringify({ error: "invalid signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  let body: any;
  try { body = JSON.parse(rawBody); }
  catch (e) {
    console.error("[webhook] JSON inválido:", e);
    return new Response(JSON.stringify({ error: "invalid json" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" }});
  }

  const FB_PAGE_TOKEN = cfg?.page_access_token || FB_TOKEN_ENV || "";
  if (!FB_PAGE_TOKEN) {
    console.error("[webhook] FACEBOOK_PAGE_ACCESS_TOKEN ausente (banco + secret vazios) — leads do Meta serão registrados só com leadgen_id");
  }

  const results: any[] = [];
  const sigValid = cfg?.app_secret
    ? true // se chegou aqui com app_secret, já passou na validação acima
    : null;

  if (Array.isArray(body?.entry)) {
    for (const entry of body.entry) {
      for (const change of entry?.changes ?? []) {
        const v = change?.value ?? {};
        const leadgenId = v.leadgen_id ?? null;
        console.log(`[webhook] Leadgen ID: ${leadgenId}`);

        // Persistência do evento bruto (auditoria)
        const { data: evt } = await admin.from("facebook_webhook_events").insert({
          signature_valid: sigValid,
          page_id: v.page_id ? String(v.page_id) : (entry.id ? String(entry.id) : null),
          form_id: v.form_id ? String(v.form_id) : null,
          leadgen_id: leadgenId ? String(leadgenId) : null,
          ad_id: v.ad_id ? String(v.ad_id) : null,
          campaign_id: v.campaign_id ? String(v.campaign_id) : null,
          raw_body: change,
        }).select("id").single();
        const evtId = evt?.id ?? null;

        let flat: Record<string, string> = {};
        let adName: string | null = null;
        let adsetName: string | null = null;
        let campaignName: string | null = null;

        if (leadgenId && FB_PAGE_TOKEN) {
          const full = await fetchLeadFromGraph(String(leadgenId), FB_PAGE_TOKEN);
          if (full) {
            flat = flattenFieldData(full.field_data);
            adName = full.ad_name ?? null;
            adsetName = full.adset_name ?? null;
            campaignName = full.campaign_name ?? null;
          }
        }

        // Roteamento STRICT por form_id (sem fallback via ad_account/page).
        const pageIdForRoute = v.page_id ? String(v.page_id) : (entry.id ? String(entry.id) : null);
        const formIdForRoute = v.form_id ? String(v.form_id) : null;
        const route = await resolveRoute(formIdForRoute);

        if (!route.matched) {
          const ur = await admin.from("unrouted_leads").insert({
            raw_payload: { entry_id: entry.id, change, graph_field_data: flat },
            form_id: formIdForRoute,
            page_id: pageIdForRoute,
            ad_account_id: null,
            facebook_lead_id: leadgenId ? String(leadgenId) : null,
            nome: flat["full_name"] ?? flat["nome"] ?? null,
            whatsapp: flat["phone_number"] ?? flat["phone"] ?? null,
            email: flat["email"] ?? null,
          }).select("id").single();
          results.push({ ok: true, unrouted: true, id: ur.data?.id ?? null });
          if (evtId) {
            await admin.from("facebook_webhook_events").update({
              processed: false, error: "no form mapping",
            }).eq("id", evtId);
          }
          continue;
        }
        // matched: pode ser tenant (route.tenantId) OU admin_master (tenantId=null)
        const routedTenant = route.tenantId;


        const r = await insertLead(flat, {
          facebook_lead_id: leadgenId,
          facebook_form_id: v.form_id ?? null,
          facebook_campaign: campaignName ?? v.campaign_id ?? v.ad_id ?? null,
          facebook_form_name: null,
          facebook_ad_name: adName,
          facebook_adset_name: adsetName,
          tenant_id: routedTenant,
        });
        results.push(r);

        if (evtId) {
          await admin.from("facebook_webhook_events").update({
            processed: !!r.ok,
            lead_id: r.id ?? null,
            error: r.ok ? null : (r.error ?? null),
          }).eq("id", evtId);
        }
      }
    }
  } else if (Array.isArray(body?.field_data)) {
    const flat = flattenFieldData(body.field_data);
    const route = await resolveRoute(body.form_id ? String(body.form_id) : null);
    if (!route.matched) {
      const ur = await admin.from("unrouted_leads").insert({
        raw_payload: body,
        form_id: body.form_id ?? null,
        page_id: body.page_id ?? null,
        ad_account_id: body.ad_account_id ?? null,
        facebook_lead_id: body.id ?? body.leadgen_id ?? null,
        nome: flat["full_name"] ?? flat["nome"] ?? null,
        whatsapp: flat["phone_number"] ?? flat["phone"] ?? null,
        email: flat["email"] ?? null,
      }).select("id").single();
      results.push({ ok: true, unrouted: true, id: ur.data?.id ?? null });
    } else {
      const r = await insertLead(flat, {
        facebook_lead_id: body.id ?? body.leadgen_id ?? null,
        facebook_form_id: body.form_id ?? null,
        facebook_campaign: body.campaign_name ?? body.campaign_id ?? null,
        facebook_form_name: body.form_name ?? null,
        facebook_ad_name: body.ad_name ?? null,
        facebook_adset_name: body.adset_name ?? null,
        tenant_id: route.tenantId,
      });
      results.push(r);
    }
  } else {
    const route = await resolveRoute(body.form_id ? String(body.form_id) : null);
    if (!route.matched) {
      const ur = await admin.from("unrouted_leads").insert({
        raw_payload: body,
        form_id: body.form_id ?? null,
        page_id: body.page_id ?? null,
        ad_account_id: body.ad_account_id ?? null,
        facebook_lead_id: body.facebook_lead_id ?? body.lead_id ?? body.id ?? null,
        nome: body.nome ?? body.full_name ?? null,
        whatsapp: body.whatsapp ?? body.phone_number ?? null,
        email: body.email ?? null,
      }).select("id").single();
      results.push({ ok: true, unrouted: true, id: ur.data?.id ?? null });
    } else {
      const r = await insertLead(body, {
        facebook_lead_id: body.facebook_lead_id ?? body.lead_id ?? body.id ?? null,
        facebook_form_id: body.form_id ?? null,
        facebook_campaign: body.campaign_name ?? body.utm_campaign ?? null,
        facebook_form_name: body.form_name ?? null,
        facebook_ad_name: body.ad_name ?? null,
        facebook_adset_name: body.adset_name ?? null,
        tenant_id: route.tenantId,

      });
      results.push(r);
    }
  }


  console.log(`[webhook] Processados: ${results.length}`, JSON.stringify(results));
  return new Response(JSON.stringify({ received: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
