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

        // Contacts (for nome)
        const contactMap: Record<string, string> = {};
        for (const c of value.contacts ?? []) {
          contactMap[c.wa_id] = c.profile?.name ?? c.wa_id;
        }

        for (const msg of value.messages ?? []) {
          const from = msg.from as string;
          const nome = contactMap[from] ?? from;
          const text = extractText(msg);
          const tipo = msg.type === "text" ? "text" : msg.type;

          // Find or create lead by whatsapp number
          let leadId: string | null = null;
          const { data: existingLead } = await admin
            .from("leads")
            .select("id")
            .eq("whatsapp", from)
            .maybeSingle();
          if (existingLead) {
            leadId = existingLead.id;
            await admin.from("leads").update({ status: "novo" }).eq("id", existingLead.id);
          } else {
            const { data: newLead } = await admin.from("leads").insert({
              nome_completo: nome,
              whatsapp: from,
              origem: "whatsapp_cloud",
              status: "novo",
              tenant_id: tenantId,
              observacoes: `Lead criado automaticamente via WhatsApp Cloud API. Primeira mensagem: ${text?.slice(0, 200) ?? "(mídia)"}`,
            }).select("id").single();
            leadId = newLead?.id ?? null;
          }

          // Find or create conversation
          let convId: string | null = null;
          const { data: existingConv } = await admin
            .from("conversations")
            .select("id, nao_lidas")
            .eq("telefone", from)
            .eq("tenant_id", tenantId)
            .maybeSingle();
          if (existingConv) {
            convId = existingConv.id;
            await admin.from("conversations").update({
              ultima_mensagem: text ?? `[${tipo}]`,
              ultima_interacao: new Date().toISOString(),
              nao_lidas: (existingConv.nao_lidas ?? 0) + 1,
            }).eq("id", existingConv.id);
          } else {
            const { data: newConv } = await admin.from("conversations").insert({
              telefone: from,
              nome_contato: nome,
              lead_id: leadId,
              ultima_mensagem: text ?? `[${tipo}]`,
              ultima_interacao: new Date().toISOString(),
              nao_lidas: 1,
              tenant_id: tenantId,
            }).select("id").single();
            convId = newConv?.id ?? null;
          }

          if (convId) {
            await admin.from("messages").insert({
              conversation_id: convId,
              sender: "cliente",
              conteudo: text ?? "",
              tipo,
              media_url: extractMediaUrl(msg),
              lida: false,
              tenant_id: tenantId,
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
