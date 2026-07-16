// Shared helpers for Evolution API webhook subscription.
// Kept in a single place so evolution-connect, evolution-resubscribe and
// evolution-webhook-audit stay in sync about which events must be subscribed.

export const EVOLUTION_EVENTS = [
  "MESSAGES_UPSERT",
  "MESSAGES_SET",
  "MESSAGES_UPDATE",
  "MESSAGES_DELETE",
  "MESSAGES_EDITED",
  "SEND_MESSAGE",
  "SEND_MESSAGE_UPDATE",
  "CONTACTS_UPDATE",
  "CONTACTS_UPSERT",
  "CHATS_UPSERT",
  "CHATS_UPDATE",
  "CHATS_DELETE",
  "PRESENCE_UPDATE",
  "CONNECTION_UPDATE",
] as const;

// Events considered "must have" for direct-phone sync of outbound messages.
export const REQUIRED_EVENTS = ["MESSAGES_UPSERT", "MESSAGES_SET", "SEND_MESSAGE"] as const;

export function normalizeBase(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

/**
 * Builds the canonical webhook URL for a tenant, always including
 * `?tenant=<slug>&secret=<webhook_secret>` (or `tenant_id=` when no slug).
 * The secret MUST come from `zapi_connections.webhook_secret` — the
 * `whatsapp-webhook` function rejects events whose `?secret=` does not
 * match this per-tenant value.
 */
export function buildWebhookUrl(opts: {
  supabaseUrl: string;
  tenantSlug?: string | null;
  tenantId?: string | null;
  secret: string;
}): string {
  const base = `${opts.supabaseUrl.replace(/\/+$/, "")}/functions/v1/whatsapp-webhook`;
  const parts: string[] = [];
  if (opts.tenantSlug) parts.push(`tenant=${encodeURIComponent(opts.tenantSlug)}`);
  else if (opts.tenantId) parts.push(`tenant_id=${encodeURIComponent(opts.tenantId)}`);
  if (!opts.secret) throw new Error("buildWebhookUrl: missing webhook secret");
  parts.push(`secret=${encodeURIComponent(opts.secret)}`);
  return `${base}?${parts.join("&")}`;
}

/**
 * Validates that a webhook URL (as currently registered in Evolution or in
 * `zapi_connections.webhook_url`) points at `whatsapp-webhook` and carries
 * the correct tenant identifier + `?secret=` for this connection.
 * Returns `{ ok: true }` when valid, otherwise a structured reason so the
 * caller can decide to auto-heal (re-subscribe) instead of trusting the URL.
 */
export function validateWebhookUrl(
  actual: string | null | undefined,
  expected: { supabaseUrl: string; tenantSlug?: string | null; tenantId?: string | null; secret: string },
): { ok: true } | { ok: false; reason: string } {
  if (!actual) return { ok: false, reason: "missing_url" };
  let u: URL;
  try { u = new URL(actual); } catch { return { ok: false, reason: "invalid_url" }; }

  const expectedOrigin = new URL(expected.supabaseUrl).origin;
  if (u.origin !== expectedOrigin) return { ok: false, reason: "wrong_origin" };
  if (!u.pathname.endsWith("/functions/v1/whatsapp-webhook")) return { ok: false, reason: "wrong_path" };

  const secret = u.searchParams.get("secret");
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (secret !== expected.secret) return { ok: false, reason: "secret_mismatch" };

  if (expected.tenantSlug) {
    if (u.searchParams.get("tenant") !== expected.tenantSlug) return { ok: false, reason: "tenant_slug_mismatch" };
  } else if (expected.tenantId) {
    const t = u.searchParams.get("tenant") || u.searchParams.get("tenant_id");
    if (t !== expected.tenantId) return { ok: false, reason: "tenant_id_mismatch" };
  }
  return { ok: true };
}

/**
 * Ensures a connection has a `webhook_secret` in the DB; generates one if
 * missing. Returns the secret to use.
 */
export async function ensureWebhookSecret(
  admin: { from: (t: string) => any },
  connectionId: string,
  current: string | null | undefined,
): Promise<string> {
  if (current && current.length > 0) return current;
  const secret = crypto.randomUUID().replace(/-/g, "");
  await admin.from("zapi_connections")
    .update({ webhook_secret: secret, updated_at: new Date().toISOString() })
    .eq("id", connectionId);
  return secret;
}

export async function configureWebhook(
  base: string,
  apiKey: string,
  instanceName: string,
  webhookUrl: string,
): Promise<{ ok: boolean; debug: unknown[] }> {
  const b = normalizeBase(base);
  const attempts = [
    { name: "v2_wrapped_full", body: { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, byEvents: false, base64: true, events: EVOLUTION_EVENTS } } },
    { name: "v2_wrapped_min",  body: { webhook: { enabled: true, url: webhookUrl, events: EVOLUTION_EVENTS } } },
    { name: "v1_flat_full",    body: { enabled: true, url: webhookUrl, webhookByEvents: false, webhook_by_events: false, events: EVOLUTION_EVENTS } },
    { name: "v1_flat_min",     body: { enabled: true, url: webhookUrl, events: EVOLUTION_EVENTS } },
  ];
  const debug: unknown[] = [];
  let ok = false;
  for (const att of attempts) {
    try {
      const r = await fetch(`${b}/webhook/set/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify(att.body),
      });
      const txt = await r.text();
      debug.push({ variant: att.name, status: r.status, body: txt.slice(0, 200) });
      if (r.ok) { ok = true; break; }
    } catch (e) {
      debug.push({ variant: att.name, error: String(e) });
    }
  }
  try {
    await fetch(`${b}/settings/set/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: apiKey },
      body: JSON.stringify({
        syncFullHistory: true, alwaysOnline: true,
        readMessages: true, readStatus: true, rejectCall: false,
      }),
    });
  } catch { /* non-fatal */ }
  return { ok, debug };
}

export async function findWebhookEvents(
  base: string,
  apiKey: string,
  instanceName: string,
): Promise<{ found: string[]; url: string | null; enabled: boolean | null; raw: unknown }> {
  const b = normalizeBase(base);
  try {
    const r = await fetch(`${b}/webhook/find/${encodeURIComponent(instanceName)}`, {
      headers: { apikey: apiKey },
    });
    const txt = await r.text();
    let j: any = null;
    try { j = JSON.parse(txt); } catch { j = { raw: txt }; }
    const source = j?.webhook ?? j ?? {};
    const events: string[] = Array.isArray(source?.events) ? source.events
      : Array.isArray(source?.eventsList) ? source.eventsList
      : [];
    return {
      found: events.map((e) => String(e).toUpperCase()),
      url: source?.url ?? null,
      enabled: source?.enabled ?? null,
      raw: j,
    };
  } catch (e) {
    return { found: [], url: null, enabled: null, raw: { error: String(e) } };
  }
}

export function missingRequiredEvents(found: string[]): string[] {
  const set = new Set(found.map((e) => e.toUpperCase()));
  return REQUIRED_EVENTS.filter((e) => !set.has(e));
}
