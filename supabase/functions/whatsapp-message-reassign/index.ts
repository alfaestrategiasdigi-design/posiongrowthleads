// Manual message-level reassignment tool.
// Only admin or tenant-admin roles for the message's tenant may move a message
// to a different conversation. Written as a response to the 2026-07-05 wrong-
// merge incident: when payload evidence is not unique enough to auto-reassign,
// a human must decide message-by-message.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "missing_auth" }, 401);

    const user = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await user.auth.getUser(jwt);
    if (userErr || !userData?.user) return json({ error: "invalid_auth" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const messageId = String(body?.message_id ?? "").trim();
    const targetConversationId = String(body?.target_conversation_id ?? "").trim();
    const reason = String(body?.reason ?? "").slice(0, 500);
    if (!messageId || !targetConversationId) {
      return json({ error: "message_id_and_target_conversation_id_required" }, 400);
    }

    const [{ data: msg }, { data: target }] = await Promise.all([
      admin.from("messages")
        .select("id, tenant_id, conversation_id, metadata, sender, direction, wamid, conteudo")
        .eq("id", messageId).maybeSingle(),
      admin.from("conversations")
        .select("id, tenant_id, remote_jid, telefone, nome_contato")
        .eq("id", targetConversationId).maybeSingle(),
    ]);
    if (!msg) return json({ error: "message_not_found" }, 404);
    if (!target) return json({ error: "target_conversation_not_found" }, 404);
    if (msg.tenant_id && target.tenant_id && msg.tenant_id !== target.tenant_id) {
      return json({ error: "cross_tenant_move_forbidden" }, 400);
    }

    // Authorization: admin OR tenant-admin/comercial-tenant for the message's tenant.
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    let allowed = Boolean(isAdmin);
    if (!allowed && msg.tenant_id) {
      const { data: isTenantAdmin } = await admin.rpc("is_tenant_admin", {
        _user_id: userId, _tenant_id: msg.tenant_id,
      });
      allowed = Boolean(isTenantAdmin);
    }
    if (!allowed) return json({ error: "forbidden" }, 403);

    const currentMeta = (msg.metadata ?? {}) as Record<string, unknown>;
    const reassignLog = Array.isArray(currentMeta.manual_reassign_log)
      ? [...(currentMeta.manual_reassign_log as any[])]
      : [];
    reassignLog.push({
      at: new Date().toISOString(),
      by: userId,
      from_conversation_id: msg.conversation_id,
      to_conversation_id: targetConversationId,
      reason: reason || null,
    });

    const { error: updErr } = await admin.from("messages").update({
      conversation_id: targetConversationId,
      metadata: { ...currentMeta, manual_reassign_log: reassignLog },
    }).eq("id", messageId);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({
      ok: true,
      moved: {
        message_id: messageId,
        from_conversation_id: msg.conversation_id,
        to_conversation_id: targetConversationId,
        by: userId,
      },
    });
  } catch (e) {
    console.error("[whatsapp-message-reassign]", e);
    return json({ error: String(e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
