// Pull historical messages from Evolution API for a specific conversation
// and replay them through the whatsapp-webhook for full parsing consistency.
// POST body: { conversation_id: string, limit?: number }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function normalizeBase(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try { const u = new URL(s); return `${u.protocol}//${u.host}`; }
  catch { return s.replace(/\/+$/, ""); }
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: userRes } = await userClient.auth.getUser(token);
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const conversationId = String(body.conversation_id ?? "");
  const limit = Math.min(Math.max(Number(body.limit ?? 100), 1), 500);
  if (!conversationId) return json({ error: "conversation_id obrigatório" }, 400);

  const { data: conv } = await admin.from("conversations")
    .select("id, tenant_id, remote_jid, telefone")
    .eq("id", conversationId).maybeSingle();
  if (!conv) return json({ error: "Conversa não encontrada" }, 404);

  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (conv.tenant_id) {
    const { data: ok } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: conv.tenant_id });
    if (!isAdmin && !ok) return json({ error: "Sem permissão" }, 403);
  } else if (!isAdmin) {
    return json({ error: "Sem permissão" }, 403);
  }

  let connQ = admin.from("zapi_connections")
    .select("instance_url, api_key, instance_name, webhook_secret, tenant_id")
    .eq("provider", "evolution");
  connQ = conv.tenant_id ? connQ.eq("tenant_id", conv.tenant_id) : connQ.is("tenant_id", null);
  const { data: conn } = await connQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn?.instance_url || !conn.instance_name || !conn.api_key) {
    return json({ error: "Instância Evolution não configurada" }, 400);
  }
  const base = normalizeBase(conn.instance_url);
  const remoteJid = conv.remote_jid || `${conv.telefone}@s.whatsapp.net`;

  // Evolution: POST /chat/findMessages/{instance} with { where: { key: { remoteJid } } }
  let raw: any = null;
  try {
    const r = await fetch(`${base}/chat/findMessages/${encodeURIComponent(conn.instance_name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.api_key },
      body: JSON.stringify({ where: { key: { remoteJid } }, limit }),
    });
    raw = await r.json();
    if (!r.ok) return json({ error: "findMessages falhou", detail: raw }, 502);
  } catch (e) {
    return json({ error: "Erro de rede", detail: String(e) }, 502);
  }

  // Response may be an array, { messages: {records: []} }, or { records: [] }
  const records: any[] =
    Array.isArray(raw) ? raw
      : Array.isArray(raw?.messages?.records) ? raw.messages.records
      : Array.isArray(raw?.records) ? raw.records
      : Array.isArray(raw?.messages) ? raw.messages
      : Array.isArray(raw?.data) ? raw.data
      : [];

  if (records.length === 0) return json({ ok: true, count: 0, replayed: 0 });

  // Find tenant slug for webhook URL param
  let tenantSlug: string | null = null;
  if (conv.tenant_id) {
    const { data: t } = await admin.from("tenants").select("slug").eq("id", conv.tenant_id).maybeSingle();
    tenantSlug = t?.slug ?? null;
  }

  const webhookUrl = new URL(`${SUPABASE_URL}/functions/v1/whatsapp-webhook`);
  if (tenantSlug) webhookUrl.searchParams.set("tenant", tenantSlug);
  if (conv.tenant_id) webhookUrl.searchParams.set("tenant_id", conv.tenant_id);
  if (conn.webhook_secret) webhookUrl.searchParams.set("secret", conn.webhook_secret);

  let replayed = 0;
  for (const rec of records) {
    // Normalize each record into a Baileys-like message with key/message fields
    const key = rec?.key ?? { id: rec?.id, remoteJid: rec?.remoteJid ?? remoteJid, fromMe: Boolean(rec?.fromMe) };
    const message = rec?.message ?? rec?.messageContent ?? rec?.msg ?? {};
    const messageTimestamp = rec?.messageTimestamp ?? rec?.timestamp
      ?? (rec?.messageAt ? Math.floor(new Date(rec.messageAt).getTime() / 1000) : undefined);
    const pushName = rec?.pushName ?? rec?.contactName ?? undefined;

    const payload = {
      event: "messages.upsert",
      instance: conn.instance_name,
      data: { key, message, messageTimestamp, pushName },
    };

    try {
      const r = await fetch(webhookUrl.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) replayed++;
      else console.warn("[sync-messages] replay failed", await r.text());
    } catch (e) {
      console.warn("[sync-messages] replay error", String(e));
    }
  }

  return json({ ok: true, count: records.length, replayed });
});
