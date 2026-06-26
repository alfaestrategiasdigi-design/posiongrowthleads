// Webhook público da Evolution API.
// Eventos suportados: messages.upsert, messages.update (status), connection.update,
// contacts.update / contacts.upsert (pushName + profilePicUrl). Mídia (image/audio/video/document)
// é baixada via getBase64FromMediaMessage e salva em storage whatsapp-media.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function normalizeBase(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch { return s.replace(/\/+$/, ""); }
}

async function fetchAndStoreMedia(
  conn: { instance_url: string; api_key: string; instance_name: string },
  message: any,
  tipo: string,
): Promise<{ url: string | null; mime: string | null }> {
  try {
    const base = normalizeBase(conn.instance_url);
    const r = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(conn.instance_name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.api_key },
      body: JSON.stringify({ message: { key: message.key, message: message.message } , convertToMp4: false }),
    });
    if (!r.ok) return { url: null, mime: null };
    const j = await r.json();
    const b64 = j?.base64 ?? j?.data ?? j?.mediaBase64;
    const mime = j?.mimetype ?? j?.mediaType ?? null;
    if (!b64) return { url: null, mime };
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const ext = tipo === "image" ? "jpg" : tipo === "audio" ? "ogg" : tipo === "video" ? "mp4" : "bin";
    const path = `${conn.instance_name}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const { error } = await admin.storage.from("whatsapp-media").upload(path, bin, {
      contentType: mime || `application/${ext}`,
      upsert: false,
    });
    if (error) { console.error("[wa media upload]", error); return { url: null, mime }; }
    const { data: signed } = await admin.storage.from("whatsapp-media").createSignedUrl(path, 60 * 60 * 24 * 365);
    return { url: signed?.signedUrl ?? null, mime };
  } catch (e) {
    console.error("[wa media fetch]", e);
    return { url: null, mime: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, name: "whatsapp-webhook" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { return new Response("ok", { headers: corsHeaders }); }

  try {
    const event = (body?.event ?? body?.type ?? "").toString().toLowerCase();
    const instanceName: string = body?.instance ?? body?.instanceName ?? body?.sender ?? "";
    const url = new URL(req.url);
    const tenantSlug = url.searchParams.get("tenant");
    const tenantIdParam = url.searchParams.get("tenant_id");

    let resolvedTenantId: string | null = tenantIdParam;
    if (!resolvedTenantId && tenantSlug) {
      const { data: tenant } = await admin.from("tenants").select("id").eq("slug", tenantSlug).maybeSingle();
      resolvedTenantId = tenant?.id ?? null;
    }

    let conn: any = null;
    if (instanceName) {
      let q = admin.from("zapi_connections")
        .select("tenant_id, instance_url, api_key, instance_name")
        .eq("provider", "evolution")
        .eq("instance_name", instanceName);
      q = resolvedTenantId ? q.eq("tenant_id", resolvedTenantId) : q;
      const { data } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
      conn = data;
    }
    if (!conn && resolvedTenantId) {
      const { data } = await admin.from("zapi_connections")
        .select("tenant_id, instance_url, api_key, instance_name")
        .eq("provider", "evolution")
        .eq("tenant_id", resolvedTenantId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      conn = data;
    }
    const tenantId = conn?.tenant_id ?? resolvedTenantId ?? null;

    // Connection state
    if (event.includes("connection.update") || body?.data?.state) {
      const state = body?.data?.state ?? body?.state;
      const status = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
      if (instanceName) {
        let upd = admin.from("zapi_connections")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("provider", "evolution").eq("instance_name", instanceName);
        upd = tenantId ? upd.eq("tenant_id", tenantId) : upd.is("tenant_id", null);
        await upd;
      }
    }

    // Contacts update -> pushName + profile pic
    if (event.includes("contacts.")) {
      const contacts: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const c of contacts) {
        const jid = c?.remoteJid ?? c?.id;
        if (!jid) continue;
        const updates: any = {};
        if (c?.pushName || c?.name) updates.nome_contato = c.pushName || c.name;
        if (c?.profilePicUrl || c?.profilePictureUrl) updates.foto_url = c.profilePicUrl || c.profilePictureUrl;
        if (Object.keys(updates).length === 0) continue;
        let q = admin.from("conversations").update(updates).eq("remote_jid", jid);
        if (tenantId) q = q.eq("tenant_id", tenantId); else q = q.is("tenant_id", null);
        await q;
      }
    }

    // Message status updates (sent/delivered/read)
    if (event.includes("messages.update")) {
      const arr: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const u of arr) {
        const wamid = u?.key?.id ?? u?.id;
        const st = (u?.status ?? u?.update?.status ?? "").toString().toLowerCase();
        if (!wamid || !st) continue;
        const map: Record<string,string> = { read: "read", delivery_ack: "delivered", server_ack: "sent", played: "read" };
        const status = map[st] ?? st;
        await admin.from("messages").update({ status }).eq("wamid", wamid);
      }
    }

    // Messages upsert
    if (event.includes("messages.upsert") || (!event && body?.data)) {
      const messagesArr: any[] = Array.isArray(body?.data) ? body.data
        : Array.isArray(body?.data?.messages) ? body.data.messages
        : body?.data ? [body.data] : [];

      for (const m of messagesArr) {
        const key = m?.key ?? m?.message?.key ?? {};
        const wamid: string | null = key?.id ?? m?.id ?? null;
        const remoteJid: string = key?.remoteJid ?? m?.remoteJid ?? "";
        if (!remoteJid || remoteJid.endsWith("@g.us")) continue;
        const fromMe: boolean = Boolean(key?.fromMe ?? m?.fromMe);
        const pushName: string = m?.pushName ?? m?.notifyName ?? "";
        const msgObj = m?.message ?? m;
        const text: string = msgObj?.conversation
          ?? msgObj?.extendedTextMessage?.text
          ?? msgObj?.imageMessage?.caption
          ?? msgObj?.videoMessage?.caption
          ?? msgObj?.documentMessage?.caption
          ?? m?.text
          ?? "";
        const tipo = msgObj?.imageMessage ? "image"
          : msgObj?.audioMessage ? "audio"
          : msgObj?.videoMessage ? "video"
          : msgObj?.documentMessage ? "document"
          : "text";
        if (!text && tipo === "text") continue;

        const phone = remoteJid.split("@")[0];

        let convQ = admin.from("conversations").select("id, nao_lidas").eq("remote_jid", remoteJid);
        if (tenantId) convQ = convQ.eq("tenant_id", tenantId); else convQ = convQ.is("tenant_id", null);
        let { data: conv } = await convQ.maybeSingle();

        const preview = text || (tipo === "audio" ? "🎤 Áudio" : tipo === "image" ? "📷 Imagem" : tipo === "video" ? "🎬 Vídeo" : tipo === "document" ? "📄 Documento" : `[${tipo}]`);

        if (!conv) {
          const ins = await admin.from("conversations").insert({
            tenant_id: tenantId,
            telefone: phone,
            remote_jid: remoteJid,
            nome_contato: pushName || phone,
            provider: "evolution",
            ultima_mensagem: preview,
            ultima_interacao: new Date().toISOString(),
            nao_lidas: fromMe ? 0 : 1,
          }).select("id, nao_lidas").maybeSingle();
          conv = ins.data;
        } else {
          await admin.from("conversations").update({
            ultima_mensagem: preview,
            ultima_interacao: new Date().toISOString(),
            nao_lidas: fromMe ? conv.nao_lidas : (conv.nao_lidas ?? 0) + 1,
            nome_contato: pushName || undefined,
          }).eq("id", conv.id);
        }

        if (!conv?.id) continue;

        if (wamid) {
          const dup = await admin.from("messages").select("id").eq("wamid", wamid).maybeSingle();
          if (dup.data) continue;
        }

        let media_url: string | null = null;
        let media_mime: string | null = null;
        if (tipo !== "text" && conn) {
          const r = await fetchAndStoreMedia(conn as any, m, tipo);
          media_url = r.url; media_mime = r.mime;
        }

        await admin.from("messages").insert({
          conversation_id: conv.id,
          sender: fromMe ? "usuario" : "cliente",
          conteudo: text || preview,
          tipo,
          media_type: tipo === "text" ? null : tipo,
          media_url,
          media_mime,
          direction: fromMe ? "outbound" : "inbound",
          status: "delivered",
          wamid,
          tenant_id: tenantId,
        });
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[whatsapp-webhook]", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
