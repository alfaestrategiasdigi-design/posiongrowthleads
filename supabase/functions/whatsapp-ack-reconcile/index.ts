// Fallback de reconciliação de ACKs: para mensagens outbound que já têm wamid
// mas permanecem em `status='sent'` por mais de N minutos, consulta a Evolution
// pelo estado atual e faz UPDATE (nunca INSERT) na linha existente.
//
// Nunca altera `direction`. Aceita mensagens enviadas pelo painel
// (evolution-send) ou por outro dispositivo (echo de webhook messages.upsert).
//
// POST body:
//   { tenant_id?: uuid|null, dry_run?: boolean,
//     older_than_minutes?: number (default 3, min 1, max 120),
//     limit?: number (default 200, max 1000),
//     internal_token?: string }  ← alternativa ao Bearer auth (cron/service)
//
// Auth: Bearer JWT (admin ou tenant com acesso) OU internal_token=SERVICE_KEY.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const statusRank: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };

function normalizeBase(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try { const u = new URL(s); return `${u.protocol}//${u.host}`; }
  catch { return s.replace(/\/+$/, ""); }
}

// Baileys/Evolution status → nosso enum (sent/delivered/read).
function mapEvolutionStatus(raw: unknown): "sent" | "delivered" | "read" | "failed" | null {
  if (raw == null) return null;
  const s = String(raw).toUpperCase();
  if (s === "READ" || s === "PLAYED" || s === "3" || s === "4") return "read";
  if (s === "DELIVERY_ACK" || s === "DELIVERED" || s === "2") return "delivered";
  if (s === "SERVER_ACK" || s === "SENT" || s === "1") return "sent";
  if (s === "PENDING" || s === "0") return "sent";
  if (s === "ERROR" || s === "FAILED") return "failed";
  return null;
}

async function findMessageStatus(
  base: string, apiKey: string, instanceName: string, wamid: string,
): Promise<"sent" | "delivered" | "read" | "failed" | null> {
  const url = `${normalizeBase(base)}/chat/findMessages/${encodeURIComponent(instanceName)}`;
  const bodies = [
    { where: { key: { id: wamid } } },
    { where: { id: wamid } },
  ];
  for (const body of bodies) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify(body),
      });
      if (!r.ok) continue;
      const j: any = await r.json().catch(() => null);
      const arr = Array.isArray(j) ? j : Array.isArray(j?.messages?.records) ? j.messages.records
        : Array.isArray(j?.records) ? j.records
        : Array.isArray(j?.data) ? j.data
        : null;
      if (!arr || arr.length === 0) continue;
      const m = arr.find((x: any) => (x?.key?.id ?? x?.id) === wamid) ?? arr[0];
      const raw = m?.status ?? m?.messageStatus ?? m?.ack ?? m?.receipt?.status;
      const mapped = mapEvolutionStatus(raw);
      if (mapped) return mapped;
    } catch { /* try next shape */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const internalToken: string | null = body?.internal_token ?? null;
  const tenantFilter: string | null = body?.tenant_id ?? null;
  const dryRun: boolean = Boolean(body?.dry_run);
  const olderThanMinutes = Math.max(1, Math.min(Number(body?.older_than_minutes ?? 3), 120));
  const limit = Math.max(1, Math.min(Number(body?.limit ?? 200), 1000));

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth: internal token (cron) OR Bearer JWT.
  let isService = false;
  let userId: string | null = null;
  if (internalToken && internalToken === SERVICE_KEY) {
    isService = true;
  } else {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    userId = userRes?.user?.id ?? null;
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (tenantFilter && !isAdmin) {
      const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: tenantFilter });
      if (!allowed) return json({ error: "Sem acesso a este tenant" }, 403);
    }
    if (!tenantFilter && !isAdmin) return json({ error: "Somente admin master pode rodar em todos os tenants" }, 403);
  }

  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const floor = new Date(Date.now() - 48 * 60 * 60_000).toISOString(); // não olha além de 48h

  let q = admin.from("messages")
    .select("id, tenant_id, wamid, status, created_at")
    .eq("direction", "outbound")
    .eq("status", "sent")
    .not("wamid", "is", null)
    .gte("created_at", floor)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (tenantFilter) q = q.eq("tenant_id", tenantFilter);
  const { data: stuck, error } = await q;
  if (error) return json({ error: error.message }, 500);

  // Cache de conexões por tenant.
  const connCache = new Map<string, { instance_url: string; api_key: string; instance_name: string } | null>();
  async function getConn(tid: string | null) {
    const key = tid ?? "__master__";
    if (connCache.has(key)) return connCache.get(key)!;
    let cq = admin.from("zapi_connections")
      .select("instance_url, api_key, instance_name")
      .eq("provider", "evolution");
    cq = tid ? cq.eq("tenant_id", tid) : cq.is("tenant_id", null);
    const { data } = await cq.order("updated_at", { ascending: false }).limit(1).maybeSingle();
    connCache.set(key, data ?? null);
    return data ?? null;
  }

  const stats = { scanned: stuck?.length ?? 0, checked: 0, updated: 0, unchanged: 0, no_conn: 0, no_data: 0 };
  const details: any[] = [];

  for (const m of stuck ?? []) {
    const conn = await getConn(m.tenant_id ?? null);
    if (!conn?.instance_url || !conn?.api_key || !conn?.instance_name) { stats.no_conn++; continue; }
    stats.checked++;
    const evoStatus = await findMessageStatus(conn.instance_url, conn.api_key, conn.instance_name, m.wamid!);
    if (!evoStatus) { stats.no_data++; continue; }
    const curRank = statusRank[m.status ?? "sent"] ?? 1;
    const newRank = statusRank[evoStatus] ?? 0;
    if (newRank <= curRank) { stats.unchanged++; continue; }
    if (!dryRun) {
      // UPDATE-only pelo wamid — jamais INSERT, jamais mexe em `direction`.
      await admin.from("messages").update({ status: evoStatus }).eq("wamid", m.wamid!);
    }
    stats.updated++;
    details.push({ wamid: m.wamid, from: m.status, to: evoStatus });
  }

  return json({ ok: true, dry_run: dryRun, older_than_minutes: olderThanMinutes, service: isService, stats, details });
});
