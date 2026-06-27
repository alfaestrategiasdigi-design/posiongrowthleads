// Stripe webhook handler — populates subscriptions + subscription_invoices.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type StripeEnv, verifyWebhook } from "../_shared/stripe.ts";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
  }
  return _supabase;
}

async function upsertSubscription(sub: any, env: StripeEnv) {
  const supabase = getSupabase();
  const tenantId = sub.metadata?.tenant_id;
  if (!tenantId) {
    console.warn("subscription event without tenant_id metadata", sub.id);
    return;
  }
  const item = sub.items?.data?.[0];
  const price = item?.price;
  const lookupKey = price?.lookup_key || price?.metadata?.lovable_external_id || sub.metadata?.lookup_key || null;
  const planCode = sub.metadata?.plan_code || price?.metadata?.plan_code || "unknown";
  const planInterval = sub.metadata?.plan_interval || price?.metadata?.plan_interval || (price?.recurring?.interval_count === 3 ? "quarter" : "month");

  const periodStart = item?.current_period_start ?? sub.current_period_start;
  const periodEnd = item?.current_period_end ?? sub.current_period_end;

  await supabase.from("subscriptions").upsert({
    tenant_id: tenantId,
    plan_code: planCode,
    interval: planInterval,
    lookup_key: lookupKey,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    stripe_subscription_id: sub.id,
    status: sub.status,
    current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end || false,
    amount_cents: price?.unit_amount ?? null,
    currency: price?.currency ?? "brl",
    environment: env,
    updated_at: new Date().toISOString(),
  }, { onConflict: "stripe_subscription_id" });
}

async function recordInvoice(invoice: any, env: StripeEnv) {
  const supabase = getSupabase();
  const tenantId = invoice.subscription_details?.metadata?.tenant_id
    || invoice.metadata?.tenant_id
    || null;

  let resolvedTenantId = tenantId;
  if (!resolvedTenantId && invoice.subscription) {
    const { data } = await supabase
      .from("subscriptions")
      .select("tenant_id,id")
      .eq("stripe_subscription_id", invoice.subscription)
      .maybeSingle();
    resolvedTenantId = (data as any)?.tenant_id ?? null;
  }

  const subRow = invoice.subscription ? await supabase
    .from("subscriptions").select("id").eq("stripe_subscription_id", invoice.subscription).maybeSingle() : { data: null };

  await supabase.from("subscription_invoices").upsert({
    tenant_id: resolvedTenantId,
    subscription_id: (subRow as any).data?.id ?? null,
    stripe_invoice_id: invoice.id,
    stripe_customer_id: typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id,
    amount_paid_cents: invoice.amount_paid,
    amount_due_cents: invoice.amount_due,
    currency: invoice.currency,
    status: invoice.status,
    hosted_invoice_url: invoice.hosted_invoice_url,
    invoice_pdf: invoice.invoice_pdf,
    period_start: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
    period_end: invoice.period_end ? new Date(invoice.period_end * 1000).toISOString() : null,
    paid_at: invoice.status_transitions?.paid_at ? new Date(invoice.status_transitions.paid_at * 1000).toISOString() : null,
    environment: env,
  }, { onConflict: "stripe_invoice_id" });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  const rawEnv = new URL(req.url).searchParams.get("env");
  if (rawEnv !== "sandbox" && rawEnv !== "live") {
    return new Response(JSON.stringify({ received: true, ignored: "invalid env" }), { status: 200 });
  }
  const env: StripeEnv = rawEnv;

  try {
    const event = await verifyWebhook(req, env);
    console.log("[payments-webhook]", env, event.type);

    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await upsertSubscription(event.data.object, env);
        break;
      case "customer.subscription.deleted":
        await getSupabase().from("subscriptions").update({
          status: "canceled",
          cancel_at_period_end: false,
          updated_at: new Date().toISOString(),
        }).eq("stripe_subscription_id", event.data.object.id);
        break;
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
      case "invoice.finalized":
        await recordInvoice(event.data.object, env);
        break;
      case "checkout.session.completed": {
        const session = event.data.object as any;
        if (session.mode === "subscription" && session.subscription) {
          // The subsequent customer.subscription.created event will populate the row.
          console.log("checkout completed for sub", session.subscription);
        }
        break;
      }
      default:
        console.log("Unhandled event:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("payments-webhook error", e);
    return new Response("Webhook error", { status: 400 });
  }
});
