// Polls Mercado Pago for a Pix payment status and activates the
// "POSION Fundadores" lifetime subscription when approved.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { mpFetch } from "../_shared/mercadopago.ts";
import { getMpAccessToken } from "../_shared/mp-token.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: auth } = await supabase.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { tenant_id } = await req.json();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: slot } = await admin.from("founder_slots")
      .select("*").eq("tenant_id", tenant_id).maybeSingle();

    if (!slot) return json({ status: "none" });
    if (slot.status === "paid") return json({ status: "paid", paid_at: slot.paid_at });

    if (!slot.payment_id) return json({ status: slot.status });

    const accessToken = await getMpAccessToken();
    if (!accessToken) return json({ error: "Mercado Pago não configurado" }, 500);

    const payment = await mpFetch(`/v1/payments/${slot.payment_id}`, {
      method: "GET", accessToken,
    });

    const mpStatus = String(payment?.status || "");

    if (mpStatus === "approved") {
      const paidAt = payment?.date_approved || new Date().toISOString();
      const nextChargeAt = new Date(new Date(paidAt).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      await admin.from("founder_slots").update({
        status: "paid",
        paid_at: paidAt,
        next_charge_at: nextChargeAt,
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenant_id);

      // Founder = monthly recurring subscription; first month is the R$ 250 promo,
      // from the 2nd month on the regular mensality of R$ 389 kicks in.
      const { data: plan } = await admin.from("plan_catalog")
        .select("*").eq("lookup_key", "posion_founder_v1").maybeSingle();

      await admin.from("subscriptions").upsert({
        tenant_id,
        plan_code: "posion_founder",
        interval: "month",
        lookup_key: "posion_founder_v1",
        provider: "mercadopago",
        mp_payer_email: slot.payer_email,
        status: "active",
        is_founder: true,
        amount_cents: (plan as any)?.amount_cents ?? 38900,
        currency: (plan as any)?.currency ?? "brl",
        current_period_end: nextChargeAt,
        environment: "live",
        updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id" });

      await admin.from("subscription_invoices").insert({
        tenant_id,
        mp_payment_id: String(slot.payment_id),
        amount_paid_cents: Math.round(Number(payment?.transaction_amount ?? 250) * 100),
        currency: (payment?.currency_id || "brl").toString().toLowerCase(),
        status: "approved",
        paid_at: paidAt,
        receipt_url: slot.ticket_url,
      });

      return json({ status: "paid", paid_at: paidAt });
    }

    if (["cancelled", "rejected", "refunded", "charged_back"].includes(mpStatus)) {
      await admin.from("founder_slots").update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenant_id);
      return json({ status: "cancelled" });
    }

    // Expired?
    if (slot.expires_at && new Date(slot.expires_at as string).getTime() < Date.now()) {
      await admin.from("founder_slots").update({
        status: "expired",
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenant_id);
      return json({ status: "expired" });
    }

    return json({ status: "pending", mp_status: mpStatus });
  } catch (e) {
    console.error("mp-pix-status", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
