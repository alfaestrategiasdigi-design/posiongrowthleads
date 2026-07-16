// Sync chats from Evolution API into the conversations table.
// POST body: { tenant_id?: string | null, with_pictures?: boolean }
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

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizePhoneJid(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw || raw.endsWith("@g.us") || raw.endsWith("@broadcast") || raw.includes("@lid")) return null;
  const phone = onlyDigits(raw.split("@")[0]);
  return phone ? `${phone}@s.whatsapp.net` : null;
}

async function findConversation(admin: any, tenantId: string | null, remoteJid: string, phone: string) {
  let byJid = admin.from("conversations")
    .select("id, foto_url")
    .eq("remote_jid", remoteJid);
  byJid = tenantId ? byJid.eq("tenant_id", tenantId) : byJid.is("tenant_id", null);
  const jidResult = await byJid.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
  if (jidResult.data) return jidResult.data;

  let byPhone = admin.from("conversations")
    .select("id, foto_url")
    .eq("telefone", phone);
  byPhone = tenantId ? byPhone.eq("tenant_id", tenantId) : byPhone.is("tenant_id", null);
  const phoneResult = await byPhone.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
  return phoneResult.data ?? null;
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
  const tenantId: string | null = body.tenant_id ?? null;
  const withPictures: boolean = body.with_pictures !== false;

  // Permission check
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (tenantId) {
    const { data: hasTenantAccess } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: tenantId });
    if (!isAdmin && !hasTenantAccess) return json({ error: "Sem permissão" }, 403);
  } else if (!isAdmin) {
    return json({ error: "Sem permissão para escopo global" }, 403);
  }

  let connQ = admin.from("zapi_connections")
    .select("instance_url, api_key, instance_name")
    .eq("provider", "evolution");
  connQ = tenantId ? connQ.eq("tenant_id", tenantId) : connQ.is("tenant_id", null);
  const { data: conn } = await connQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn?.instance_url || !conn.instance_name || !conn.api_key) {
    return json({ error: "Instância Evolution não configurada" }, 400);
  }
  const base = normalizeBase(conn.instance_url);

  // Fetch chats
  const chatsUrl = `${base}/chat/findChats/${encodeURIComponent(conn.instance_name)}`;
  let chats: any[] = [];
  try {
    const r = await fetch(chatsUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.api_key },
      body: JSON.stringify({}),
    });
    const j = await r.json();
    if (!r.ok) return json({ error: "findChats falhou", detail: j }, 502);
    chats = Array.isArray(j) ? j : (j?.chats || j?.data || []);
  } catch (e) {
    return json({ error: "Erro de rede ao buscar chats", detail: String(e) }, 502);
  }

  const deadline = Date.now() + 120_000; // hard budget within the 150s idle limit
  let upserted = 0, pictures = 0, skippedByTime = 0;

  async function fetchPicture(jid: string): Promise<string | null> {
    try {
      const picUrl = `${base}/chat/fetchProfilePictureUrl/${encodeURIComponent(conn.instance_name)}`;
      const pr = await fetch(picUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: conn.api_key },
        body: JSON.stringify({ number: jid }),
        signal: AbortSignal.timeout(3500),
      });
      if (!pr.ok) return null;
      const pj = await pr.json();
      return pj?.profilePictureUrl || pj?.url || null;
    } catch { return null; }
  }

  async function processChat(c: any) {
    if (Date.now() > deadline) { skippedByTime++; return; }
    const jid = normalizePhoneJid(c.remoteJid || c.id || c.chatId || "");
    if (!jid) return;
    const phone = onlyDigits(jid.split("@")[0]);
    if (!phone || !/^\d+$/.test(phone)) return;
    const name = c.pushName || c.name || c.contact?.name || c.subject || null;
    const lastTs = c.lastMessageTimestamp || c.updatedAt || c.lastMessage?.messageTimestamp;
    const lastInteraction = lastTs
      ? new Date(typeof lastTs === "number" ? lastTs * 1000 : lastTs).toISOString()
      : new Date().toISOString();
    const lastMessage =
      c.lastMessage?.message?.conversation ||
      c.lastMessage?.message?.extendedTextMessage?.text ||
      (c.lastMessage?.messageType ? `[${c.lastMessage.messageType}]` : null);

    const existing = await findConversation(admin, tenantId, jid, phone);
    let fotoUrl = existing?.foto_url as string | null | undefined;

    if (withPictures && !fotoUrl && Date.now() < deadline) {
      const p = await fetchPicture(jid);
      if (p) { fotoUrl = p; pictures++; }
    }

    const payload: any = {
      tenant_id: tenantId,
      telefone: phone,
      remote_jid: jid,
      nome_contato: name,
      provider: "evolution",
      foto_url: fotoUrl ?? null,
      ultima_interacao: lastInteraction,
      ...(lastMessage ? { ultima_mensagem: String(lastMessage).slice(0, 200) } : {}),
    };

    if (existing?.id) {
      await admin.from("conversations").update(payload).eq("id", existing.id);
    } else {
      const inserted = await admin.from("conversations").insert(payload);
      if (inserted.error) {
        const again = await findConversation(admin, tenantId, jid, phone);
        if (again?.id) await admin.from("conversations").update(payload).eq("id", again.id);
      }
    }
    upserted++;
  }

  const CONCURRENCY = 8;
  for (let i = 0; i < chats.length; i += CONCURRENCY) {
    if (Date.now() > deadline) { skippedByTime += chats.length - i; break; }
    await Promise.all(chats.slice(i, i + CONCURRENCY).map(processChat));
  }

  return json({ ok: true, count: chats.length, upserted, pictures, skipped_by_time: skippedByTime });
});
