// Creates a Mercado Pago Pix payment (transparent checkout) for the
// "POSION Fundadores" R$ 250 lifetime offer. Returns QR code + copy/paste.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { mpFetch } from "../_shared/mercadopago.ts";
import { getMpAccessToken } from "../_shared/mp-token.ts";

const FOUNDER_AMOUNT = 250;
const FOUNDER_LIMIT = 10;
const EXPIRATION_MINUTES = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

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

    const { tenant_id, payer_email } = await req.json();
    if (!tenant_id) return json({ error: "tenant_id required" }, 400);
    const email = typeof payer_email === "string" && payer_email.includes("@")
      ? payer_email.trim() : user.email;
    if (!email) return json({ error: "Informe um e-mail válido" }, 400);

    // Access check
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

    // Existing slot? reuse if still valid
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
    if (existing?.status === "pending" && existing.expires_at
        && new Date(existing.expires_at as string).getTime() > Date.now()
        && existing.qr_code_text) {
      return json({
        ok: true,
        payment_id: existing.payment_id,
        qr_code_base64: existing.qr_code_base64,
        qr_code_text: existing.qr_code_text,
        ticket_url: existing.ticket_url,
        expires_at: existing.expires_at,
        status: "pending",
      });
    }

    // Slot availability
    const { data: takenData } = await admin.rpc("count_founder_slots_taken");
    const taken = Number(takenData ?? 0) - (existing ? 1 : 0);
    if (taken >= FOUNDER_LIMIT) {
      return json({ error: "Todas as 10 vagas de Fundador foram preenchidas." }, 409);
    }

    const accessToken = await getMpAccessToken();
    if (!accessToken) return json({ error: "Mercado Pago não configurado" }, 500);

    const expiresAt = new Date(Date.now() + EXPIRATION_MINUTES * 60_000);
    // Mercado Pago requires ISO with offset like -03:00
    const iso = expiresAt.toISOString().replace("Z", "-00:00");

    const body = {
      transaction_amount: FOUNDER_AMOUNT,
      description: "POSION Fundadores — Acesso Vitalício",
      payment_method_id: "pix",
      payer: { email },
      external_reference: `founder:${tenant_id}`,
      date_of_expiration: iso,
      notification_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mp-webhook`,
    };

    const payment = await mpFetch(`/v1/payments`, {
      method: "POST",
      accessToken,
      idempotencyKey: `founder:${tenant_id}:${Date.now()}`,
      body: JSON.stringify(body),
    });

    const tx = payment?.point_of_interaction?.transaction_data ?? {};
    const qr_code_base64 = tx.qr_code_base64 ?? null;
    const qr_code_text = tx.qr_code ?? null;
    const ticket_url = tx.ticket_url ?? null;

    await admin.from("founder_slots").upsert({
      tenant_id,
      payment_id: String(payment.id),
      status: "pending",
      amount_cents: FOUNDER_AMOUNT * 100,
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
