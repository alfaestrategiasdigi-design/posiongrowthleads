// Reconecta uma instância Evolution: faz logout da sessão atual (mata sessão
// Baileys zumbi), depois pede novo QR code. Também garante que o webhook está
// inscrito com secret correto após o reconnect.
// POST body: { connection_id?: string, tenant_id?: string }
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildWebhookUrl,
  configureWebhook,
  ensureWebhookSecret,
  normalizeBase,
} from "../_shared/evolution-webhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function safeText(r: Response): Promise<string> {
  try { return (await r.text()).slice(0, 300); } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: userRes } = await userClient.auth.getUser(token);
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const connectionId: string | null = body?.connection_id ?? null;
  const tenantIdFilter: string | null = body?.tenant_id ?? null;

  let q = admin.from("zapi_connections")
    .select("id, tenant_id, instance_url, api_key, instance_name, webhook_secret")
    .eq("provider", "evolution")
    .limit(1);
  if (connectionId) q = q.eq("id", connectionId);
  else if (tenantIdFilter) q = q.eq("tenant_id", tenantIdFilter);
  else return json({ error: "connection_id or tenant_id required" }, 400);

  const { data: conn, error } = await q.maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!conn) return json({ error: "Connection not found" }, 404);

  // Authorization: admin master OR user has tenant access
  if (!isAdmin) {
    if (!conn.tenant_id) return json({ error: "Forbidden" }, 403);
    const { data: allowed } = await admin.rpc("has_tenant_access", {
      _user_id: userId, _tenant_id: conn.tenant_id,
    });
    if (!allowed) return json({ error: "Forbidden" }, 403);
  }

  if (!conn.instance_url || !conn.api_key || !conn.instance_name) {
    return json({ error: "Incomplete connection config" }, 400);
  }

  const base = normalizeBase(conn.instance_url);
  const instanceName = conn.instance_name;
  const headers = { "Content-Type": "application/json", apikey: conn.api_key };
  const debug: any[] = [];

  // Step 1: logout to kill any zombie Baileys session.
  try {
    const r = await fetch(`${base}/instance/logout/${encodeURIComponent(instanceName)}`, {
      method: "DELETE",
      headers,
    });
    debug.push({ step: "logout", status: r.status, body: await safeText(r) });
  } catch (e) {
    debug.push({ step: "logout", error: String(e) });
  }

  // Small delay so Evolution finalizes the socket teardown before /connect.
  await new Promise((res) => setTimeout(res, 800));

  // Step 2: request a new QR / connection.
  let qr: string | null = null;
  let pairingCode: string | null = null;
  let evoStatus: string | null = null;
  try {
    const r = await fetch(`${base}/instance/connect/${encodeURIComponent(instanceName)}`, {
      method: "GET",
      headers,
    });
    const txt = await r.text();
    debug.push({ step: "connect", status: r.status, body: txt.slice(0, 200) });
    if (r.ok) {
      try {
        const j = JSON.parse(txt);
        qr = j?.base64 ?? j?.qrcode?.base64 ?? j?.qrcode ?? j?.qr ?? null;
        pairingCode = j?.pairingCode ?? j?.code ?? null;
        evoStatus = j?.instance?.state ?? j?.status ?? null;
      } catch { /* body not JSON */ }
    } else {
      return json({ error: "Failed to start connect", debug }, 502);
    }
  } catch (e) {
    return json({ error: "Evolution unreachable", details: String(e), debug }, 502);
  }

  // Step 3: re-apply webhook with correct secret so the fresh session delivers
  // events to whatsapp-webhook (defensive — safe to run every reconnect).
  try {
    const slugPart = conn.tenant_id
      ? (await admin.from("tenants").select("slug").eq("id", conn.tenant_id).maybeSingle()).data?.slug
      : null;
    const secret = await ensureWebhookSecret(admin, conn.id, conn.webhook_secret);
    const webhookUrl = buildWebhookUrl({
      supabaseUrl: SUPABASE_URL,
      tenantSlug: slugPart,
      tenantId: conn.tenant_id,
      secret,
    });
    const res = await configureWebhook(base, conn.api_key, instanceName, webhookUrl);
    debug.push({ step: "webhook", ok: res.ok });
    if (res.ok) {
      await admin.from("zapi_connections")
        .update({ webhook_url: webhookUrl, updated_at: new Date().toISOString() })
        .eq("id", conn.id);
    }
  } catch (e) {
    debug.push({ step: "webhook", error: String(e) });
  }

  // Mark connection as reconnecting so UI can reflect it.
  await admin.from("zapi_connections")
    .update({ status: "pending", updated_at: new Date().toISOString() })
    .eq("id", conn.id);

  return json({
    ok: true,
    connection_id: conn.id,
    instance_name: instanceName,
    qr,
    pairing_code: pairingCode,
    status: evoStatus ?? "connecting",
    reconnect_started_at: new Date().toISOString(),
    debug,
  });
});
