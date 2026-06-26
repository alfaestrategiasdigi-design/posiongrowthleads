// Facebook Conversions API (server-side) event dispatcher.
// Loads per-tenant pixel/access_token from public.tenant_capi_config,
// hashes PII (SHA-256), posts to Graph API, and logs the result.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function onlyDigits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const tenant_id: string | undefined = body?.tenant_id;
  const lead_id: string | undefined = body?.lead_id;
  const event_name_override: string | undefined = body?.event_name;
  const test_mode: boolean = Boolean(body?.test);
  if (!tenant_id) return json({ ok: false, error: "tenant_id required" }, 400);

  // Load tenant config (server-side; never trust client tokens)
  const { data: cfg, error: cfgErr } = await admin
    .from("tenant_capi_config")
    .select("pixel_id, access_token, default_event, test_event_code, enabled")
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  if (cfgErr) return json({ ok: false, error: cfgErr.message }, 500);
  if (!cfg || !cfg.enabled) return json({ ok: false, error: "capi_disabled" }, 200);
  if (!cfg.pixel_id || !cfg.access_token) return json({ ok: false, error: "missing_pixel_or_token" }, 400);

  // Resolve lead (optional but typical)
  let lead: any = null;
  if (lead_id) {
    const { data } = await admin
      .from("leads")
      .select("id, nome_completo, whatsapp, email, valor_proposta, tenant_id, fbp, fbc")
      .eq("id", lead_id)
      .maybeSingle();
    if (data && data.tenant_id && data.tenant_id !== tenant_id) {
      return json({ ok: false, error: "tenant_mismatch" }, 403);
    }
    lead = data;
  }

  const phone = onlyDigits(body?.lead_phone ?? lead?.whatsapp);
  const email = (body?.lead_email ?? lead?.email ?? "").toString().toLowerCase().trim();
  const name = (body?.lead_name ?? lead?.nome_completo ?? "").toString().trim();
  const value = Number(body?.lead_value ?? lead?.valor_proposta ?? 0) || 0;
  const event_name = event_name_override || cfg.default_event || "Purchase";

  const user_data: Record<string, unknown> = {};
  if (phone) user_data.ph = [await sha256(phone)];
  if (email) user_data.em = [await sha256(email)];
  if (name) {
    const parts = name.toLowerCase().split(/\s+/);
    if (parts[0]) user_data.fn = [await sha256(parts[0])];
    if (parts.length > 1) user_data.ln = [await sha256(parts[parts.length - 1])];
  }
  user_data.client_user_agent = "POSION-CRM";

  const event_id = `${tenant_id}:${lead_id ?? "manual"}:${event_name}`;
  const payload: Record<string, unknown> = {
    data: [{
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id, // for client/server dedup
      action_source: "system_generated",
      user_data,
      custom_data: {
        value,
        currency: "BRL",
        order_id: lead_id ?? null,
        content_name: name ? `Lead Fechado - ${name}` : "Lead Fechado",
      },
    }],
  };
  if (test_mode && cfg.test_event_code) {
    (payload as any).test_event_code = cfg.test_event_code;
  }

  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(cfg.pixel_id)}/events?access_token=${encodeURIComponent(cfg.access_token)}`;
  let httpStatus = 0;
  let respJson: any = null;
  let errorText: string | null = null;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    httpStatus = r.status;
    respJson = await r.json().catch(() => null);
  } catch (e) {
    errorText = String(e);
  }

  const ok = httpStatus >= 200 && httpStatus < 300 && !errorText;
  await admin.from("facebook_capi_logs").insert({
    tenant_id,
    lead_id: lead_id ?? null,
    event_name,
    status: ok ? "success" : "error",
    http_status: httpStatus || null,
    request: { ...payload, _redacted: true, data: [{ ...(payload as any).data[0], _user_data_keys: Object.keys(user_data) }] },
    response: respJson,
    error: errorText,
  });

  return json({ ok, http_status: httpStatus, response: respJson, error: errorText }, ok ? 200 : 502);
});
