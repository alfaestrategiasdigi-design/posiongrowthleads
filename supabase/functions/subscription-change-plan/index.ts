// Admin Master: change the price of an existing Stripe subscription
// (immediate, with proration). Or cancel/reactivate. Or sync (refresh
// status from Stripe back into our DB).
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, createStripeClient, ensureStripePriceForPlan } from "../_shared/stripe.ts";

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
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: auth } = await userClient.auth.getUser(token);
    const user = auth?.user;
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
    if (!isAdmin) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const body = await req.json();
    const { action, subscription_id, tenant_id, lookup_key, environment, proration_behavior } = body;
    const env: StripeEnv = environment === "live" ? "live" : "sandbox";

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const stripe = createStripeClient(env);

    // Resolve subscription row (by id or tenant)
    let subRow: any;
    if (subscription_id) {
      const { data } = await admin.from("subscriptions").select("*").eq("id", subscription_id).maybeSingle();
      subRow = data;
    } else if (tenant_id) {
      const { data } = await admin.from("subscriptions").select("*")
        .eq("tenant_id", tenant_id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      subRow = data;
    }

    if (action === "change_plan") {
      if (!subRow?.stripe_subscription_id) {
        return new Response(JSON.stringify({ error: "no_active_subscription", message: "Tenant não possui assinatura ativa. Use o checkout para iniciar." }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!lookup_key) throw new Error("lookup_key required");

      const { data: plan } = await admin.from("plan_catalog").select("*").eq("lookup_key", lookup_key).maybeSingle();
      if (!plan) throw new Error("Plan not found");

      const newPriceId = await ensureStripePriceForPlan(stripe, admin, plan);
      const sub = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);
      const itemId = sub.items.data[0].id;

      const updated = await stripe.subscriptions.update(subRow.stripe_subscription_id, {
        items: [{ id: itemId, price: newPriceId }],
        proration_behavior: proration_behavior || "create_prorations",
        metadata: { ...(sub.metadata || {}), plan_code: plan.code, plan_interval: plan.interval, lookup_key: plan.lookup_key },
      });

      return new Response(JSON.stringify({ ok: true, status: updated.status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cancel") {
      if (!subRow?.stripe_subscription_id) throw new Error("No active subscription");
      const at_period_end = body.at_period_end !== false;
      if (at_period_end) {
        await stripe.subscriptions.update(subRow.stripe_subscription_id, { cancel_at_period_end: true });
      } else {
        await stripe.subscriptions.cancel(subRow.stripe_subscription_id);
      }
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "reactivate") {
      if (!subRow?.stripe_subscription_id) throw new Error("No subscription");
      await stripe.subscriptions.update(subRow.stripe_subscription_id, { cancel_at_period_end: false });
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "sync") {
      if (!subRow?.stripe_subscription_id) throw new Error("No subscription");
      const sub = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);
      const item = sub.items.data[0];
      const lookupKey = (item.price as any).lookup_key || sub.metadata?.lookup_key || null;
      await admin.from("subscriptions").update({
        status: sub.status,
        current_period_start: item.current_period_start ? new Date(item.current_period_start * 1000).toISOString() : null,
        current_period_end: item.current_period_end ? new Date(item.current_period_end * 1000).toISOString() : null,
        cancel_at_period_end: sub.cancel_at_period_end || false,
        amount_cents: item.price.unit_amount,
        currency: item.price.currency,
        lookup_key: lookupKey,
        updated_at: new Date().toISOString(),
      }).eq("id", subRow.id);
      return new Response(JSON.stringify({ ok: true, status: sub.status }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    console.error("subscription-change-plan error", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
