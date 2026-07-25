// Reaplica a subscrição de eventos do webhook para instâncias Evolution já criadas.
// Sempre verifica o estado final via GET /webhook/find e só marca ok=true quando
// a URL, o secret, `webhookByEvents=false` e a lista de eventos batem com o
// canônico. Loop de auto-heal (até 3 tentativas por instância) dentro do shared.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildWebhookUrl,
  configureWebhook,
  ensureWebhookSecret,
  normalizeBase as sharedNormalizeBase,
} from "../_shared/evolution-webhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

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
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const connectionId: string | null = body?.connection_id ?? null;
  const tenantIdFilter: string | null = body?.tenant_id ?? null;

  let q = admin.from("zapi_connections")
    .select("id, tenant_id, instance_url, api_key, instance_name, webhook_secret")
    .eq("provider", "evolution");
  if (connectionId) q = q.eq("id", connectionId);
  else if (tenantIdFilter) q = q.eq("tenant_id", tenantIdFilter);

  const { data: connections, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];
  for (const conn of connections ?? []) {
    if (!isAdmin && conn.tenant_id) {
      const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: conn.tenant_id });
      if (!allowed) { results.push({ id: conn.id, ok: false, skipped: "no_access" }); continue; }
    } else if (!isAdmin && !conn.tenant_id) {
      results.push({ id: conn.id, ok: false, skipped: "master_admin_only" }); continue;
    }
    if (!conn.instance_url || !conn.api_key || !conn.instance_name) {
      results.push({ id: conn.id, ok: false, skipped: "incomplete_config" }); continue;
    }

    const base = sharedNormalizeBase(conn.instance_url);
    const slugPart = conn.tenant_id
      ? (await admin.from("tenants").select("slug").eq("id", conn.tenant_id).maybeSingle()).data?.slug
      : null;
    const secret = await ensureWebhookSecret(admin, conn.id, conn.webhook_secret);
    const expected = { supabaseUrl: SUPABASE_URL, tenantSlug: slugPart, tenantId: conn.tenant_id, secret };
    const webhookUrl = buildWebhookUrl(expected);

    const res = await configureWebhook(base, conn.api_key, conn.instance_name, webhookUrl, expected);

    // Só marca ok e persiste no DB quando o estado final foi provado correto.
    if (res.ok) {
      await admin.from("zapi_connections")
        .update({ webhook_url: webhookUrl, updated_at: new Date().toISOString() })
        .eq("id", conn.id);
    }

    results.push({
      id: conn.id,
      instance: conn.instance_name,
      tenant_id: conn.tenant_id,
      ok: res.ok,
      webhook_url: webhookUrl,
      verified: res.verified
        ? {
            ok: res.verified.ok,
            live_url: res.verified.url,
            webhookByEvents: res.verified.webhookByEvents,
            extras: res.verified.extras,
            missing: res.verified.missing,
            reasons: res.verified.reasons,
          }
        : null,
      debug: res.debug,
    });
  }

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.ok === true).length,
    failed: results.filter((r) => r.ok === false).length,
  };
  return json({ ok: true, summary, count: results.length, results });
});
