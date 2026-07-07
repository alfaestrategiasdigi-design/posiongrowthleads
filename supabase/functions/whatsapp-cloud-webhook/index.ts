// Receives WhatsApp Cloud API webhooks (verify + messages) and creates leads/conversations.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // -------- VERIFY (GET) --------
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token) {
      // Match against any connection with this verify_token
      const { data } = await admin
        .from("whatsapp_connections")
        .select("id")
        .eq("verify_token", token)
        .eq("provider", "cloud")
        .maybeSingle();
      if (data) {
        return new Response(challenge ?? "", { status: 200, headers: corsHeaders });
      }
    }
    return new Response("forbidden", { status: 403, headers: corsHeaders });
  }

  // -------- RECEIVE (POST) --------
  try {
    const body = await req.json();
    // Persist raw payload for audit
    await admin.from("facebook_webhook_events").insert({
      object: body.object ?? "whatsapp_business_account",
      payload: body,
      received_at: new Date().toISOString(),
    }).then(() => null).catch(() => null);

    if (body.object !== "whatsapp_business_account") {
      return new Response("ignored", { status: 200, headers: corsHeaders });
    }

    for (const entry of body.entry ?? []) {
      const wabaId = entry.id;
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value ?? {};
        const phoneNumberId = value.metadata?.phone_number_id;

        // Resolve connection -> tenant
        const { data: conn } = await admin
          .from("whatsapp_connections")
          .select("id, tenant_id")
          .eq("provider", "cloud")
          .or(`phone_number_id.eq.${phoneNumberId},waba_id.eq.${wabaId}`)
          .maybeSingle();
        const tenantId = conn?.tenant_id ?? null;

        // Status callbacks from Cloud API contain wamid + delivery state, not
        // the original message text. We update already-saved outbound bubbles.
        for (const st of value.statuses ?? []) {
          const wamid = st.id;
          const status = mapCloudStatus(st.status);
          if (!wamid || !status) continue;
          await admin.from("messages").update({ status }).eq("wamid", wamid);
        }

        // Contacts (for nome)
        const contactMap: Record<string, string> = {};
        for (const c of value.contacts ?? []) {
          contactMap[c.wa_id] = c.profile?.name ?? c.wa_id;
        }

        for (const msg of value.messages ?? []) {
          const from = msg.from as string;
          const nome = contactMap[from] ?? from;
          const text = extractText(msg);
          const rawType = msg.type === "text" ? "text" : msg.type;
          const tipo = ["text", "image", "audio", "video", "document"].includes(rawType) ? rawType : "text";
          const preview = text ?? previewFor(rawType);
          const messageCreatedAt = cloudMessageCreatedAt(msg);

          if (msg.id) {
            const { data: dup } = await admin.from("messages").select("id").eq("wamid", msg.id).maybeSingle();
            if (dup) continue;
          }

          // Find or create lead by whatsapp number
          let leadId: string | null = null;
          let leadQuery = admin
            .from("leads")
            .select("id")
            .eq("whatsapp", from)
            .limit(1);
          leadQuery = tenantId ? leadQuery.eq("tenant_id", tenantId) : leadQuery.is("tenant_id", null);
          const { data: existingLead } = await leadQuery.maybeSingle();
          if (existingLead) {
            leadId = existingLead.id;
            await admin.from("leads").update({ status: "lead" }).eq("id", existingLead.id);
          } else {
            const { data: newLead } = await admin.from("leads").insert({
              nome_completo: nome,
              whatsapp: from,
              origem: "whatsapp_cloud",
              status: "lead",
              tenant_id: tenantId,
              observacoes: `Lead criado automaticamente via WhatsApp Cloud API. Primeira mensagem: ${preview.slice(0, 200)}`,
            }).select("id").single();
            leadId = newLead?.id ?? null;
          }

          // Find or create conversation
          let convId: string | null = null;
          let convQuery = admin
            .from("conversations")
            .select("id, nao_lidas")
            .eq("telefone", from)
            .limit(1);
          convQuery = tenantId ? convQuery.eq("tenant_id", tenantId) : convQuery.is("tenant_id", null);
          const { data: existingConv } = await convQuery.maybeSingle();
          if (existingConv) {
            convId = existingConv.id;
            await admin.from("conversations").update({
              ultima_mensagem: preview,
              ultima_interacao: messageCreatedAt,
              nao_lidas: (existingConv.nao_lidas ?? 0) + 1,
            }).eq("id", existingConv.id);
          } else {
            const { data: newConv } = await admin.from("conversations").insert({
              telefone: from,
              remote_jid: `${from}@s.whatsapp.net`,
              provider: "cloud",
              nome_contato: nome,
              lead_id: leadId,
              ultima_mensagem: preview,
              ultima_interacao: messageCreatedAt,
              nao_lidas: 1,
              tenant_id: tenantId,
            }).select("id").single();
            convId = newConv?.id ?? null;
          }

          if (convId) {
            await admin.from("messages").insert({
              conversation_id: convId,
              sender: "cliente",
              conteudo: preview,
              tipo,
              media_type: rawType === tipo ? null : rawType,
              media_url: extractMediaUrl(msg),
              direction: "inbound",
              status: "delivered",
              wamid: msg.id ?? null,
              lida: false,
              tenant_id: tenantId,
              created_at: messageCreatedAt,
            });
          }
        }

        // statuses (delivered/read) — optional, ignored for now
      }
    }

    return new Response("ok", { status: 200, headers: corsHeaders });
  } catch (e: any) {
    console.error("wa webhook error", e);
    return new Response("err", { status: 200, headers: corsHeaders });
  }
});

function extractText(msg: any): string | null {
  if (msg.text?.body) return msg.text.body;
  if (msg.button?.text) return msg.button.text;
  if (msg.interactive?.button_reply?.title) return msg.interactive.button_reply.title;
  if (msg.interactive?.list_reply?.title) return msg.interactive.list_reply.title;
  if (msg.image?.caption) return msg.image.caption;
  if (msg.video?.caption) return msg.video.caption;
  if (msg.document?.caption) return msg.document.caption;
  return null;
}

function extractMediaUrl(msg: any): string | null {
  return msg.image?.id || msg.video?.id || msg.audio?.id || msg.document?.id || null;
}

function previewFor(type: string): string {
  const map: Record<string, string> = {
    image: "📷 Imagem",
    video: "🎬 Vídeo",
    audio: "🎤 Áudio",
    document: "📄 Documento",
    sticker: "😊 Figurinha",
    location: "📍 Localização",
    contacts: "👤 Contato",
    interactive: "Resposta interativa",
    button: "Resposta de botão",
  };
  return map[type] ?? `[${type || "mensagem"}]`;
}

function cloudMessageCreatedAt(msg: any): string {
  const raw = Number(msg?.timestamp);
  if (Number.isFinite(raw) && raw > 0) {
    const ms = raw > 10_000_000_000 ? raw : raw * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function mapCloudStatus(status: string | undefined): string | null {
  const normalized = String(status ?? "").toLowerCase();
  if (["sent", "delivered", "read", "failed"].includes(normalized)) return normalized;
  return normalized || null;
}
