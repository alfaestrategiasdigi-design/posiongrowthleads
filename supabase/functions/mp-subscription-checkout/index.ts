// Creates a Mercado Pago pending Preapproval (subscription payment link)
// for a tenant + internal plan and returns the init_point URL for the customer.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";
import { mpFetch } from "../_shared/mercadopago.ts";
import { getMpAccessToken } from "../_shared/mp-token.ts";

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

    const accessToken = await getMpAccessToken();
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
    const requestedBackUrl = back_url || `${origin}/app/${tenant.slug}/planos?mp=success`;
    const finalBackUrl = requestedBackUrl?.startsWith("https://") ? requestedBackUrl : undefined;
    const payerEmail = typeof payer_email === "string" && payer_email.includes("@") ? payer_email.trim() : undefined;
    if (!payerEmail) {
      return new Response(JSON.stringify({ error: "Informe o e-mail do pagador para gerar o link Mercado Pago" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const frequency = (plan as any).interval === "quarter" ? 3 : 1;
    const reason = (plan as any).mp_reason || `POSION ${(plan as any).name}`;
    const externalReference = `${tenant.id}:${(plan as any).code}:${(plan as any).interval}:${Date.now()}`;

    // Create a pending subscription WITHOUT preapproval_plan_id.
    // Mercado Pago requires card_token_id for subscriptions tied to a preapproval_plan.
    // Pending no-plan subscriptions generate an init_point so the customer can add the card in MP checkout.
    const preapprovalBody: Record<string, unknown> = {
      reason,
      external_reference: externalReference,
      auto_recurring: {
        frequency,
        frequency_type: "months",
        transaction_amount: Math.round((plan as any).amount_cents) / 100,
        currency_id: ((plan as any).currency || "brl").toUpperCase(),
      },
      status: "pending",
    };
    if (finalBackUrl) preapprovalBody.back_url = finalBackUrl;
    preapprovalBody.payer_email = payerEmail;

    const preapproval = await mpFetch(`/preapproval`, {
      method: "POST",
      accessToken,
      idempotencyKey: `${tenant.id}:${plan.lookup_key}:${Date.now()}`,
      body: JSON.stringify(preapprovalBody),
    });

    const initPoint = preapproval.init_point || preapproval.sandbox_init_point;
    if (!initPoint) {
      throw new Error("Mercado Pago não retornou link de checkout para esta assinatura");
    }

    // Persist a pending subscription row so admin sees the intent immediately
    await admin.from("subscriptions").upsert({
      tenant_id: tenant.id,
      plan_code: (plan as any).code,
      interval: (plan as any).interval,
      lookup_key: (plan as any).lookup_key,
      provider: "mercadopago",
      mp_preapproval_id: preapproval.id,
      mp_payer_email: payerEmail || null,
      mp_init_point: initPoint,
      status: preapproval.status || "pending",
      amount_cents: (plan as any).amount_cents,
      currency: (plan as any).currency,
      environment: "live",
      updated_at: new Date().toISOString(),
    }, { onConflict: "mp_preapproval_id" });

    return new Response(JSON.stringify({
      ok: true,
      preapproval_id: preapproval.id,
      init_point: initPoint,
      status: preapproval.status,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("mp-subscription-checkout", e);
    return new Response(JSON.stringify({ error: String((e as Error).message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
