// Facebook Conversions API (server-side) event dispatcher.
// Supports ViewContent, InitiateCheckout, Lead, Purchase with browser-CAPI dedup
// via stable `event_id`, and server-side dedup via public.capi_events_sent.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const SUPPORTED_EVENTS = new Set(["ViewContent", "InitiateCheckout", "Lead", "Purchase", "CompleteRegistration", "Schedule"]);

async function sha256(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const onlyDigits = (s: string | null | undefined) => (s || "").replace(/\D/g, "");
const norm = (s: string | null | undefined) => (s || "").toString().toLowerCase().trim();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function splitCityState(cs?: string | null): { city?: string; state?: string } {
  if (!cs) return {};
  const parts = cs.split(/\s*[-/,]\s*/);
  const city = norm(parts[0]).replace(/\s+/g, "");
  const st = norm(parts[1] || "").slice(0, 2);
  return { city: city || undefined, state: st || undefined };
}

let cachedDispatchToken: { value: string; expiresAt: number } | null = null;
async function getDispatchToken(): Promise<string | null> {
  if (cachedDispatchToken && cachedDispatchToken.expiresAt > Date.now()) return cachedDispatchToken.value;
  const { data } = await admin.from("edge_internal_config").select("dispatch_token").eq("id", 1).maybeSingle();
  const value = (data as any)?.dispatch_token ?? null;
  if (value) cachedDispatchToken = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

async function authorize(req: Request): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "unauthorized" };
  if (token === SERVICE_KEY) return { ok: true };
  const internal = await getDispatchToken();
  if (internal && token === internal) return { ok: true };
  try {
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: claimsData } = await userClient.auth.getClaims(token);
    const sub = (claimsData?.claims as any)?.sub as string | undefined;
    if (!sub) return { ok: false, status: 401, error: "invalid_session" };
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: sub, _role: "admin" });
    return isAdmin ? { ok: true } : { ok: false, status: 403, error: "forbidden" };
  } catch {
    return { ok: false, status: 401, error: "invalid_token" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const authz = await authorize(req);
  if (!authz.ok) return json({ ok: false, error: authz.error }, authz.status);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const tenant_id: string | undefined = body?.tenant_id;
  const lead_id: string | undefined = body?.lead_id;
  const event_name: string = body?.event_name || "Lead";
  const test_mode: boolean = Boolean(body?.test);

  if (!tenant_id) return json({ ok: false, error: "tenant_id required" }, 400);
  if (!SUPPORTED_EVENTS.has(event_name)) return json({ ok: false, error: `unsupported event_name: ${event_name}` }, 400);

  const { data: cfg, error: cfgErr } = await admin
    .from("tenant_capi_config")
    .select("pixel_id, access_token, default_event, test_event_code, enabled")
    .eq("tenant_id", tenant_id)
    .maybeSingle();

  if (cfgErr) return json({ ok: false, error: cfgErr.message }, 500);
  if (!cfg || !cfg.enabled) return json({ ok: false, error: "capi_disabled" }, 200);
  if (!cfg.pixel_id || !cfg.access_token) return json({ ok: false, error: "missing_pixel_or_token" }, 400);

  // Load lead when relevant
  let lead: any = null;
  if (lead_id) {
    const { data } = await admin
      .from("leads")
      .select("id, nome_completo, whatsapp, email, valor_proposta, tenant_id, cidade_estado, cep, especialidade, meta_fbp, meta_fbc, visitor_id")
      .eq("id", lead_id)
      .maybeSingle();
    if (data && data.tenant_id && data.tenant_id !== tenant_id) {
      return json({ ok: false, error: "tenant_mismatch" }, 403);
    }
    lead = data;
  }

  // Build event_id (dedup key)
  const event_id: string = body?.event_id
    || (lead_id
      ? `${event_name.toLowerCase()}:${lead_id}`
      : `${event_name.toLowerCase()}:${tenant_id}:${body?.visitor_id || crypto.randomUUID()}`);

  // Server-side dedup
  const { error: dedupErr } = await admin
    .from("capi_events_sent")
    .insert({ event_id, tenant_id, lead_id: lead_id ?? null, event_name });
  if (dedupErr) {
    if ((dedupErr as any).code === "23505") {
      return json({ ok: true, deduped: true, event_id }, 200);
    }
    return json({ ok: false, error: dedupErr.message }, 500);
  }

  // Assemble user_data
  const phone = onlyDigits(body?.lead_phone ?? lead?.whatsapp);
  const phoneE164 = phone && phone.length >= 10 ? (phone.startsWith("55") ? phone : `55${phone}`) : phone;
  const email = norm(body?.lead_email ?? lead?.email);
  const name = (body?.lead_name ?? lead?.nome_completo ?? "").toString().trim();
  const { city, state } = splitCityState(body?.lead_city_state ?? lead?.cidade_estado);
  const zip = onlyDigits(body?.lead_zip ?? lead?.cep);
  const fbp = body?.fbp ?? lead?.meta_fbp ?? null;
  const fbc = body?.fbc ?? lead?.meta_fbc ?? null;
  const client_ua = body?.client_ua ?? req.headers.get("user-agent") ?? "POSION-CRM";
  const client_ip =
    body?.client_ip
    ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip");
  const external_id_seed = lead_id ?? body?.visitor_id ?? lead?.visitor_id;

  const user_data: Record<string, unknown> = {};
  if (phoneE164) user_data.ph = [await sha256(phoneE164)];
  if (email) user_data.em = [await sha256(email)];
  if (name) {
    const parts = name.toLowerCase().split(/\s+/);
    if (parts[0]) user_data.fn = [await sha256(parts[0])];
    if (parts.length > 1) user_data.ln = [await sha256(parts[parts.length - 1])];
  }
  if (city) user_data.ct = [await sha256(city)];
  if (state) user_data.st = [await sha256(state)];
  if (zip) user_data.zp = [await sha256(zip)];
  user_data.country = [await sha256("br")];
  if (external_id_seed) user_data.external_id = [await sha256(String(external_id_seed))];
  if (fbp) user_data.fbp = fbp;
  if (fbc) user_data.fbc = fbc;
  if (client_ip) user_data.client_ip_address = client_ip;
  user_data.client_user_agent = client_ua;

  // custom_data per event
  const value = Number(body?.lead_value ?? lead?.valor_proposta ?? 0) || 0;
  const category = lead?.especialidade || body?.content_category || null;
  const custom_data: Record<string, unknown> = {
    currency: "BRL",
    content_name: body?.content_name
      || (event_name === "Purchase" ? (name ? `Lead Fechado - ${name}` : "Lead Fechado")
        : event_name === "Lead" ? "Lead Formulário"
        : event_name === "InitiateCheckout" ? "Início de Formulário"
        : "Visita"),
  };
  if (category) custom_data.content_category = category;
  if (event_name === "Purchase") { custom_data.value = value; custom_data.order_id = lead_id ?? null; }
  else if (event_name === "Lead") { custom_data.value = value || 1; }

  const action_source = body?.action_source || (event_name === "Purchase" || event_name === "Lead" ? "system_generated" : "website");
  const event_source_url = body?.event_source_url || null;

  const payload: Record<string, unknown> = {
    data: [{
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_id,
      action_source,
      event_source_url,
      user_data,
      custom_data,
    }],
  };
  if (test_mode && cfg.test_event_code) (payload as any).test_event_code = cfg.test_event_code;

  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(cfg.pixel_id)}/events?access_token=${encodeURIComponent(cfg.access_token)}`;
  let httpStatus = 0; let respJson: any = null; let errorText: string | null = null;
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    httpStatus = r.status;
    respJson = await r.json().catch(() => null);
  } catch (e) { errorText = String(e); }

  const ok = httpStatus >= 200 && httpStatus < 300 && !errorText;

  // On failure, remove dedup row so retries can succeed
  if (!ok) {
    await admin.from("capi_events_sent").delete().eq("event_id", event_id);
  }

  await admin.from("facebook_capi_logs").insert({
    tenant_id,
    lead_id: lead_id ?? null,
    event_name,
    status: ok ? "success" : "error",
    http_status: httpStatus || null,
    request: {
      event_id,
      action_source,
      custom_data,
      user_data_keys: Object.keys(user_data),
    },
    response: respJson,
    error: errorText,
  });

  return json({ ok, event_id, http_status: httpStatus, response: respJson, error: errorText }, ok ? 200 : 502);
});
