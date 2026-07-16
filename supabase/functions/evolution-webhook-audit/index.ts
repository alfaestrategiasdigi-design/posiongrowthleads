// Auditoria de webhooks Evolution: para cada zapi_connection ativa, verifica se
// MESSAGES_UPSERT e SEND_MESSAGE estão inscritos e reinscreve se faltar.
// POST body: { connection_id?, tenant_id?, dry_run?: boolean }
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildWebhookUrl, configureWebhook, ensureWebhookSecret, findWebhookEvents, missingRequiredEvents, normalizeBase, validateWebhookUrl } from "../_shared/evolution-webhook.ts";

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
  const dryRun: boolean = Boolean(body?.dry_run);

  let q = admin.from("zapi_connections")
    .select("id, tenant_id, instance_url, api_key, instance_name, webhook_secret, webhook_url")
    .eq("provider", "evolution");
  if (connectionId) q = q.eq("id", connectionId);
  else if (tenantIdFilter) q = q.eq("tenant_id", tenantIdFilter);

  const { data: connections, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results: any[] = [];
  for (const conn of connections ?? []) {
    if (!isAdmin && conn.tenant_id) {
      const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: conn.tenant_id });
      if (!allowed) { results.push({ id: conn.id, instance: conn.instance_name, skipped: "no_access" }); continue; }
    } else if (!isAdmin && !conn.tenant_id) {
      results.push({ id: conn.id, instance: conn.instance_name, skipped: "master_admin_only" }); continue;
    }
    if (!conn.instance_url || !conn.api_key || !conn.instance_name) {
      results.push({ id: conn.id, instance: conn.instance_name, skipped: "incomplete_config" }); continue;
    }

    const base = normalizeBase(conn.instance_url);
    const info = await findWebhookEvents(base, conn.api_key, conn.instance_name);
    const missing = missingRequiredEvents(info.found);

    // Resolve tenant slug + secret (guarantee a secret exists) so we can
    // validate the currently-registered webhook URL carries ?secret=<expected>.
    const slugPart = conn.tenant_id
      ? (await admin.from("tenants").select("slug").eq("id", conn.tenant_id).maybeSingle()).data?.slug
      : null;
    const expectedSecret = await ensureWebhookSecret(admin, conn.id, conn.webhook_secret);
    const expected = { supabaseUrl: SUPABASE_URL, tenantSlug: slugPart, tenantId: conn.tenant_id, secret: expectedSecret };
    const liveCheck = validateWebhookUrl(info.url, expected);
    const dbCheck = validateWebhookUrl(conn.webhook_url, expected);
    const urlInvalid = !liveCheck.ok || !dbCheck.ok;
    const needsFix = missing.length > 0 || urlInvalid;

    let fixed = false;
    let fixDebug: unknown = null;
    if (needsFix && !dryRun) {
      const webhookUrl = buildWebhookUrl(expected);
      const res = await configureWebhook(base, conn.api_key, conn.instance_name, webhookUrl);
      fixed = res.ok;
      fixDebug = res.debug;
      if (res.ok) {
        await admin.from("zapi_connections")
          .update({ webhook_url: webhookUrl, updated_at: new Date().toISOString() })
          .eq("id", conn.id);
      }
    }

    results.push({
      id: conn.id,
      instance: conn.instance_name,
      tenant_id: conn.tenant_id,
      webhook_url: info.url,
      enabled: info.enabled,
      found_events: info.found,
      missing_required: missing,
      url_valid_live: liveCheck.ok,
      url_reason_live: liveCheck.ok ? null : liveCheck.reason,
      url_valid_db: dbCheck.ok,
      url_reason_db: dbCheck.ok ? null : dbCheck.reason,
      needs_fix: needsFix,
      fixed,
      fix_debug: fixDebug,
    });
  }

  const summary = {
    total: results.length,
    healthy: results.filter((r) => r.needs_fix === false).length,
    needed_fix: results.filter((r) => r.needs_fix === true).length,
    fixed: results.filter((r) => r.fixed === true).length,
    url_invalid: results.filter((r) => r.url_valid_live === false || r.url_valid_db === false).length,
  };
  return json({ ok: true, summary, results });
});
