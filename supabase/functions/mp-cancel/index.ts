// Cancels (or pauses) a Mercado Pago Preapproval.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { mpFetch } from "../_shared/mercadopago.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: auth } = await supabase.auth.getUser(token);
    if (!auth?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { preapproval_id, action } = await req.json();
    if (!preapproval_id) {
      return new Response(JSON.stringify({ error: "preapproval_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const accessToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Mercado Pago não configurado" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Authorization: admin OR tenant member of the subscription tenant
    const { data: sub } = await admin.from("subscriptions")
      .select("id,tenant_id").eq("mp_preapproval_id", preapproval_id).maybeSingle();
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: auth.user.id, _role: "admin" });
    if (!isAdmin) {
      if (!sub) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: m } = await supabase.from("tenant_users")
        .select("role").eq("tenant_id", sub.tenant_id).eq("user_id", auth.user.id).maybeSingle();
      if (!m) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const status = action === "pause" ? "paused"
      : action === "resume" ? "authorized"
      : "cancelled";
    const updated = await mpFetch(`/preapproval/${preapproval_id}`, {
      method: "PUT",
      accessToken,
      body: JSON.stringify({ status }),
    });

    await admin.from("subscriptions").update({
      status: updated.status,
      updated_at: new Date().toISOString(),
    }).eq("mp_preapproval_id", preapproval_id);

    return new Response(JSON.stringify({ ok: true, status: updated.status }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
