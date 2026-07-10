// Polls Mercado Pago for a Pix payment and, when approved, activates the
// tenant subscription. Uses the linked custom offer (if any) to decide the
// recurring amount / interval, otherwise falls back to the default Fundador
// R$ 250 → R$ 389/mês plan.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { mpFetch } from "../_shared/mercadopago.ts";
import { getMpAccessToken } from "../_shared/mp-token.ts";

const INTERVAL_DAYS: Record<string, number> = { month: 30, quarter: 90, semester: 180 };

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

      // Load linked custom offer, if any.
      let offer: any = null;
      if (slot.offer_id) {
        const { data } = await admin.from("tenant_custom_offers")
          .select("*").eq("id", slot.offer_id).maybeSingle();
        offer = data;
      }

      const intervalKey = (offer?.interval as string) || "month";
      const cycles = Number(offer?.entry_cycles ?? 1);
      const days = (INTERVAL_DAYS[intervalKey] ?? 30) * cycles;
      const nextChargeAt = new Date(new Date(paidAt).getTime() + days * 86400_000).toISOString();

      await admin.from("founder_slots").update({
        status: "paid",
        paid_at: paidAt,
        next_charge_at: nextChargeAt,
        updated_at: new Date().toISOString(),
      }).eq("tenant_id", tenant_id);

      // Choose subscription amount / plan_code
      let recurringAmount = 38900; // default Fundador R$ 389/mês
      let planCode = "posion_founder";
      let lookupKey: string | null = "posion_founder_v1";
      let isFounder = true;

      if (offer) {
        recurringAmount = Number(offer.recurring_amount_cents);
        planCode = offer.kind === "founder" ? "posion_founder" : `custom:${offer.id}`;
        lookupKey = offer.kind === "founder" ? "posion_founder_v1" : null;
        isFounder = offer.kind === "founder";
      } else {
        const { data: plan } = await admin.from("plan_catalog")
          .select("*").eq("lookup_key", "posion_founder_v1").maybeSingle();
        recurringAmount = (plan as any)?.amount_cents ?? 38900;
      }

      await admin.from("subscriptions").upsert({
        tenant_id,
        plan_code: planCode,
        interval: intervalKey,
        lookup_key: lookupKey,
        provider: "mercadopago",
        mp_payer_email: slot.payer_email,
        status: "active",
        is_founder: isFounder,
        amount_cents: recurringAmount,
        currency: "brl",
        current_period_end: nextChargeAt,
        environment: "live",
        updated_at: new Date().toISOString(),
      }, { onConflict: "tenant_id" });

      await admin.from("subscription_invoices").insert({
        tenant_id,
        mp_payment_id: String(slot.payment_id),
        amount_paid_cents: Math.round(Number(payment?.transaction_amount ?? (slot.amount_cents / 100)) * 100),
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
