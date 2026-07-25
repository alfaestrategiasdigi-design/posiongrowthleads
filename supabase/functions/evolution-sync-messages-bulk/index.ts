// Bulk backfill of WhatsApp message history for conversations without any
// rows in `messages`. Loops per-tenant, pulls history via Evolution API
// (POST /chat/findMessages/{instance}) and replays each record through the
// whatsapp-webhook so the existing parsing/tenant isolation is reused.
//
// Body: { all_tenants?: boolean, tenant_id?: string|null, since_days?: number, batch_size?: number }
// Auth: SERVICE_ROLE_KEY, edge_internal_config.dispatch_token (Bearer or X-Cron-Token)
//       or an admin user JWT.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function normalizeBase(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try { const u = new URL(s); return `${u.protocol}//${u.host}`; }
  catch { return s.replace(/\/+$/, ""); }
}

let cachedDispatchToken: { value: string; expiresAt: number } | null = null;
async function getDispatchToken(admin: any): Promise<string | null> {
  if (cachedDispatchToken && cachedDispatchToken.expiresAt > Date.now()) return cachedDispatchToken.value;
  const { data } = await admin.from("edge_internal_config").select("dispatch_token").eq("id", 1).maybeSingle();
  const value = (data as any)?.dispatch_token ?? null;
  if (value) cachedDispatchToken = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

interface AuthResult { ok: boolean; internal: boolean; userId?: string | null; isAdmin?: boolean; error?: string; status?: number }

async function authorize(req: Request, admin: any): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronToken = req.headers.get("x-cron-token") ?? req.headers.get("X-Cron-Token");
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const internal = await getDispatchToken(admin);
  if (cronToken && internal && cronToken === internal) return { ok: true, internal: true };
  if (bearer && bearer === SERVICE_KEY) return { ok: true, internal: true };
  if (bearer && internal && bearer === internal) return { ok: true, internal: true };
  if (!bearer) return { ok: false, internal: false, status: 401, error: "Unauthorized" };
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser(bearer);
    const userId = userRes?.user?.id;
    if (!userId) return { ok: false, internal: false, status: 401, error: "Unauthorized" };
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    return { ok: true, internal: false, userId, isAdmin: !!isAdmin };
  } catch {
    return { ok: false, internal: false, status: 401, error: "invalid_token" };
  }
}

