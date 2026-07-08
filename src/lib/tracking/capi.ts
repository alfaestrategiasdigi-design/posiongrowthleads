// Meta CAPI client helper. Handles visitor_id, fbp/fbc cookies, dedup event_id,
// and browser Pixel `fbq` calls kept in sync with server-side CAPI.

const VISITOR_KEY = "posion_visitor_id";
const PROJECT_ID = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID as string | undefined;
const FUNCTIONS_URL = PROJECT_ID
  ? `https://${PROJECT_ID}.supabase.co/functions/v1/capi-client-event`
  : "";

declare global {
  interface Window { fbq?: (...args: any[]) => void }
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name.replace(/[-.]/g, "\\$&") + "=([^;]*)"));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string, days = 90) {
  if (typeof document === "undefined") return;
  const exp = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${exp}; path=/; SameSite=Lax`;
}

export function getVisitorId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(VISITOR_KEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    localStorage.setItem(VISITOR_KEY, id);
  }
  return id;
}

/** Reads _fbp and _fbc, synthesizing _fbc from ?fbclid= when missing. */
export function getFbCookies(): { fbp: string | null; fbc: string | null } {
  if (typeof window === "undefined") return { fbp: null, fbc: null };
  let fbp = readCookie("_fbp");
  let fbc = readCookie("_fbc");
  if (!fbc) {
    const url = new URL(window.location.href);
    const fbclid = url.searchParams.get("fbclid");
    if (fbclid) {
      fbc = `fb.1.${Date.now()}.${fbclid}`;
      writeCookie("_fbc", fbc);
    }
  }
  return { fbp, fbc };
}

interface TrackOptions {
  tenantSlug?: string;
  tenantId?: string;
  contentName?: string;
}

async function post(eventName: "ViewContent" | "InitiateCheckout", eventKey: string, opts: TrackOptions) {
  if (!FUNCTIONS_URL) return;
  const visitor_id = getVisitorId();
  const { fbp, fbc } = getFbCookies();
  const event_source_url = typeof window !== "undefined" ? window.location.href : undefined;
  const path = typeof window !== "undefined" ? window.location.pathname : "/";
  const scope = opts.tenantId ?? opts.tenantSlug ?? "public";
  const event_id = `${eventKey}:${scope}:${visitor_id}:${path}`;

  // Browser Pixel with matching eventID → Meta dedupes with the server call
  try {
    window.fbq?.("track", eventName, { content_name: opts.contentName }, { eventID: event_id });
  } catch { /* noop */ }

  try {
    await fetch(FUNCTIONS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: eventName,
        event_id,
        tenant_id: opts.tenantId,
        tenant_slug: opts.tenantSlug,
        visitor_id,
        fbp, fbc,
        event_source_url,
        content_name: opts.contentName,
      }),
      keepalive: true,
    });
  } catch { /* fire-and-forget */ }
}

const viewsSent = new Set<string>();
const startsSent = new Set<string>();

export function trackView(opts: TrackOptions = {}) {
  const key = `${opts.tenantId ?? opts.tenantSlug ?? "public"}:${typeof window !== "undefined" ? window.location.pathname : "/"}`;
  if (viewsSent.has(key)) return;
  viewsSent.add(key);
  post("ViewContent", "view", opts);
}

export function trackFormStart(opts: TrackOptions = {}) {
  const key = `${opts.tenantId ?? opts.tenantSlug ?? "public"}`;
  if (startsSent.has(key)) return;
  startsSent.add(key);
  post("InitiateCheckout", "form_start", opts);
}

/** Attributes to include when creating a lead so the server-side Lead event
 *  can be deduped with the browser Pixel Lead fired at the same moment. */
export function leadAttribution() {
  const visitor_id = getVisitorId();
  const { fbp, fbc } = getFbCookies();
  return { visitor_id, meta_fbp: fbp, meta_fbc: fbc };
}
