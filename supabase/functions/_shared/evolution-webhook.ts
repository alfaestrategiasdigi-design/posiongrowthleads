// Shared helpers for Evolution API webhook subscription.
// Kept in a single place so evolution-connect, evolution-resubscribe and
// evolution-webhook-audit stay in sync about which events must be subscribed
// AND about the "verified state" they must leave the instance in.

export const CANONICAL_EVENTS = [
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

// Backwards compat alias — kept because a few callers still import this name.
export const EVOLUTION_EVENTS = CANONICAL_EVENTS;

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
 * Removes anything that could contaminate the value used inside the `tenant=`
 * query parameter. See long comment kept from the original implementation.
 */
export function sanitizeTenantSlug(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const cutIdx = s.search(/[\/?#&=\s]/);
  if (cutIdx >= 0) s = s.slice(0, cutIdx);
  return s || null;
}

export function buildWebhookUrl(opts: {
  supabaseUrl: string;
  tenantSlug?: string | null;
  tenantId?: string | null;
  secret: string;
}): string {
  const base = `${opts.supabaseUrl.replace(/\/+$/, "")}/functions/v1/whatsapp-webhook`;
  const cleanSlug = sanitizeTenantSlug(opts.tenantSlug);
  const cleanId = sanitizeTenantSlug(opts.tenantId);
  const parts: string[] = [];
  if (cleanSlug) parts.push(`tenant=${encodeURIComponent(cleanSlug)}`);
  else if (cleanId) parts.push(`tenant_id=${encodeURIComponent(cleanId)}`);
  if (!opts.secret) throw new Error("buildWebhookUrl: missing webhook secret");
  parts.push(`secret=${encodeURIComponent(opts.secret)}`);
  return `${base}?${parts.join("&")}`;
}

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

  const tenantParam = u.searchParams.get("tenant") ?? u.searchParams.get("tenant_id");
  if (tenantParam && /[\/?#=\s]/.test(tenantParam)) {
    return { ok: false, reason: "tenant_param_corrupted" };
  }

  const expectedSlug = sanitizeTenantSlug(expected.tenantSlug);
  const expectedId = sanitizeTenantSlug(expected.tenantId);
  if (expectedSlug) {
    if (u.searchParams.get("tenant") !== expectedSlug) return { ok: false, reason: "tenant_slug_mismatch" };
  } else if (expectedId) {
    const t = u.searchParams.get("tenant") || u.searchParams.get("tenant_id");
    if (t !== expectedId) return { ok: false, reason: "tenant_id_mismatch" };
  }
  return { ok: true };
}

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

// ---------------------------------------------------------------------------
// Low-level POST /webhook/set — tries several payload shapes accepted by
// different Evolution versions. Does NOT verify the resulting state.
// ---------------------------------------------------------------------------
async function postWebhookSet(
  base: string,
  apiKey: string,
  instanceName: string,
  webhookUrl: string,
): Promise<{ ok: boolean; debug: unknown[] }> {
  const b = normalizeBase(base);
  const attempts = [
    { name: "v2_wrapped_full", body: { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, byEvents: false, base64: true, events: CANONICAL_EVENTS } } },
    { name: "v1_flat_full",    body: { enabled: true, url: webhookUrl, webhookByEvents: false, webhook_by_events: false, byEvents: false, events: CANONICAL_EVENTS } },
    { name: "v2_wrapped_min",  body: { webhook: { enabled: true, url: webhookUrl, webhookByEvents: false, events: CANONICAL_EVENTS } } },
    { name: "v1_flat_min",     body: { enabled: true, url: webhookUrl, webhookByEvents: false, events: CANONICAL_EVENTS } },
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
  return { ok, debug };
}

async function pushGoodSettings(base: string, apiKey: string, instanceName: string) {
  const b = normalizeBase(base);
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
}

// ---------------------------------------------------------------------------
// GET /webhook/find — reads the persisted state (URL, byEvents, events).
// ---------------------------------------------------------------------------
export interface WebhookFindInfo {
  found: string[];
  url: string | null;
  enabled: boolean | null;
  webhookByEvents: boolean | null;
  raw: unknown;
}

export async function findWebhookState(
  base: string,
  apiKey: string,
  instanceName: string,
): Promise<WebhookFindInfo> {
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
    const byEvents = source?.webhookByEvents ?? source?.webhook_by_events ?? source?.byEvents ?? null;
    return {
      found: events.map((e) => String(e).toUpperCase()),
      url: source?.url ?? null,
      enabled: source?.enabled ?? null,
      webhookByEvents: typeof byEvents === "boolean" ? byEvents : null,
      raw: j,
    };
  } catch (e) {
    return { found: [], url: null, enabled: null, webhookByEvents: null, raw: { error: String(e) } };
  }
}

// Kept for backwards compatibility with old imports.
export const findWebhookEvents = findWebhookState;

export function missingRequiredEvents(found: string[]): string[] {
  const set = new Set(found.map((e) => e.toUpperCase()));
  return REQUIRED_EVENTS.filter((e) => !set.has(e));
}

export interface VerifyResult {
  ok: boolean;
  url: string | null;
  webhookByEvents: boolean | null;
  events: string[];
  extras: string[];       // events subscribed but NOT in canonical list
  missing: string[];      // required events NOT subscribed
  reasons: string[];      // human-readable list of what's wrong
}

/**
 * Reads the live webhook state and validates it against the canonical
 * expectations for this tenant: exact URL, webhookByEvents === false,
 * and events == CANONICAL_EVENTS (no extras, no missing).
 */
export async function verifyWebhookState(
  base: string,
  apiKey: string,
  instanceName: string,
  expected: { supabaseUrl: string; tenantSlug?: string | null; tenantId?: string | null; secret: string },
): Promise<VerifyResult> {
  const info = await findWebhookState(base, apiKey, instanceName);
  const canonical = new Set(CANONICAL_EVENTS as readonly string[]);
  const foundSet = new Set(info.found);
  const extras = [...foundSet].filter((e) => !canonical.has(e)).sort();
  const missing = [...canonical].filter((e) => !foundSet.has(e)).sort();

  const reasons: string[] = [];
  const urlCheck = validateWebhookUrl(info.url, expected);
  if (!urlCheck.ok) reasons.push(`url_${urlCheck.reason}`);
  if (info.webhookByEvents === true) reasons.push("webhook_by_events_true");
  if (extras.length > 0) reasons.push(`extras:${extras.join(",")}`);
  if (missing.length > 0) reasons.push(`missing:${missing.join(",")}`);

  return {
    ok: reasons.length === 0,
    url: info.url,
    webhookByEvents: info.webhookByEvents,
    events: info.found,
    extras,
    missing,
    reasons,
  };
}

/**
 * Full "make it correct" routine: POST /webhook/set (trying multiple payload
 * shapes) then GET /webhook/find and compare. Retries up to `maxAttempts`
 * times when the persisted state still diverges from CANONICAL_EVENTS or
 * still reports webhookByEvents=true (some Evolution builds silently ignore
 * the flag on the first write).
 */
export async function configureWebhook(
  base: string,
  apiKey: string,
  instanceName: string,
  webhookUrl: string,
  expected?: { supabaseUrl: string; tenantSlug?: string | null; tenantId?: string | null; secret: string },
  maxAttempts = 3,
): Promise<{ ok: boolean; verified: VerifyResult | null; debug: unknown[] }> {
  const debug: unknown[] = [];
  let verified: VerifyResult | null = null;
  let ok = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const setRes = await postWebhookSet(base, apiKey, instanceName, webhookUrl);
    debug.push({ attempt, phase: "set", ok: setRes.ok, tries: setRes.debug });

    if (!expected) {
      // Legacy callers that don't want verification: exit on first success.
      ok = setRes.ok;
      break;
    }

    verified = await verifyWebhookState(base, apiKey, instanceName, expected);
    debug.push({ attempt, phase: "verify", ok: verified.ok, reasons: verified.reasons });
    if (verified.ok) { ok = true; break; }
  }

  await pushGoodSettings(base, apiKey, instanceName);
  return { ok, verified, debug };
}
