// Shared Stripe utility — gateway-routed access
import { encode } from "https://deno.land/std@0.168.0/encoding/hex.ts";
import Stripe from "https://esm.sh/stripe@22.0.2";

const getEnv = (key: string): string => {
  const value = Deno.env.get(key);
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = "sandbox" | "live";

const GATEWAY_STRIPE_BASE = "https://connector-gateway.lovable.dev/stripe";

export function getConnectionApiKey(env: StripeEnv): string {
  return env === "sandbox"
    ? getEnv("STRIPE_SANDBOX_API_KEY")
    : getEnv("STRIPE_LIVE_API_KEY");
}

export function createStripeClient(env: StripeEnv): Stripe {
  const connectionApiKey = getConnectionApiKey(env);
  const lovableApiKey = getEnv("LOVABLE_API_KEY");

  return new Stripe(connectionApiKey, {
    apiVersion: "2026-03-25.dahlia",
    httpClient: Stripe.createFetchHttpClient((input, init) => {
      const stripeUrl = input instanceof Request ? input.url : input.toString();
      const gatewayUrl = stripeUrl.replace("https://api.stripe.com", GATEWAY_STRIPE_BASE);
      return fetch(gatewayUrl, {
        ...init,
        headers: {
          ...Object.fromEntries(
            new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).entries(),
          ),
          "X-Connection-Api-Key": connectionApiKey,
          "Lovable-API-Key": lovableApiKey,
        },
      });
    }),
  });
}

export async function verifyWebhook(req: Request, env: StripeEnv): Promise<{ type: string; data: { object: any } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  const secret = env === "sandbox"
    ? getEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET")
    : getEnv("PAYMENTS_LIVE_WEBHOOK_SECRET");

  if (!signature || !body) throw new Error("Missing signature or body");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Signatures.push(value);
  }
  if (!timestamp || v1Signatures.length === 0) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = new TextDecoder().decode(encode(new Uint8Array(signed)));

  if (!v1Signatures.includes(expected)) throw new Error("Invalid webhook signature");
  return JSON.parse(body);
}

/**
 * Resolves a Stripe Price for a plan_catalog row.
 * - If stripe_price_id is already cached and active → returns it.
 * - Else tries to find by lookup_key.
 * - Else creates a new Price (creating Product if needed). Supports
 *   interval='month' and interval='quarter' (mapped to month x3).
 * Caches the IDs back into plan_catalog.
 */
export async function ensureStripePriceForPlan(
  stripe: Stripe,
  supabase: any,
  plan: {
    id: string;
    code: string;
    interval: string;
    name: string;
    amount_cents: number;
    currency: string;
    lookup_key: string;
    stripe_price_id: string | null;
    stripe_product_id: string | null;
  },
): Promise<string> {
  if (plan.stripe_price_id) {
    try {
      const existing = await stripe.prices.retrieve(plan.stripe_price_id);
      if (existing.active && existing.unit_amount === plan.amount_cents) return existing.id;
    } catch (_) {}
  }

  // Try by lookup_key
  const byLookup = await stripe.prices.list({ lookup_keys: [plan.lookup_key], limit: 1 });
  if (byLookup.data.length && byLookup.data[0].unit_amount === plan.amount_cents) {
    const price = byLookup.data[0];
    const productId = typeof price.product === "string" ? price.product : price.product.id;
    await supabase.from("plan_catalog").update({
      stripe_price_id: price.id,
      stripe_product_id: productId,
    }).eq("id", plan.id);
    return price.id;
  }

  // Find/create product
  let productId = plan.stripe_product_id;
  if (!productId) {
    const productExternalId = `posion_${plan.code}`;
    const products = await stripe.products.search({ query: `metadata['lovable_external_id']:'${productExternalId}'`, limit: 1 });
    if (products.data.length) {
      productId = products.data[0].id;
    } else {
      const created = await stripe.products.create({
        name: `POSION ${plan.code.charAt(0).toUpperCase() + plan.code.slice(1)}`,
        tax_code: "txcd_10103001",
        metadata: { lovable_external_id: productExternalId },
      });
      productId = created.id;
    }
  }

  // Create new Price
  const intervalCount = plan.interval === "quarter" ? 3 : 1;
  const newPrice = await stripe.prices.create({
    product: productId,
    unit_amount: plan.amount_cents,
    currency: plan.currency,
    recurring: { interval: "month", interval_count: intervalCount },
    lookup_key: plan.lookup_key,
    transfer_lookup_key: true,
    nickname: plan.name,
    metadata: { lovable_external_id: plan.lookup_key, plan_code: plan.code, plan_interval: plan.interval },
  });

  await supabase.from("plan_catalog").update({
    stripe_price_id: newPrice.id,
    stripe_product_id: productId,
  }).eq("id", plan.id);

  return newPrice.id;
}

export async function resolveOrCreateCustomerForTenant(
  stripe: Stripe,
  tenant: { id: string; name: string; slug: string },
  email?: string,
): Promise<string> {
  const found = await stripe.customers.search({
    query: `metadata['tenant_id']:'${tenant.id}'`,
    limit: 1,
  });
  if (found.data.length) return found.data[0].id;

  if (email) {
    const byEmail = await stripe.customers.list({ email, limit: 1 });
    if (byEmail.data.length) {
      const c = byEmail.data[0];
      await stripe.customers.update(c.id, {
        metadata: { ...c.metadata, tenant_id: tenant.id, tenant_slug: tenant.slug },
      });
      return c.id;
    }
  }

  const created = await stripe.customers.create({
    name: tenant.name,
    ...(email && { email }),
    metadata: { tenant_id: tenant.id, tenant_slug: tenant.slug },
  });
  return created.id;
}
