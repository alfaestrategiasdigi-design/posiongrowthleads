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

    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthorized" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
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
      if (!phoneRes.ok) throw new Error(`Phone check failed: ${JSON.stringify(phoneData)}`);

      // 2. WABA info (if provided)
      if (wabaId) {
        const wabaRes = await fetch(`${GRAPH}/${wabaId}?fields=name,currency,timezone_id,message_template_namespace`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const wabaData = await wabaRes.json();
        checks.waba = { ok: wabaRes.ok, data: wabaData };

        // 3. Subscribed apps (webhook)
        const subRes = await fetch(`${GRAPH}/${wabaId}/subscribed_apps`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const subData = await subRes.json();
        checks.subscribed_apps = { ok: subRes.ok, data: subData };
      }

      const businessName = checks.phone?.data?.verified_name || checks.waba?.data?.name;
      const displayPhone = checks.phone?.data?.display_phone_number;
      const subscribed = !!(checks.subscribed_apps?.data?.data?.length);

      await admin.from("whatsapp_connections").update({
        status: "connected",
        display_phone_number: displayPhone,
        business_account_name: businessName,
        webhook_subscribed: subscribed,
        last_error: null,
        last_validated_at: new Date().toISOString(),
      }).eq("id", connection_id);

      return json({ ok: true, checks, summary: { displayPhone, businessName, subscribed } });
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
