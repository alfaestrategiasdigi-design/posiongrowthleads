// Mercado Pago notifications (IPN/webhook).
// Public endpoint — validates the configured secret token via query string
// and re-fetches the resource from MP using the Access Token.
import { createClient } from "npm:@supabase/supabase-js@2";
import { mpFetch } from "../_shared/mercadopago.ts";

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

async function syncPreapproval(id: string, accessToken: string) {
  try {
    const pre = await mpFetch(`/preapproval/${id}`, { method: "GET", accessToken });
    if (!pre?.id) return;

    const ext = String(pre.external_reference || "");
    const [tenant_id, plan_code, interval] = ext.split(":");

    const updates: any = {
      provider: "mercadopago",
      mp_preapproval_id: pre.id,
      mp_payer_email: pre.payer_email ?? null,
      mp_init_point: pre.init_point ?? null,
      status: pre.status, // pending, authorized, paused, cancelled
      amount_cents: pre.auto_recurring?.transaction_amount
        ? Math.round(pre.auto_recurring.transaction_amount * 100)
        : null,
      currency: (pre.auto_recurring?.currency_id || "BRL").toLowerCase(),
      current_period_start: pre.date_created ? new Date(pre.date_created).toISOString() : null,
      current_period_end: pre.next_payment_date ? new Date(pre.next_payment_date).toISOString() : null,
      cancel_at_period_end: false,
      environment: "live",
      updated_at: new Date().toISOString(),
    };
    if (tenant_id) updates.tenant_id = tenant_id;
    if (plan_code) updates.plan_code = plan_code;
    if (interval) updates.interval = interval;

    await getSupabase().from("subscriptions").upsert(updates, { onConflict: "mp_preapproval_id" });
  } catch (e) {
    console.error("syncPreapproval error", id, e);
  }
}

async function syncAuthorizedPayment(id: string, accessToken: string) {
  try {
    const pay = await mpFetch(`/authorized_payments/${id}`, { method: "GET", accessToken });
    if (!pay?.id) return;
    const preId = pay.preapproval_id;
    let tenantId: string | null = null;
    let subRowId: string | null = null;
    if (preId) {
      const { data: sub } = await getSupabase()
        .from("subscriptions").select("id,tenant_id")
        .eq("mp_preapproval_id", preId).maybeSingle();
      tenantId = (sub as any)?.tenant_id ?? null;
      subRowId = (sub as any)?.id ?? null;
    }
    await getSupabase().from("subscription_invoices").upsert({
      tenant_id: tenantId,
      subscription_id: subRowId,
      mp_payment_id: String(pay.id),
      amount_paid_cents: pay.transaction_amount ? Math.round(pay.transaction_amount * 100) : 0,
      amount_due_cents: pay.transaction_amount ? Math.round(pay.transaction_amount * 100) : 0,
      currency: (pay.currency_id || "BRL").toLowerCase(),
      status: pay.status, // approved, rejected, pending, refunded
      paid_at: pay.payment_date ? new Date(pay.payment_date).toISOString() : null,
      period_start: pay.debit_date ? new Date(pay.debit_date).toISOString() : null,
      period_end: pay.debit_date ? new Date(pay.debit_date).toISOString() : null,
      receipt_url: pay.payment?.receipt_url ?? null,
      environment: "live",
    }, { onConflict: "mp_payment_id" });
  } catch (e) {
    console.error("syncAuthorizedPayment error", id, e);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const expected = Deno.env.get("MP_WEBHOOK_SECRET");
  const provided = url.searchParams.get("secret") || req.headers.get("x-mp-secret");
  if (expected && provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "invalid secret" }), { status: 401 });
  }

  const accessToken = Deno.env.get("MP_ACCESS_TOKEN");
  if (!accessToken) {
    return new Response(JSON.stringify({ ok: false, error: "MP_ACCESS_TOKEN not set" }), { status: 200 });
  }

  let payload: any = null;
  try { payload = await req.json(); } catch { payload = null; }

  const type = (payload?.type || payload?.topic || url.searchParams.get("type") || url.searchParams.get("topic") || "").toString();
  const dataId = String(payload?.data?.id || payload?.id || url.searchParams.get("id") || url.searchParams.get("data.id") || "");

  console.log("[mp-webhook]", type, dataId);

  try {
    if (!dataId) {
      return new Response(JSON.stringify({ received: true, ignored: "no id" }), { status: 200 });
    }
    if (type.includes("preapproval") && !type.includes("authorized")) {
      await syncPreapproval(dataId, accessToken);
    } else if (type.includes("authorized_payment") || type.includes("subscription_authorized_payment")) {
      await syncAuthorizedPayment(dataId, accessToken);
    } else if (type === "payment") {
      // Generic payment notification — fetch and only record if linked to a preapproval
      try {
        const pay = await mpFetch(`/v1/payments/${dataId}`, { method: "GET", accessToken });
        const preId = pay?.metadata?.preapproval_id || pay?.point_of_interaction?.transaction_data?.subscription_id;
        if (preId) await syncAuthorizedPayment(dataId, accessToken);
        else console.log("[mp-webhook] payment without preapproval, ignoring", dataId);
      } catch (e) { console.error(e); }
    } else {
      console.log("[mp-webhook] unhandled type", type);
    }
    return new Response(JSON.stringify({ received: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("mp-webhook error", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), { status: 200 });
  }
});
