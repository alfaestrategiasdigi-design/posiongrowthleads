// Salva config da Evolution API e busca o QR Code para parear o WhatsApp.
// POST body: { instance_url, api_key, instance_name, tenant_id? }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: userRes } = await userClient.auth.getUser(token);
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const instance_url = normalizeBase(String(body.instance_url ?? ""));
  const api_key = String(body.api_key ?? "").trim();
  const instance_name = String(body.instance_name ?? "").trim();
  const tenant_id: string | null = body.tenant_id ?? null;

  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (tenant_id) {
    const { data: hasTenantAccess } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: tenant_id });
    if (!isAdmin && !hasTenantAccess) return json({ error: "Sem permissão para configurar este cliente" }, 403);
  } else if (!isAdmin) {
    return json({ error: "Somente o admin master pode configurar a instância global" }, 403);
  }

  if (!instance_url || !api_key || !instance_name) {
    return json({ error: "instance_url, api_key e instance_name são obrigatórios" }, 400);
  }

  // Upsert connection (tenant_id null = global Posion)
  let existingQuery = admin.from("zapi_connections")
    .select("id, webhook_secret")
    .eq("provider", "evolution");
  existingQuery = tenant_id ? existingQuery.eq("tenant_id", tenant_id) : existingQuery.is("tenant_id", null);
  const existing = await existingQuery.order("updated_at", { ascending: false }).limit(1).maybeSingle();

  const webhook_secret = existing.data?.webhook_secret ?? crypto.randomUUID();
  const payload = {
    provider: "evolution",
    instance_url, api_key, instance_name,
    tenant_id, webhook_secret,
    instance_id: instance_name, token: api_key, client_token: api_key,
    status: "connecting",
    updated_at: new Date().toISOString(),
  };
  let connectionId = existing.data?.id as string | undefined;
  if (connectionId) {
    await admin.from("zapi_connections").update(payload).eq("id", connectionId);
  } else {
    const inserted = await admin.from("zapi_connections").insert(payload).select("id").maybeSingle();
    connectionId = inserted.data?.id;
  }

  const webhookUrl = await buildWebhookUrl(admin, tenant_id, webhook_secret);

  // Ensure instance exists, then fetch QR.
  // If it does not exist yet, create it and configure the webhook automatically.
  try {
    let r = await fetch(`${instance_url}/instance/connect/${encodeURIComponent(instance_name)}`, {
      headers: { apikey: api_key },
    });
    let j = await safeJson(r);
    if (!r.ok && (r.status === 404 || r.status === 400)) {
      const created = await createInstance(instance_url, api_key, instance_name);
      if (created.ok) {
        r = created.response;
        j = created.body;
      }
    }
    if (!r.ok) {
      return json({ error: "Falha ao chamar Evolution API", detail: j, status: r.status }, 502);
    }
    await configureWebhook(instance_url, api_key, instance_name, webhookUrl);
    const qr = extractQr(j);
    const state = j?.instance?.state ?? j?.state ?? j?.instance?.status ?? null;
    const status = state === "open" || (!qr && (j?.instance || j?.instanceName)) ? "connected" : "connecting";
    if (connectionId) {
      await admin.from("zapi_connections").update({ status, webhook_url: webhookUrl, updated_at: new Date().toISOString() }).eq("id", connectionId);
    }
    return json({
      ok: true,
      qr,
      pairingCode: j?.pairingCode ?? null,
      raw: j,
      webhook_secret,
      webhook_url: webhookUrl,
      status,
    });
  } catch (e) {
    return json({ error: "Erro de rede ao conectar com Evolution", detail: String(e) }, 502);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function safeJson(r: Response): Promise<any> {
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

function extractQr(j: any): string | null {
  return j?.base64 ?? j?.qrcode?.base64 ?? j?.qrcode?.code ?? j?.qrCode ?? j?.code ?? null;
}

async function createInstance(base: string, apiKey: string, instanceName: string): Promise<{ ok: boolean; response: Response; body: any }> {
  const response = await fetch(`${base}/instance/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({
      instanceName, qrcode: true, integration: "WHATSAPP-BAILEYS",
      syncFullHistory: true, alwaysOnline: true, readMessages: true, readStatus: true,
    }),
  });
  return { ok: response.ok, response, body: await safeJson(response) };
}

async function buildWebhookUrl(admin: any, tenantId: string | null, secret: string): Promise<string> {
  const base = `${SUPABASE_URL}/functions/v1/whatsapp-webhook`;
  const secretParam = `secret=${encodeURIComponent(secret)}`;
  if (!tenantId) return `${base}?${secretParam}`;
  const { data: tenant } = await admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
  const tenantParam = tenant?.slug
    ? `tenant=${encodeURIComponent(tenant.slug)}`
    : `tenant_id=${encodeURIComponent(tenantId)}`;
  return `${base}?${tenantParam}&${secretParam}`;
}

async function configureWebhook(base: string, apiKey: string, instanceName: string, webhookUrl: string): Promise<void> {
  // Full coverage: inbound + outbound (from any device), status, contacts, deletes, edits, presence.
  const events = [
    "MESSAGES_UPSERT", "MESSAGES_SET", "MESSAGES_UPDATE", "MESSAGES_DELETE", "MESSAGES_EDITED",
    "SEND_MESSAGE", "SEND_MESSAGE_UPDATE",
    "CONTACTS_UPDATE", "CONTACTS_UPSERT",
    "CHATS_UPSERT", "CHATS_UPDATE", "CHATS_DELETE",
    "PRESENCE_UPDATE", "CONNECTION_UPDATE",
  ];
  const bodies = [
    { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, byEvents: false, base64: true, events } },
    { webhook: { enabled: true, url: webhookUrl, events } },
  ];
  for (const body of bodies) {
    try {
      const r = await fetch(`${base}/webhook/set/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify(body),
      });
      if (r.ok) break;
    } catch (_) { /* non-fatal */ }
  }
  // Enable full history sync + always-online for already-created instances.
  try {
    await fetch(`${base}/settings/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        syncFullHistory: true, alwaysOnline: true,
        readMessages: true, readStatus: true, rejectCall: false,
      }),
    });
  } catch (_) { /* non-fatal */ }
}

function normalizeBase(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return s.replace(/\/+$/, "");
  }
}
