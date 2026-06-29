// Creates an embedded Checkout Session in subscription mode for a tenant.
// Admin Master only. Used to start the first subscription or to switch
// plan when the tenant has no Stripe customer/payment method yet.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  type StripeEnv,
  createStripeClient,
  ensureStripePriceForPlan,
  resolveOrCreateCustomerForTenant,
} from "../_shared/stripe.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { tenant_id, lookup_key, environment, return_url, customer_email } = await req.json();
    if (!tenant_id || !lookup_key) {
      return new Response(JSON.stringify({ error: "tenant_id and lookup_key required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }


    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tenant } = await admin.from("tenants").select("id,name,slug").eq("id", tenant_id).maybeSingle();
    if (!tenant) {
      return new Response(JSON.stringify({ error: "Tenant not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: plan } = await admin.from("plan_catalog").select("*").eq("lookup_key", lookup_key).maybeSingle();
    if (!plan) {
      return new Response(JSON.stringify({ error: "Plan not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const env: StripeEnv = environment === "live" ? "live" : "sandbox";
    const stripe = createStripeClient(env);

    const priceId = await ensureStripePriceForPlan(stripe, admin, plan);
    const customerId = await resolveOrCreateCustomerForTenant(stripe, tenant, customer_email);

    const session = await stripe.checkout.sessions.create({
      line_items: [{ price: priceId, quantity: 1 }],
      mode: "subscription",
      ui_mode: "embedded_page",
      return_url: return_url || `${req.headers.get("origin") || ""}/admin?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      customer: customerId,
      metadata: { tenant_id: tenant.id, tenant_slug: tenant.slug, plan_code: plan.code, plan_interval: plan.interval },
      subscription_data: {
        metadata: { tenant_id: tenant.id, tenant_slug: tenant.slug, plan_code: plan.code, plan_interval: plan.interval, lookup_key: plan.lookup_key },
      },
    });

    return new Response(JSON.stringify({ clientSecret: session.client_secret, customerId, priceId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("subscription-checkout error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
