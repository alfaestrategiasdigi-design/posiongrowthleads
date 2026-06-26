// Consulta status da instância Evolution e sincroniza com zapi_connections.
// POST body: { connection_id?, instance_name?, tenant_id? }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: userRes } = await userClient.auth.getUser(token);
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const connection_id = String(body.connection_id ?? "").trim();
  const instance_name = String(body.instance_name ?? "").trim();
  const tenant_id: string | null = body.tenant_id ?? null;
  if (!instance_name && !connection_id) return json({ error: "instance_name ou connection_id obrigatório" }, 400);

  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (tenant_id) {
    const { data: hasTenantAccess } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: tenant_id });
    if (!isAdmin && !hasTenantAccess) return json({ error: "Sem permissão para consultar este cliente" }, 403);
  } else if (!isAdmin) {
    return json({ error: "Somente o admin master pode consultar a instância global" }, 403);
  }

  let connQuery = admin.from("zapi_connections")
    .select("id, instance_url, api_key, instance_name, status")
    .eq("provider", "evolution");
  connQuery = connection_id ? connQuery.eq("id", connection_id) : connQuery.eq("instance_name", instance_name);
  connQuery = tenant_id ? connQuery.eq("tenant_id", tenant_id) : connQuery.is("tenant_id", null);
  const { data: conn } = await connQuery.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) return json({ error: "Instância não encontrada" }, 404);

  const base = normalizeBase(conn.instance_url);
  const baseValidation = validateBaseUrl(base);
  if (baseValidation) {
    await updateConnectionStatus(admin, conn.id, "error");
    return json({ ok: false, error: baseValidation, status: "error", base }, 200);
  }

  const timeoutMs = 8000;
  try {
    const name = conn.instance_name || instance_name;
    const url = `${base}/instance/connectionState/${encodeURIComponent(name)}`;
    const r = await fetch(url, { headers: { apikey: conn.api_key }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    let j: any = {};
    try { j = JSON.parse(text); } catch { j = { raw: text }; }
    if (!r.ok) {
      await updateConnectionStatus(admin, conn.id, "error");
      return json({ ok: false, error: "Evolution respondeu erro", status: "error", http_status: r.status, url, detail: j }, 200);
    }
    const state = j?.instance?.state ?? j?.state ?? "unknown";
    const status = state === "open" ? "connected" : (state === "connecting" ? "connecting" : "disconnected");
    await updateConnectionStatus(admin, conn.id, status);
    return json({ ok: true, state, status });
  } catch (e) {
    const errName = (e as any)?.name;
    const isTimeout = errName === "TimeoutError" || errName === "AbortError";
    await updateConnectionStatus(admin, conn.id, isTimeout ? "disconnected" : "error");
    return json({
      ok: false,
      error: isTimeout ? "Evolution não respondeu em 8s" : "Erro de rede ao contatar Evolution",
      status: isTimeout ? "disconnected" : "error",
      detail: String(e),
      base,
    }, 200);
  }
});

function normalizeBase(raw: string): string {
  let s = (raw ?? "").trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try { const u = new URL(s); return `${u.protocol}//${u.host}`; }
  catch { return s.replace(/\/+$/, ""); }
}

function validateBaseUrl(base: string): string | null {
  if (!base) return "URL da Evolution não configurada";
  try {
    const u = new URL(base);
    if (!/^https?:$/.test(u.protocol)) return "URL da Evolution precisa começar com http:// ou https://";
    if (!u.hostname) return "URL da Evolution inválida";
    if (u.pathname && u.pathname !== "/") return "Use apenas a URL base da Evolution, sem caminho do Manager";
    return null;
  } catch {
    return "URL da Evolution inválida";
  }
}

async function updateConnectionStatus(admin: any, id: string, status: string) {
  await admin.from("zapi_connections")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
