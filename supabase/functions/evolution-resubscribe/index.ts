// Reaplica a subscrição de eventos do webhook para instâncias Evolution já criadas.
// Necessário para instâncias antigas que ficaram sem SEND_MESSAGE / MESSAGES_UPSERT.
// POST body: { connection_id?: string, tenant_id?: string } — vazio = todas as instâncias ativas
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const EVENTS = [
  "MESSAGES_UPSERT", "MESSAGES_UPDATE", "MESSAGES_DELETE",
  "SEND_MESSAGE", "MESSAGES_REACTION", "MESSAGES_EDITED",
  "CONTACTS_UPDATE", "CONTACTS_UPSERT",
  "CHATS_UPSERT", "CHATS_UPDATE", "CHATS_DELETE",
  "PRESENCE_UPDATE", "CONNECTION_UPDATE",
];

function normalizeBase(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch { return s.replace(/\/+$/, ""); }
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
    .select("id, tenant_id, instance_url, api_key, instance_name")
    .eq("provider", "evolution");
  if (connectionId) q = q.eq("id", connectionId);
  else if (tenantIdFilter) q = q.eq("tenant_id", tenantIdFilter);

  const { data: connections, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];
  for (const conn of connections ?? []) {
    if (!isAdmin && conn.tenant_id) {
      const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: conn.tenant_id });
      if (!allowed) { results.push({ id: conn.id, ok: false, skipped: "no_access" }); continue; }
    } else if (!isAdmin && !conn.tenant_id) {
      results.push({ id: conn.id, ok: false, skipped: "master_admin_only" }); continue;
    }
    if (!conn.instance_url || !conn.api_key || !conn.instance_name) {
      results.push({ id: conn.id, ok: false, skipped: "incomplete_config" }); continue;
    }

    const base = normalizeBase(conn.instance_url);
    const slugPart = conn.tenant_id
      ? (await admin.from("tenants").select("slug").eq("id", conn.tenant_id).maybeSingle()).data?.slug
      : null;
    const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook${
      slugPart ? `?tenant=${encodeURIComponent(slugPart)}` : conn.tenant_id ? `?tenant_id=${encodeURIComponent(conn.tenant_id)}` : ""
    }`;

    // Try multiple payload variants (Evolution v1 flat, v2 wrapped, v2 minimal)
    const attempts = [
      { name: "v2_wrapped_full", body: { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, byEvents: false, base64: true, events: EVENTS } } },
      { name: "v2_wrapped_min",  body: { webhook: { enabled: true, url: webhookUrl, events: EVENTS } } },
      { name: "v1_flat_full",    body: { enabled: true, url: webhookUrl, webhookByEvents: false, webhook_by_events: false, events: EVENTS } },
      { name: "v1_flat_min",     body: { enabled: true, url: webhookUrl, events: EVENTS } },
    ];
    let ok = false; const debug: any[] = [];
    for (const att of attempts) {
      try {
        const r = await fetch(`${base}/webhook/set/${encodeURIComponent(conn.instance_name)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: conn.api_key },
          body: JSON.stringify(att.body),
        });
        const txt = await r.text();
        debug.push({ variant: att.name, status: r.status, body: txt.slice(0, 200) });
        if (r.ok) { ok = true; break; }
      } catch (e) {
        debug.push({ variant: att.name, error: String(e) });
      }
    }


    try {
      await fetch(`${base}/settings/set/${encodeURIComponent(conn.instance_name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: conn.api_key },
        body: JSON.stringify({
          syncFullHistory: true, alwaysOnline: true,
          readMessages: true, readStatus: true, rejectCall: false,
        }),
      });
    } catch { /* non-fatal */ }

    if (ok) {
      await admin.from("zapi_connections")
        .update({ webhook_url: webhookUrl, updated_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

    results.push({
      id: conn.id,
      instance: conn.instance_name,
      tenant_id: conn.tenant_id,
      ok, webhook_url: webhookUrl,
      debug,
    });
  }

  return json({ ok: true, count: results.length, results });
});