async function processConversation(opts: {
  base: string;
  apiKey: string;
  instanceName: string;
  webhookUrl: string;
  remoteJid: string;
  sinceMs: number;
}): Promise<{ replayed: number; found: number }> {
  const { base, apiKey, instanceName, webhookUrl, remoteJid, sinceMs } = opts;
  let raw: any = null;
  try {
    const r = await fetch(`${base}/chat/findMessages/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({ where: { key: { remoteJid } }, limit: 100 }),
      signal: AbortSignal.timeout(15_000),
    });
    raw = await r.json();
    if (!r.ok) return { replayed: 0, found: 0 };
  } catch {
    return { replayed: 0, found: 0 };
  }
  const records: any[] =
    Array.isArray(raw) ? raw
      : Array.isArray(raw?.messages?.records) ? raw.messages.records
      : Array.isArray(raw?.records) ? raw.records
      : Array.isArray(raw?.messages) ? raw.messages
      : Array.isArray(raw?.data) ? raw.data
      : [];
  if (records.length === 0) return { replayed: 0, found: 0 };

  let replayed = 0;
  for (const rec of records) {
    const key = rec?.key ?? { id: rec?.id, remoteJid: rec?.remoteJid ?? remoteJid, fromMe: Boolean(rec?.fromMe) };
    const message = rec?.message ?? rec?.messageContent ?? rec?.msg ?? {};
    const ts = rec?.messageTimestamp ?? rec?.timestamp
      ?? (rec?.messageAt ? Math.floor(new Date(rec.messageAt).getTime() / 1000) : undefined);
    const tsMs = typeof ts === "number" ? ts * 1000 : (ts ? new Date(ts).getTime() : Date.now());
    if (tsMs < sinceMs) continue;
    const pushName = rec?.pushName ?? rec?.contactName ?? undefined;
    const payload = { event: "messages.upsert", instance: instanceName, data: { key, message, messageTimestamp: ts, pushName } };
    try {
      const r = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) replayed++;
    } catch { /* skip */ }
  }
  return { replayed, found: records.length };
}

async function runForTenant(admin: any, tenantId: string | null, sinceDays: number, batchSize: number, deadline: number) {
  let connQ = admin.from("zapi_connections")
    .select("instance_url, api_key, instance_name, webhook_secret")
    .eq("provider", "evolution");
  connQ = tenantId ? connQ.eq("tenant_id", tenantId) : connQ.is("tenant_id", null);
  const { data: conn } = await connQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn?.instance_url || !conn.instance_name || !conn.api_key) {
    return { tenant_id: tenantId, soft_skip: true, reason: "no_connection", processed: 0, messages_replayed: 0, still_empty_estimate: 0 };
  }
  const base = normalizeBase(conn.instance_url);

  let tenantSlug: string | null = null;
  if (tenantId) {
    const { data: t } = await admin.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
    tenantSlug = t?.slug ?? null;
  }
  const webhookUrl = new URL(`${SUPABASE_URL}/functions/v1/whatsapp-webhook`);
  if (tenantSlug) webhookUrl.searchParams.set("tenant", tenantSlug);
  if (tenantId) webhookUrl.searchParams.set("tenant_id", tenantId);
  if (conn.webhook_secret) webhookUrl.searchParams.set("secret", conn.webhook_secret);
  const webhookUrlStr = webhookUrl.toString();

  const sinceIso = new Date(Date.now() - sinceDays * 86400_000).toISOString();
  const sinceMs = Date.now() - sinceDays * 86400_000;

  // Find candidate conversations: no messages, not synced yet, recent activity.
  let convQ = admin.from("conversations")
    .select("id, remote_jid, telefone")
    .is("history_synced_at", null)
    .gte("ultima_interacao", sinceIso);
  convQ = tenantId ? convQ.eq("tenant_id", tenantId) : convQ.is("tenant_id", null);
  const { data: convs } = await convQ.order("ultima_interacao", { ascending: false }).limit(batchSize * 3);

  if (!convs || convs.length === 0) {
    return { tenant_id: tenantId, processed: 0, messages_replayed: 0, still_empty_estimate: 0 };
  }

  // Filter to only those actually empty in messages.
  const ids = convs.map((c: any) => c.id);
  const { data: withMsgs } = await admin.from("messages")
    .select("conversation_id")
    .in("conversation_id", ids);
  const nonEmpty = new Set((withMsgs ?? []).map((m: any) => m.conversation_id));
  const empty = convs.filter((c: any) => !nonEmpty.has(c.id)).slice(0, batchSize);

  let processed = 0, messages_replayed = 0;
  for (const c of empty) {
    if (Date.now() > deadline) break;
    const jid = c.remote_jid || (c.telefone ? `${c.telefone}@s.whatsapp.net` : null);
    if (!jid) {
      await admin.from("conversations").update({ history_synced_at: new Date().toISOString() }).eq("id", c.id);
      processed++;
      continue;
    }
    const res = await processConversation({
      base, apiKey: conn.api_key, instanceName: conn.instance_name,
      webhookUrl: webhookUrlStr, remoteJid: jid, sinceMs,
    });
    messages_replayed += res.replayed;
    processed++;
    await admin.from("conversations").update({ history_synced_at: new Date().toISOString() }).eq("id", c.id);
  }

  // Rough estimate of remaining empty (unsynced) conversations.
  let stillQ = admin.from("conversations")
    .select("id", { count: "exact", head: true })
    .is("history_synced_at", null)
    .gte("ultima_interacao", sinceIso);
  stillQ = tenantId ? stillQ.eq("tenant_id", tenantId) : stillQ.is("tenant_id", null);
  const { count: still } = await stillQ;

  return { tenant_id: tenantId, processed, messages_replayed, still_empty_estimate: still ?? 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const authz = await authorize(req, admin);
  if (!authz.ok) return json({ error: authz.error }, authz.status ?? 401);

  const body = await req.json().catch(() => ({}));
  const allTenants: boolean = body.all_tenants === true;
  const sinceDays = Math.max(1, Math.min(Number(body.since_days ?? 60), 365));
  const batchSize = Math.max(1, Math.min(Number(body.batch_size ?? 40), 200));
  const deadline = Date.now() + 120_000;

  if (allTenants) {
    if (!authz.internal && !authz.isAdmin) return json({ error: "Sem permissão para escopo global" }, 403);
    const { data: conns } = await admin.from("zapi_connections").select("tenant_id").eq("provider", "evolution");
    const seen = new Set<string>();
    const scopes: (string | null)[] = [];
    for (const c of conns ?? []) {
      const key = c.tenant_id === null ? "__master__" : String(c.tenant_id);
      if (seen.has(key)) continue;
      seen.add(key);
      scopes.push(c.tenant_id as string | null);
    }
    const results: any[] = [];
    for (const scope of scopes) {
      if (Date.now() > deadline) { results.push({ tenant_id: scope, skipped: "deadline" }); continue; }
      try { results.push(await runForTenant(admin, scope, sinceDays, batchSize, deadline)); }
      catch (e) { results.push({ tenant_id: scope, error: String((e as Error).message ?? e) }); }
    }
    return json({ ok: true, all_tenants: true, results });
  }

  const tenantId: string | null = body.tenant_id ?? null;
  if (!authz.internal) {
    if (tenantId) {
      const { data: hasAccess } = await admin.rpc("has_tenant_access", { _user_id: authz.userId, _tenant_id: tenantId });
      if (!authz.isAdmin && !hasAccess) return json({ error: "Sem permissão" }, 403);
    } else if (!authz.isAdmin) {
      return json({ error: "Sem permissão para escopo global" }, 403);
    }
  }
  const res = await runForTenant(admin, tenantId, sinceDays, batchSize, deadline);
  return json({ ok: true, ...res });
});
