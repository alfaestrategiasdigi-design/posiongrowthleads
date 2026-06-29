// Creates a Mercado Pago Preapproval (subscription) for a tenant + plan
// and returns the init_point URL for the customer to complete payment.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ensureMpPreapprovalPlan, mpFetch } from "../_shared/mercadopago.ts";

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
    const user = auth?.user;
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tenant_id, lookup_key, payer_email, back_url } = await req.json();
    if (!tenant_id || !lookup_key) {
      return new Response(JSON.stringify({ error: "tenant_id and lookup_key required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    let allowed = !!isAdmin;
    if (!allowed) {
      const { data: membership } = await supabase
        .from("tenant_users").select("role").eq("tenant_id", tenant_id).eq("user_id", user.id).maybeSingle();
      allowed = !!membership;
    }
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = Deno.env.get("MP_ACCESS_TOKEN");
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Mercado Pago não configurado" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tenant } = await admin.from("tenants")
      .select("id,name,slug").eq("id", tenant_id).maybeSingle();
    if (!tenant) {
      return new Response(JSON.stringify({ error: "Tenant not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: plan } = await admin.from("plan_catalog")
      .select("*").eq("lookup_key", lookup_key).maybeSingle();
    if (!plan) {
      return new Response(JSON.stringify({ error: "Plan not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const origin = req.headers.get("origin") || "";
    const finalBackUrl = back_url || `${origin}/app/${tenant.slug}/planos?mp=success`;

    // Ensure Preapproval Plan exists in MP
    const ensured = await ensureMpPreapprovalPlan(
      accessToken,
      plan as any,
      finalBackUrl,
    );
    if (ensured.created || (plan as any).mp_preapproval_plan_id !== ensured.id) {
      await admin.from("plan_catalog").update({ mp_preapproval_plan_id: ensured.id }).eq("id", (plan as any).id);
    }

    const payerEmail = payer_email || user.email;

    // Create Preapproval (subscription)
    const preapproval = await mpFetch(`/preapproval`, {
      method: "POST",
      accessToken,
      idempotencyKey: `${tenant.id}:${plan.lookup_key}:${Date.now()}`,
      body: JSON.stringify({
        preapproval_plan_id: ensured.id,
        payer_email: payerEmail,
        back_url: finalBackUrl,
        external_reference: `${tenant.id}:${plan.code}:${plan.interval}`,
        status: "pending",
      }),
    });

    // Persist a pending subscription row so admin sees the intent immediately
    await admin.from("subscriptions").upsert({
      tenant_id: tenant.id,
      plan_code: (plan as any).code,
      interval: (plan as any).interval,
      lookup_key: (plan as any).lookup_key,
      provider: "mercadopago",
      mp_preapproval_id: preapproval.id,
      mp_payer_email: payerEmail,
      mp_init_point: preapproval.init_point,
      status: preapproval.status || "pending",
      amount_cents: (plan as any).amount_cents,
      currency: (plan as any).currency,
      environment: "live",
      updated_at: new Date().toISOString(),
    }, { onConflict: "mp_preapproval_id" });

    return new Response(JSON.stringify({
      ok: true,
      preapproval_id: preapproval.id,
      init_point: preapproval.init_point,
      status: preapproval.status,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("mp-subscription-checkout", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
