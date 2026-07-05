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
