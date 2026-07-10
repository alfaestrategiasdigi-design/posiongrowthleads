// Shared Kommo API helpers: token refresh, rate-limited fetch, pagination.
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export interface KommoConnection {
  id: string;
  tenant_id: string;
  subdomain: string;
  client_id: string;
  client_secret: string;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
}

export function kommoRedirectUri(): string {
  return `${SUPABASE_URL}/functions/v1/kommo-oauth-callback`;
}

export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

async function refreshIfNeeded(conn: KommoConnection): Promise<KommoConnection> {
  if (!conn.access_token || !conn.refresh_token) {
    throw new Error("Kommo não conectado");
  }
  const exp = conn.expires_at ? new Date(conn.expires_at).getTime() : 0;
  if (exp - Date.now() > 60_000) return conn;

  const r = await fetch(`https://${conn.subdomain}.kommo.com/oauth2/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: conn.client_id,
      client_secret: conn.client_secret,
      grant_type: "refresh_token",
      refresh_token: conn.refresh_token,
      redirect_uri: kommoRedirectUri(),
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Kommo refresh falhou: ${JSON.stringify(j)}`);
  const admin = adminClient();
  const expiresAt = new Date(Date.now() + (j.expires_in ?? 86400) * 1000).toISOString();
  await admin.from("kommo_connections").update({
    access_token: j.access_token,
    refresh_token: j.refresh_token ?? conn.refresh_token,
    expires_at: expiresAt,
    status: "connected",
  }).eq("id", conn.id);
  return { ...conn, access_token: j.access_token, refresh_token: j.refresh_token ?? conn.refresh_token, expires_at: expiresAt };
}

export async function kommoFetch(conn: KommoConnection, path: string, init: RequestInit = {}): Promise<any> {
  const fresh = await refreshIfNeeded(conn);
  const url = `https://${fresh.subdomain}.kommo.com${path}`;
  let lastErr: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${fresh.access_token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (r.status === 204) return null;
    if (r.status === 429 || r.status >= 500) {
      lastErr = { status: r.status, body: await r.text() };
      await new Promise((res) => setTimeout(res, 500 * Math.pow(2, attempt)));
      continue;
    }
    if (!r.ok) {
      throw new Error(`Kommo ${path} → ${r.status}: ${await r.text()}`);
    }
    return r.json();
  }
  throw new Error(`Kommo ${path} falhou após 3 tentativas: ${JSON.stringify(lastErr)}`);
}

export function normalizePhone(raw: unknown): string | null {
  if (!raw) return null;
  const d = String(raw).replace(/\D/g, "");
  if (d.length < 8) return null;
  return d.slice(-11);
}

export async function loadConnection(tenantId: string): Promise<KommoConnection | null> {
  const admin = adminClient();
  const { data } = await admin.from("kommo_connections").select("*").eq("tenant_id", tenantId).maybeSingle();
  return (data as KommoConnection) ?? null;
}

export async function updateStats(connId: string, patch: Record<string, unknown>) {
  const admin = adminClient();
  const { data: cur } = await admin.from("kommo_connections").select("last_import_stats").eq("id", connId).maybeSingle();
  const stats = { ...(cur?.last_import_stats ?? {}), ...patch, updated_at: new Date().toISOString() };
  await admin.from("kommo_connections").update({ last_import_stats: stats }).eq("id", connId);
}
