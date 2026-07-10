// Creates a Mercado Pago Pix payment (transparent checkout) for either the
// default "POSION Fundadores" offer OR a per-tenant custom offer configured
// by the admin in the Planos & Cobranças page.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { mpFetch } from "../_shared/mercadopago.ts";
import { getMpAccessToken } from "../_shared/mp-token.ts";

const DEFAULT_FOUNDER_AMOUNT_CENTS = 25000; // R$ 250
const FOUNDER_LIMIT = 10;
const EXPIRATION_MINUTES = 30;
const DEFAULT_DESCRIPTION =
  "POSION Fundadores — 1º mês: R$ 250 (a partir do 2º mês R$ 389/mês)";

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

    const { tenant_id, payer_email, offer_id } = await req.json();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);
    const email = typeof payer_email === "string" && payer_email.includes("@")
      ? payer_email.trim() : user.email;
    if (!email) return json({ error: "Informe um e-mail válido" }, 400);

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

    // Resolve amount + description: either a custom offer or the default Fundador R$ 250.
    let amountCents = DEFAULT_FOUNDER_AMOUNT_CENTS;
    let description = DEFAULT_DESCRIPTION;
    let resolvedOfferId: string | null = null;

    // Auto-pick tenant's active offer if none provided
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
      if (offer.expires_at && new Date(offer.expires_at).getTime() < Date.now()) {
        return json({ error: "Esta oferta expirou" }, 410);
      }
      if (offer.active === false) {
        return json({ error: "Esta oferta não está ativa" }, 410);
      }
      amountCents = Number(offer.entry_amount_cents);
      description = offer.description
        || `POSION — ${offer.label} (R$ ${(amountCents / 100).toFixed(2)})`;
      resolvedOfferId = offer.id;
    }

    // Existing slot? reuse only if for the same offer + still valid
    const { data: existing } = await admin.from("founder_slots")
      .select("*").eq("tenant_id", tenant_id).maybeSingle();

    if (existing?.status === "paid") {
      return json({
        ok: true,
        already_paid: true,
        status: "paid",
        payment_id: existing.payment_id,
      });
    }

    const sameOffer = (existing?.offer_id ?? null) === resolvedOfferId
      && (existing?.amount_cents ?? DEFAULT_FOUNDER_AMOUNT_CENTS) === amountCents;

    if (
      sameOffer && existing?.status === "pending" && existing.expires_at
      && new Date(existing.expires_at as string).getTime() > Date.now()
      && existing.qr_code_text
    ) {
      return json({
        ok: true,
        payment_id: existing.payment_id,
        qr_code_base64: existing.qr_code_base64,
        qr_code_text: existing.qr_code_text,
        ticket_url: existing.ticket_url,
        expires_at: existing.expires_at,
        status: "pending",
        amount_cents: existing.amount_cents,
        offer_id: existing.offer_id,
      });
    }

    // Slot availability check only for the default Fundador offer (not custom).
    if (!offer || offer.kind === "founder") {
      const { data: takenData } = await admin.rpc("count_founder_slots_taken");
      const taken = Number(takenData ?? 0) - (existing ? 1 : 0);
      if (taken >= FOUNDER_LIMIT) {
        return json({ error: "Todas as 10 vagas de Fundador foram preenchidas." }, 409);
      }
    }

    const accessToken = await getMpAccessToken();
    if (!accessToken) return json({ error: "Mercado Pago não configurado" }, 500);

    const expiresAt = new Date(Date.now() + EXPIRATION_MINUTES * 60_000);
    const iso = expiresAt.toISOString().replace("Z", "-00:00");

    const body = {
      transaction_amount: Number((amountCents / 100).toFixed(2)),
      description,
      payment_method_id: "pix",
      payer: { email },
      external_reference: resolvedOfferId
        ? `offer:${resolvedOfferId}:${tenant_id}`
        : `founder:${tenant_id}`,
      date_of_expiration: iso,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
    };

    const payment = await mpFetch(`/v1/payments`, {
      method: "POST",
      accessToken,
      idempotencyKey: `pix:${tenant_id}:${resolvedOfferId ?? "founder"}:${Date.now()}`,
      body: JSON.stringify(body),
    });

    const tx = payment?.point_of_interaction?.transaction_data ?? {};
    const qr_code_base64 = tx.qr_code_base64 ?? null;
    const qr_code_text = tx.qr_code ?? null;
    const ticket_url = tx.ticket_url ?? null;

    await admin.from("founder_slots").upsert({
      tenant_id,
      offer_id: resolvedOfferId,
      payment_id: String(payment.id),
      status: "pending",
      amount_cents: amountCents,
      qr_code_base64,
      qr_code_text,
      ticket_url,
      payer_email: email,
      expires_at: expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: "tenant_id" });

    return json({
      ok: true,
      payment_id: String(payment.id),
      qr_code_base64,
      qr_code_text,
      ticket_url,
      expires_at: expiresAt.toISOString(),
      status: "pending",
      amount_cents: amountCents,
      offer_id: resolvedOfferId,
    });
  } catch (e) {
    console.error("mp-pix-create", e);
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
