// Validates a WhatsApp Cloud API connection: tests token + phone + webhook subscription
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "unauthorized", reason: "missing_token" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return json({ error: "unauthorized", reason: userErr?.message ?? "invalid_token" }, 401);
    }
    const userId = userData.user.id;

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const isAdmin = roles?.some((r: any) => r.role === "admin");
    if (!isAdmin) return json({ error: "forbidden" }, 403);

    const { connection_id } = await req.json();
    if (!connection_id) return json({ error: "connection_id required" }, 400);

    const { data: conn, error } = await admin
      .from("whatsapp_connections")
      .select("*")
      .eq("id", connection_id)
      .single();
    if (error || !conn) return json({ error: "connection not found" }, 404);

    const checks: Record<string, any> = {};

    if (conn.provider === "cloud") {
      const token = conn.access_token;
      const phoneId = conn.phone_number_id;
      const wabaId = conn.waba_id;
      if (!token || !phoneId) {
        await admin.from("whatsapp_connections").update({
          status: "error",
          last_error: "access_token e phone_number_id são obrigatórios",
          last_validated_at: new Date().toISOString(),
        }).eq("id", connection_id);
        return json({ ok: false, error: "Credenciais incompletas" }, 400);
      }

      // 1. Phone number info
      const phoneRes = await fetch(`${GRAPH}/${phoneId}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const phoneData = await phoneRes.json();
      checks.phone = { ok: phoneRes.ok, data: phoneData };
      if (!phoneRes.ok) {
        const message = phoneData?.error?.message ?? JSON.stringify(phoneData);
        await admin.from("whatsapp_connections").update({
          status: "error",
          last_error: message,
          last_validated_at: new Date().toISOString(),
        }).eq("id", connection_id);
        return json({ ok: false, error: message, checks }, 400);
      }

      // 2. WABA info + webhook subscription (if provided)
      let subscribed = false;
      if (wabaId) {
        const wabaRes = await fetch(`${GRAPH}/${wabaId}?fields=name,currency,timezone_id,message_template_namespace`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const wabaData = await wabaRes.json();
        checks.waba = { ok: wabaRes.ok, data: wabaData };

        // 3. Subscribed apps (webhook). If not subscribed yet, try to subscribe
        // the current Meta app automatically so future inbound/status events hit
        // whatsapp-cloud-webhook. Historical messages are not replayed by Meta.
        const beforeSubRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const beforeSubData = await beforeSubRes.json();
        checks.subscribed_apps_before = { ok: beforeSubRes.ok, data: beforeSubData };
        subscribed = !!(beforeSubData?.data?.length);

        if (!subscribed) {
          const subscribeRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          });
          const subscribeData = await subscribeRes.json().catch(() => ({}));
          checks.subscribe_attempt = { ok: subscribeRes.ok, data: subscribeData };

          const afterSubRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const afterSubData = await afterSubRes.json();
          checks.subscribed_apps_after = { ok: afterSubRes.ok, data: afterSubData };
          subscribed = subscribeRes.ok || !!(afterSubData?.data?.length);
        }
      } else {
        checks.subscribed_apps = { ok: false, error: "waba_id ausente" };
      }

      const businessName = checks.phone?.data?.verified_name || checks.waba?.data?.name;
      const displayPhone = checks.phone?.data?.display_phone_number;
      const webhookError = subscribed ? null : "Webhook ainda não assinado na Meta: confira Callback URL, Verify Token e campo messages.";

      await admin.from("whatsapp_connections").update({
        status: "connected",
        display_phone_number: displayPhone,
        business_account_name: businessName,
        webhook_subscribed: subscribed,
        last_error: webhookError,
        last_validated_at: new Date().toISOString(),
      }).eq("id", connection_id);

      return json({ ok: true, checks, summary: { displayPhone, businessName, subscribed, webhookError } });
    }

    if (conn.provider === "zapi") {
      const instance = conn.metadata?.instance_id;
      const token = conn.access_token;
      const clientToken = conn.metadata?.client_token;
      if (!instance || !token) return json({ error: "Z-API requer instance_id e token" }, 400);
      const url = `https://api.z-api.io/instances/${instance}/token/${token}/status`;
      const res = await fetch(url, { headers: clientToken ? { "Client-Token": clientToken } : {} });
      const data = await res.json();
      const connected = !!data?.connected;
      await admin.from("whatsapp_connections").update({
        status: connected ? "connected" : "error",
        last_error: connected ? null : JSON.stringify(data),
        last_validated_at: new Date().toISOString(),
      }).eq("id", connection_id);
      return json({ ok: connected, data });
    }

    return json({ error: "provider desconhecido" }, 400);
  } catch (e: any) {
    console.error("validate error", e);
    return json({ ok: false, error: String(e?.message ?? e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
