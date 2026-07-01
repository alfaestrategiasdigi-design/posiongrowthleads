// Envia mensagem (texto ou mídia) via Evolution API e registra em messages.
// POST body: { conversation_id, body?, media_url?, media_type?, caption? }
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

  let payload: any = {};
  try { payload = await req.json(); } catch {}
  const conversation_id = String(payload.conversation_id ?? "");
  const text = String(payload.body ?? "").trim();
  const media_url = payload.media_url ? String(payload.media_url) : null;
  const media_type = payload.media_type ? String(payload.media_type) : null;
  const caption = payload.caption ? String(payload.caption) : "";
  const reply_to_wamid: string | null = payload.reply_to_wamid ? String(payload.reply_to_wamid) : null;
  const reply_preview: string | null = payload.reply_preview ? String(payload.reply_preview) : null;
  const reaction_wamid: string | null = payload.reaction_wamid ? String(payload.reaction_wamid) : null;
  const reaction_emoji: string | null = payload.reaction_emoji != null ? String(payload.reaction_emoji) : null;

  if (!conversation_id) return json({ error: "conversation_id obrigatório" }, 400);
  if (!text && !media_url && reaction_wamid == null) {
    return json({ error: "body, media_url ou reaction_wamid obrigatórios" }, 400);
  }

  const { data: conv } = await admin.from("conversations")
    .select("id, telefone, remote_jid, tenant_id")
    .eq("id", conversation_id).maybeSingle();
  if (!conv) return json({ error: "Conversa não encontrada" }, 404);

  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (conv.tenant_id) {
    const { data: hasTenantAccess } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: conv.tenant_id });
    if (!isAdmin && !hasTenantAccess) return json({ error: "Sem permissão para esta conversa" }, 403);
  } else if (!isAdmin) {
    return json({ error: "Sem permissão para conversas globais" }, 403);
  }

  let connQ = admin.from("zapi_connections")
    .select("instance_url, api_key, instance_name")
    .eq("provider", "evolution");
  if (conv.tenant_id) connQ = connQ.eq("tenant_id", conv.tenant_id);
  else connQ = connQ.is("tenant_id", null);
  let { data: conn } = await connQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn && !conv.tenant_id) {
    const r = await admin.from("zapi_connections")
      .select("instance_url, api_key, instance_name")
      .eq("provider", "evolution").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    conn = r.data;
  }
  if (!conn) return json({ error: conv.tenant_id ? "Este cliente ainda não tem uma instância Evolution configurada" : "Nenhuma instância Evolution configurada" }, 400);
  const base = normalizeBase(conn.instance_url);

  const number = (conv.telefone || conv.remote_jid?.split("@")[0] || "").replace(/\D/g, "");

  // ============ REACTION ============
  if (reaction_wamid) {
    try {
      const r = await fetch(`${base}/message/sendReaction/${encodeURIComponent(conn.instance_name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: conn.api_key },
        body: JSON.stringify({
          reactionMessage: {
            key: { remoteJid: `${number}@s.whatsapp.net`, fromMe: true, id: reaction_wamid },
            reaction: reaction_emoji ?? "",
          },
        }),
      });
      const j = await r.json();
      if (!r.ok) return json({ error: "Falha ao enviar reação", detail: j }, 502);
      // Persist locally
      if (reaction_emoji) {
        await admin.from("message_reactions").upsert({
          message_wamid: reaction_wamid,
          conversation_id,
          tenant_id: conv.tenant_id,
          actor_jid: "me",
          from_me: true,
          emoji: reaction_emoji,
        }, { onConflict: "message_wamid,actor_jid" });
      } else {
        await admin.from("message_reactions").delete()
          .eq("message_wamid", reaction_wamid).eq("actor_jid", "me");
      }
      return json({ ok: true, reacted: true });
    } catch (e) {
      return json({ error: "Erro de rede (reação)", detail: String(e) }, 502);
    }
  }

  let wamid: string | null = null;
  try {
    let endpoint = `${base}/message/sendText/${encodeURIComponent(conn.instance_name)}`;
    let body: any = { number, text };
    const quoted = reply_to_wamid ? {
      quoted: {
        key: { remoteJid: `${number}@s.whatsapp.net`, fromMe: false, id: reply_to_wamid },
        message: { conversation: reply_preview ?? "" },
      },
    } : {};
    if (media_url) {
      if (media_type === "audio") {
        endpoint = `${base}/message/sendWhatsAppAudio/${encodeURIComponent(conn.instance_name)}`;
        body = { number, audio: media_url, ...quoted };
      } else {
        endpoint = `${base}/message/sendMedia/${encodeURIComponent(conn.instance_name)}`;
        body = {
          number,
          mediatype: media_type === "video" ? "video" : media_type === "document" ? "document" : "image",
          media: media_url,
          caption: caption || text || undefined,
          ...quoted,
        };
      }
    } else {
      body = { number, text, ...quoted };
    }
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.api_key },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) return json({ error: "Falha ao enviar via Evolution", detail: j }, 502);
    wamid = j?.key?.id ?? j?.messageId ?? null;
  } catch (e) {
    return json({ error: "Erro de rede", detail: String(e) }, 502);
  }

  const preview = text || (media_type === "audio" ? "🎤 Áudio" : media_type === "video" ? "🎬 Vídeo" : media_type === "document" ? "📄 Documento" : "📷 Imagem");

  await admin.from("messages").insert({
    conversation_id,
    sender: "usuario",
    conteudo: text || caption || preview,
    tipo: media_type ?? "text",
    media_type,
    media_url,
    direction: "outbound",
    status: "sent",
    wamid,
    reply_to_wamid,
    reply_preview,
    tenant_id: conv.tenant_id,
  });
  await admin.from("conversations").update({
    ultima_mensagem: preview,
    ultima_interacao: new Date().toISOString(),
    nao_lidas: 0,
  }).eq("id", conversation_id);

  return json({ ok: true, wamid });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
