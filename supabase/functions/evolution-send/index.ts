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
  const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (!claims?.claims) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let payload: any = {};
  try { payload = await req.json(); } catch {}
  const conversation_id = String(payload.conversation_id ?? "");
  const text = String(payload.body ?? "").trim();
  const media_url = payload.media_url ? String(payload.media_url) : null;
  const media_type = payload.media_type ? String(payload.media_type) : null;
  const caption = payload.caption ? String(payload.caption) : "";

  if (!conversation_id || (!text && !media_url)) {
    return json({ error: "conversation_id + body ou media_url obrigatórios" }, 400);
  }

  const { data: conv } = await admin.from("conversations")
    .select("id, telefone, remote_jid, tenant_id")
    .eq("id", conversation_id).maybeSingle();
  if (!conv) return json({ error: "Conversa não encontrada" }, 404);

  let connQ = admin.from("zapi_connections")
    .select("instance_url, api_key, instance_name")
    .eq("provider", "evolution");
  if (conv.tenant_id) connQ = connQ.eq("tenant_id", conv.tenant_id);
  else connQ = connQ.is("tenant_id", null);
  let { data: conn } = await connQ.maybeSingle();
  if (!conn) {
    const r = await admin.from("zapi_connections")
      .select("instance_url, api_key, instance_name")
      .eq("provider", "evolution").limit(1).maybeSingle();
    conn = r.data;
  }
  if (!conn) return json({ error: "Nenhuma instância Evolution configurada" }, 400);
  const base = normalizeBase(conn.instance_url);

  const number = (conv.remote_jid?.split("@")[0]) || conv.telefone.replace(/\D/g, "");

  let wamid: string | null = null;
  try {
    let endpoint = `${base}/message/sendText/${encodeURIComponent(conn.instance_name)}`;
    let body: any = { number, text };
    if (media_url) {
      if (media_type === "audio") {
        endpoint = `${base}/message/sendWhatsAppAudio/${encodeURIComponent(conn.instance_name)}`;
        body = { number, audio: media_url };
      } else {
        endpoint = `${base}/message/sendMedia/${encodeURIComponent(conn.instance_name)}`;
        body = {
          number,
          mediatype: media_type === "video" ? "video" : media_type === "document" ? "document" : "image",
          media: media_url,
          caption: caption || text || undefined,
        };
      }
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
