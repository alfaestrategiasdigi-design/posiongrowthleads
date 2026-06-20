// Webhook público da Evolution API. Recebe eventos messages.upsert e grava em messages.
// Endpoint público (verify_jwt=false). Idempotente por wamid.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

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
    const event = body?.event ?? body?.type ?? "";
    const instanceName: string = body?.instance ?? body?.instanceName ?? body?.sender ?? "";

    // Find connection by instance name
    const { data: conn } = await admin.from("zapi_connections")
      .select("tenant_id, webhook_secret")
      .eq("provider", "evolution")
      .eq("instance_name", instanceName)
      .maybeSingle();
    const tenantId = conn?.tenant_id ?? null;

    // Connection state update
    if (event === "connection.update" || body?.data?.state) {
      const state = body?.data?.state ?? body?.state;
      const status = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
      if (instanceName) {
        await admin.from("zapi_connections")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("provider", "evolution").eq("instance_name", instanceName);
      }
    }

    // Messages
    const messagesArr: any[] = Array.isArray(body?.data) ? body.data
      : Array.isArray(body?.data?.messages) ? body.data.messages
      : body?.data ? [body.data] : [];

    for (const m of messagesArr) {
      const key = m?.key ?? m?.message?.key ?? {};
      const wamid: string | null = key?.id ?? m?.id ?? null;
      const remoteJid: string = key?.remoteJid ?? m?.remoteJid ?? "";
      if (!remoteJid || remoteJid.endsWith("@g.us")) continue; // skip groups
      const fromMe: boolean = Boolean(key?.fromMe ?? m?.fromMe);
      const pushName: string = m?.pushName ?? m?.notifyName ?? "";
      const msgObj = m?.message ?? m;
      const text: string = msgObj?.conversation
        ?? msgObj?.extendedTextMessage?.text
        ?? msgObj?.imageMessage?.caption
        ?? msgObj?.videoMessage?.caption
        ?? m?.text
        ?? "";
      if (!text && !msgObj?.imageMessage && !msgObj?.audioMessage && !msgObj?.videoMessage && !msgObj?.documentMessage) continue;
      const tipo = msgObj?.imageMessage ? "image"
        : msgObj?.audioMessage ? "audio"
        : msgObj?.videoMessage ? "video"
        : msgObj?.documentMessage ? "document"
        : "text";

      const phone = remoteJid.split("@")[0];

      // Upsert conversation
      let convQ = admin.from("conversations")
        .select("id, nao_lidas")
        .eq("remote_jid", remoteJid);
      if (tenantId) convQ = convQ.eq("tenant_id", tenantId);
      else convQ = convQ.is("tenant_id", null);
      let { data: conv } = await convQ.maybeSingle();

      if (!conv) {
        const ins = await admin.from("conversations").insert({
          tenant_id: tenantId,
          telefone: phone,
          remote_jid: remoteJid,
          nome_contato: pushName || phone,
          provider: "evolution",
          ultima_mensagem: text || `[${tipo}]`,
          ultima_interacao: new Date().toISOString(),
          nao_lidas: fromMe ? 0 : 1,
        }).select("id, nao_lidas").maybeSingle();
        conv = ins.data;
      } else {
        await admin.from("conversations").update({
          ultima_mensagem: text || `[${tipo}]`,
          ultima_interacao: new Date().toISOString(),
          nao_lidas: fromMe ? conv.nao_lidas : (conv.nao_lidas ?? 0) + 1,
          nome_contato: pushName || undefined,
        }).eq("id", conv.id);
      }

      if (!conv?.id) continue;

      // Idempotent by wamid
      if (wamid) {
        const dup = await admin.from("messages").select("id").eq("wamid", wamid).maybeSingle();
        if (dup.data) continue;
      }

      await admin.from("messages").insert({
        conversation_id: conv.id,
        sender: fromMe ? "usuario" : "cliente",
        conteudo: text || `[${tipo}]`,
        tipo,
        direction: fromMe ? "outbound" : "inbound",
        status: "delivered",
        wamid,
        tenant_id: tenantId,
      });
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
