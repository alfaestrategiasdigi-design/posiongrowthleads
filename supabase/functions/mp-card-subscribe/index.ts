// Transparent card checkout for the Founder / custom-offer flow.
// Charges entry amount (one-off) and creates a recurring preapproval with card_token_id.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { mpFetch } from "../_shared/mercadopago.ts";
import { getMpAccessToken } from "../_shared/mp-token.ts";

const DEFAULT_ENTRY_CENTS = 25000;      // R$ 250
const DEFAULT_RECURRING_CENTS = 38900;  // R$ 389
const DEFAULT_ENTRY_CYCLES = 1;
const DEFAULT_INTERVAL = "month" as const;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function addInterval(from: Date, count: number, interval: string): Date {
  const d = new Date(from.getTime());
  const months =
    interval === "semester" ? 6 * count :
    interval === "quarter" ? 3 * count :
    count;
  d.setMonth(d.getMonth() + months);
  return d;
}

function intervalToMonths(interval: string): number {
  return interval === "semester" ? 6 : interval === "quarter" ? 3 : 1;
}

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

    const body = await req.json();
    const {
      tenant_id,
      offer_id,
      card_token_id,
      payer,
      installments,
      payment_method_id,
      issuer_id,
    } = body || {};
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);
    if (!card_token_id) return json({ error: "card_token_id required" }, 400);
    const payerEmail = typeof payer?.email === "string" && payer.email.includes("@")
      ? payer.email.trim()
      : user.email;
    if (!payerEmail) return json({ error: "Informe um e-mail de pagador válido" }, 400);

    // authorization: admin or tenant member
    const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: user.id, _role: "admin" });
    let allowed = !!isAdmin;
    if (!allowed) {
      const { data: membership } = await supabase.from("tenant_users")
        .select("role").eq("tenant_id", tenant_id).eq("user_id", user.id).maybeSingle();
      allowed = !!membership;
    }
    if (!allowed) return json({ error: "Forbidden" }, 403);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve offer
    let entryCents = DEFAULT_ENTRY_CENTS;
    let recurringCents = DEFAULT_RECURRING_CENTS;
    let entryCycles = DEFAULT_ENTRY_CYCLES;
    let interval: string = DEFAULT_INTERVAL;
    let description = "POSION Fundadores — cartão recorrente";
    let resolvedOfferId: string | null = null;

    let offer: any = null;
    if (offer_id) {
      const { data } = await admin.from("tenant_custom_offers")
        .select("*").eq("id", offer_id).eq("tenant_id", tenant_id).maybeSingle();
      offer = data;
    } else {
      const { data } = await admin.from("tenant_custom_offers")
        .select("*").eq("tenant_id", tenant_id).eq("active", true)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      offer = data;
    }
    if (offer) {
      if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now())
        return json({ error: "Esta oferta expirou" }, 410);
      if (offer.active === false)
        return json({ error: "Esta oferta não está ativa" }, 410);
      entryCents = Number(offer.entry_amount_cents ?? entryCents);
      recurringCents = Number(offer.recurring_amount_cents ?? recurringCents);
      entryCycles = Number(offer.entry_cycles ?? entryCycles);
      interval = String(offer.interval ?? interval);
      description = offer.description || `POSION — ${offer.label}`;
      resolvedOfferId = offer.id;
    }

    const accessToken = await getMpAccessToken();
    if (!accessToken) return json({ error: "Mercado Pago não configurado" }, 500);

    const externalRef = resolvedOfferId
      ? `offer:${resolvedOfferId}:${tenant_id}`
      : `founder:${tenant_id}`;

    // --- STEP 1: charge the entry amount immediately -----------------------
    const paymentBody: Record<string, unknown> = {
      transaction_amount: Number((entryCents / 100).toFixed(2)),
      description: `${description} — entrada`,
      token: card_token_id,
      installments: Number(installments) || 1,
      payer: { email: payerEmail, ...(payer?.identification ? { identification: payer.identification } : {}) },
      external_reference: externalRef,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
      statement_descriptor: "POSION",
    };
    if (payment_method_id) paymentBody.payment_method_id = payment_method_id;
    if (issuer_id) paymentBody.issuer_id = issuer_id;

    let payment: any;
    try {
      payment = await mpFetch(`/v1/payments`, {
        method: "POST",
        accessToken,
        idempotencyKey: `card-entry:${tenant_id}:${resolvedOfferId ?? "founder"}:${Date.now()}`,
        body: JSON.stringify(paymentBody),
      });
    } catch (e) {
      console.error("mp-card-subscribe payment error", e);
      return json({ error: `Falha na cobrança do cartão: ${(e as Error).message || e}` }, 400);
    }

    if (!["approved", "authorized", "in_process", "pending"].includes(String(payment?.status))) {
      const detail = payment?.status_detail || payment?.status || "recusado";
      return json({ error: `Pagamento não aprovado (${detail}). Verifique os dados do cartão.` }, 400);
    }

    // --- STEP 2: create recurring preapproval ------------------------------
    // start_date = when entry cycles finish. If entryCycles==0 use 1 interval ahead.
    const cycles = Math.max(entryCycles, 1);
    const startDate = addInterval(new Date(), cycles, interval);
    const preapprovalBody: Record<string, unknown> = {
      reason: `${description} — recorrência`.slice(0, 250),
      external_reference: externalRef,
      payer_email: payerEmail,
      card_token_id,
      auto_recurring: {
        frequency: intervalToMonths(interval),
        frequency_type: "months",
        transaction_amount: Number((recurringCents / 100).toFixed(2)),
        currency_id: "BRL",
        start_date: startDate.toISOString(),
      },
      back_url: `${Deno.env.get("PUBLIC_SITE_URL") || "https://posiongrowthleads.lovable.app"}/admin/planos?mp=success`,
      status: "authorized",
    };

    let preapproval: any = null;
    try {
      preapproval = await mpFetch(`/preapproval`, {
        method: "POST",
        accessToken,
        idempotencyKey: `card-sub:${tenant_id}:${resolvedOfferId ?? "founder"}:${Date.now()}`,
        body: JSON.stringify(preapprovalBody),
      });
    } catch (e) {
      // Entry charged but recurring failed — still record slot; surface warning
      console.error("mp-card-subscribe preapproval error", e);
    }

    // Persist slot (mirrors Pix flow)
    await admin.from("founder_slots").upsert({
      tenant_id,
      offer_id: resolvedOfferId,
      payment_id: String(payment.id),
      status: payment.status === "approved" ? "paid" : "pending",
      amount_cents: entryCents,
      payer_email: payerEmail,
      ticket_url: null,
      qr_code_base64: null,
      qr_code_text: null,
      expires_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });

    // Persist subscription row
    if (preapproval?.id) {
      await admin.from("subscriptions").upsert({
        tenant_id,
        plan_code: "founder_card",
        interval,
        lookup_key: `founder-${interval}`,
        provider: "mercadopago",
        mp_preapproval_id: preapproval.id,
        mp_payer_email: payerEmail,
        status: preapproval.status || "authorized",
        amount_cents: recurringCents,
        currency: "BRL",
        environment: "live",
        updated_at: new Date().toISOString(),
      }, { onConflict: "mp_preapproval_id" });
    }

    return json({
      ok: true,
      payment_id: String(payment.id),
      payment_status: payment.status,
      preapproval_id: preapproval?.id || null,
      preapproval_status: preapproval?.status || null,
      preapproval_warning: preapproval ? null : "Cobrança da entrada OK, mas a recorrência não foi criada. Contate o suporte.",
      recurring_amount_cents: recurringCents,
      recurring_starts_at: startDate.toISOString(),
    });
  } catch (e) {
    console.error("mp-card-subscribe", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
