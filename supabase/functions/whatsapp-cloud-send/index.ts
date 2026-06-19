// Sends WhatsApp Cloud API messages (text or template) using credentials stored in DB.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const GRAPH = "https://graph.facebook.com/v21.0";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json();
    const { connection_id, to, text, template, conversation_id } = body;
    if (!connection_id || !to) return json({ error: "connection_id and to required" }, 400);

    const { data: conn } = await admin
      .from("whatsapp_connections")
      .select("*")
      .eq("id", connection_id)
      .single();
    if (!conn) return json({ error: "connection not found" }, 404);

    // Permission: admin or tenant member
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const isAdmin = roles?.some((r: any) => r.role === "admin");
    if (!isAdmin && conn.tenant_id) {
      const { data: tu } = await admin.from("tenant_users")
        .select("id").eq("user_id", user.id).eq("tenant_id", conn.tenant_id).eq("active", true).maybeSingle();
      if (!tu) return json({ error: "forbidden" }, 403);
    } else if (!isAdmin) {
      return json({ error: "forbidden" }, 403);
    }

    if (conn.provider !== "cloud") return json({ error: "Use Z-API endpoint for this connection" }, 400);

    const payload: any = {
      messaging_product: "whatsapp",
      to: String(to).replace(/\D/g, ""),
    };
    if (template) {
      payload.type = "template";
      payload.template = template; // { name, language: { code }, components: [...] }
    } else {
      payload.type = "text";
      payload.text = { body: String(text ?? "") };
    }

    const res = await fetch(`${GRAPH}/${conn.phone_number_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) return json({ ok: false, error: data }, res.status);

    // Log outgoing message
    if (conversation_id) {
      await admin.from("messages").insert({
        conversation_id,
        sender: "atendente",
        conteudo: text ?? `[template:${template?.name}]`,
        tipo: template ? "template" : "text",
        lida: true,
        tenant_id: conn.tenant_id,
      });
      await admin.from("conversations").update({
        ultima_mensagem: text ?? `[template]`,
        ultima_interacao: new Date().toISOString(),
      }).eq("id", conversation_id);
    }

    return json({ ok: true, data });
  } catch (e: any) {
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
