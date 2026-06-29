import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: uerr } = await userClient.auth.getUser();
    if (uerr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const admin = createClient(url, service);
    const { data: roleData } = await admin
      .from("user_roles").select("role").eq("user_id", userData.user.id).eq("role", "admin").maybeSingle();
    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { access_token } = await req.json().catch(() => ({}));
    if (!access_token || typeof access_token !== "string" || access_token.length < 20) {
      return new Response(JSON.stringify({ error: "access_token inválido" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Validate against Mercado Pago first
    const meRes = await fetch("https://api.mercadopago.com/users/me", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const meText = await meRes.text();
    let meJson: any = null; try { meJson = JSON.parse(meText); } catch { meJson = meText; }
    if (!meRes.ok) {
      return new Response(JSON.stringify({ error: "Token rejeitado pelo Mercado Pago", detail: meJson }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error: upErr } = await admin
      .from("payment_provider_config")
      .upsert({
        provider: "mercadopago",
        access_token,
        account_id: meJson?.id ? String(meJson.id) : null,
        account_email: meJson?.email ?? null,
        account_site: meJson?.site_id ?? null,
        last_validated_at: new Date().toISOString(),
        last_validation_result: meJson,
      }, { onConflict: "provider" });
    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, account: { id: meJson?.id, email: meJson?.email, site: meJson?.site_id } }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
