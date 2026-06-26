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

  let upserted = 0, pictures = 0;
  for (const c of chats) {
    const jid: string = c.remoteJid || c.id || c.chatId || "";
    if (!jid || jid.endsWith("@g.us")) continue; // skip groups
    const phone = jid.split("@")[0];
    if (!phone) continue;
    const name = c.pushName || c.name || c.contact?.name || c.subject || null;
    const lastTs = c.lastMessageTimestamp || c.updatedAt || c.lastMessage?.messageTimestamp;
    const lastInteraction = lastTs
      ? new Date(typeof lastTs === "number" ? lastTs * 1000 : lastTs).toISOString()
      : new Date().toISOString();
    const lastMessage =
      c.lastMessage?.message?.conversation ||
      c.lastMessage?.message?.extendedTextMessage?.text ||
      (c.lastMessage?.messageType ? `[${c.lastMessage.messageType}]` : null);

    // Upsert by (tenant_id, remote_jid)
    const existing = await admin.from("conversations")
      .select("id, foto_url")
      .eq("remote_jid", jid)
      .eq(tenantId ? "tenant_id" : "tenant_id", tenantId as any)
      .maybeSingle();

    let convId = existing.data?.id as string | undefined;
    let fotoUrl = existing.data?.foto_url as string | null | undefined;

    if (withPictures && !fotoUrl) {
      try {
        const picUrl = `${base}/chat/fetchProfilePictureUrl/${encodeURIComponent(conn.instance_name)}`;
        const pr = await fetch(picUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: conn.api_key },
          body: JSON.stringify({ number: jid }),
        });
        if (pr.ok) {
          const pj = await pr.json();
          fotoUrl = pj?.profilePictureUrl || pj?.url || null;
          if (fotoUrl) pictures++;
        }
      } catch { /* ignore */ }
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

    if (convId) {
      await admin.from("conversations").update(payload).eq("id", convId);
    } else {
      await admin.from("conversations").insert(payload);
    }
    upserted++;
  }

  return json({ ok: true, count: chats.length, upserted, pictures });
});
