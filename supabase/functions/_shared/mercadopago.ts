// Shared Mercado Pago helper.
// All requests use the account's Access Token configured in the Admin Master.

export const MP_BASE = "https://api.mercadopago.com";

export function mpHeaders(accessToken: string, idempotencyKey?: string) {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (idempotencyKey) h["X-Idempotency-Key"] = idempotencyKey;
  return h;
}

export async function mpFetch(
  path: string,
  init: RequestInit & { accessToken: string; idempotencyKey?: string },
) {
  const { accessToken, idempotencyKey, headers, ...rest } = init;
  const res = await fetch(`${MP_BASE}${path}`, {
    ...rest,
    headers: { ...mpHeaders(accessToken, idempotencyKey), ...(headers || {}) },
  });
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const msg = (body && (body.message || body.error || body.cause)) || `MP ${path} → ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return body;
}

/** Ensure a Preapproval Plan exists for the given plan_catalog row. */
export async function ensureMpPreapprovalPlan(
  accessToken: string,
  plan: {
    id: string;
    code: string;
    interval: string; // 'month' | 'quarter'
    name: string;
    amount_cents: number;
    currency: string;
    lookup_key: string;
    mp_preapproval_plan_id: string | null;
    mp_reason: string | null;
  },
  backUrl: string,
) {
  if (plan.mp_preapproval_plan_id) {
    try {
      const existing = await mpFetch(`/preapproval_plan/${plan.mp_preapproval_plan_id}`, {
        method: "GET",
        accessToken,
      });
      if (existing?.id) return { id: existing.id as string, created: false };
    } catch (_) { /* fall through */ }
  }

  const frequency = plan.interval === "semester" ? 6 : plan.interval === "quarter" ? 3 : 1;
  const reason = plan.mp_reason || `POSION ${plan.name}`;
  const body: Record<string, unknown> = {
    reason,
    external_reference: plan.lookup_key,
    auto_recurring: {
      frequency,
      frequency_type: "months",
      transaction_amount: Math.round(plan.amount_cents) / 100,
      currency_id: (plan.currency || "brl").toUpperCase(),
    },
    status: "active",
  };
  if (backUrl && backUrl.startsWith("https://")) {
    body.back_url = backUrl;
  }

  const created = await mpFetch(`/preapproval_plan`, {
    method: "POST",
    accessToken,
    body: JSON.stringify(body),
  });
  return { id: created.id as string, created: true };
}
