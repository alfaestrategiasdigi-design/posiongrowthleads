// Auditoria completa do WhatsApp por tenant (ou master).
// Retorna checklist de conexão, webhook, eventos, settings, ownerJid,
// contagens de tráfego 7d e últimas mensagens.
// Body: { tenant_id: string | null } — null = master (tenant_id IS NULL)
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildWebhookUrl,
  ensureWebhookSecret,
  findWebhookEvents,
  missingRequiredEvents,
  normalizeBase,
  validateWebhookUrl,
} from "../_shared/evolution-webhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type Check = { ok: boolean | "warn"; label: string; detail?: unknown; hint?: string; fix?: string };

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  try {
    const r = await fetch(url, init);
    const txt = await r.text();
    let body: any = null;
    try { body = JSON.parse(txt); } catch { body = { raw: txt }; }
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: { error: String(e) } };
  }
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
  const tenantId: string | null = body?.tenant_id ?? null;

  // Auth: master requires global admin. Tenant requires admin OR tenant access.
  if (tenantId === null) {
    if (!isAdmin) return json({ error: "Master audit requires admin" }, 403);
  } else {
    if (!isAdmin) {
      const { data: allowed } = await admin.rpc("has_tenant_access", {
        _user_id: userId, _tenant_id: tenantId,
      });
      if (!allowed) return json({ error: "Forbidden" }, 403);
    }
  }

  // Load connection
  const connQ = admin.from("zapi_connections")
    .select("id, tenant_id, instance_url, api_key, instance_name, webhook_secret, webhook_url, status, provider")
    .eq("provider", "evolution");
  const { data: conn } = tenantId
    ? await connQ.eq("tenant_id", tenantId).maybeSingle()
    : await connQ.is("tenant_id", null).maybeSingle();

  const checks: Check[] = [];

  if (!conn) {
    checks.push({ ok: false, label: "Conexão Evolution", hint: "Nenhuma zapi_connection Evolution encontrada", fix: "Conectar em /admin/conexao-whatsapp ou nas configurações do tenant" });
    return json({ ok: false, tenant_id: tenantId, checks });
  }

  if (!conn.instance_url || !conn.api_key || !conn.instance_name) {
    checks.push({ ok: false, label: "Configuração da instância", hint: "instance_url / api_key / instance_name incompletos", fix: "Recriar a conexão" });
    return json({ ok: false, tenant_id: tenantId, conn: { id: conn.id }, checks });
  }

  const base = normalizeBase(conn.instance_url);

  // 1. Instance connection state
  const stateRes = await fetchJson(
    `${base}/instance/connectionState/${encodeURIComponent(conn.instance_name)}`,
    { headers: { apikey: conn.api_key } },
  );
  const state = stateRes.body?.instance?.state ?? stateRes.body?.state ?? "unknown";
  checks.push({
    ok: state === "open",
    label: "Instância conectada",
    detail: { state },
    hint: state === "open" ? undefined : "Instância não está no estado 'open'",
    fix: state === "open" ? undefined : "Reconectar em /admin/conexao-whatsapp (ler QR code novamente)",
  });

  // 2. Webhook events + URL
  const info = await findWebhookEvents(base, conn.api_key, conn.instance_name);
  const missing = missingRequiredEvents(info.found);
  const slug = conn.tenant_id
    ? (await admin.from("tenants").select("slug").eq("id", conn.tenant_id).maybeSingle()).data?.slug
    : null;
  const expectedSecret = await ensureWebhookSecret(admin, conn.id, conn.webhook_secret);
  const expected = { supabaseUrl: SUPABASE_URL, tenantSlug: slug, tenantId: conn.tenant_id, secret: expectedSecret };
  const expectedUrl = buildWebhookUrl(expected);
  const liveCheck = validateWebhookUrl(info.url, expected);

  checks.push({
    ok: missing.length === 0,
    label: "Eventos do webhook",
    detail: { found: info.found, missing },
    hint: missing.length ? `Faltam eventos: ${missing.join(", ")}` : undefined,
    fix: missing.length ? "Clicar em 'Reassinar webhook'" : undefined,
  });
  checks.push({
    ok: liveCheck.ok,
    label: "URL do webhook",
    detail: { registered: info.url, expected: expectedUrl, reason: liveCheck.ok ? null : liveCheck.reason },
    hint: liveCheck.ok ? undefined : `URL registrada divergente (${liveCheck.reason})`,
    fix: liveCheck.ok ? undefined : "Clicar em 'Reassinar webhook'",
  });
  checks.push({
    ok: info.enabled !== false,
    label: "Webhook habilitado",
    detail: { enabled: info.enabled },
    fix: info.enabled === false ? "Reassinar webhook" : undefined,
  });

  // 2b. webhookByEvents flag (from raw webhook/find response)
  const rawWebhook: any = (info as any).raw?.webhook ?? (info as any).raw ?? {};
  const byEvents = Boolean(rawWebhook?.webhookByEvents ?? rawWebhook?.webhook_by_events);
  checks.push({
    ok: !byEvents,
    label: "webhookByEvents = false",
    detail: { webhookByEvents: byEvents },
    hint: byEvents ? "Evolution está postando eventos em rotas separadas — o handler não reconhece" : undefined,
    fix: byEvents ? "Clicar em 'Reassinar webhook' (força webhookByEvents=false)" : undefined,
  });

  // 3. Settings
  const settingsRes = await fetchJson(
    `${base}/settings/find/${encodeURIComponent(conn.instance_name)}`,
    { headers: { apikey: conn.api_key } },
  );
  const s = settingsRes.body?.settings ?? settingsRes.body ?? {};
  const settingsOk = s?.readMessages !== false;
  checks.push({
    ok: settingsOk ? true : "warn",
    label: "Settings da instância",
    detail: {
      syncFullHistory: s?.syncFullHistory,
      readMessages: s?.readMessages,
      alwaysOnline: s?.alwaysOnline,
      readStatus: s?.readStatus,
      groupsIgnore: s?.groupsIgnore,
    },
    hint: settingsOk ? undefined : "readMessages=false pode suprimir SEND_MESSAGE em versões antigas",
    fix: settingsOk ? undefined : "Ativar readMessages e syncFullHistory",
  });

  // 4. OwnerJid vs verified numbers
  const ownerJid = stateRes.body?.instance?.owner ?? stateRes.body?.instance?.wuid ?? null;
  let verifiedNumbers: any[] = [];
  if (conn.tenant_id) {
    const { data } = await admin.from("tenant_whatsapp_numbers")
      .select("phone_e164, verified, phone_jid")
      .eq("tenant_id", conn.tenant_id);
    verifiedNumbers = data ?? [];
  }
  checks.push({
    ok: Boolean(ownerJid),
    label: "OwnerJid da instância",
    detail: { ownerJid, verifiedNumbers },
  });

  // 5. Traffic sample (7 days) — inbound / outbound-panel / outbound-device
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const msgBase = admin.from("messages")
    .select("id, sender, direction, wamid, metadata, created_at", { count: "exact", head: true })
    .gte("created_at", since);

  const inboundQ = tenantId
    ? msgBase.eq("tenant_id", tenantId).eq("direction", "inbound")
    : msgBase.is("tenant_id", null).eq("direction", "inbound");
  const { count: inboundCount } = await inboundQ;

  const outboundBase = admin.from("messages")
    .select("id, metadata", { count: "exact", head: true })
    .gte("created_at", since)
    .eq("direction", "outbound");
  const outQ = tenantId ? outboundBase.eq("tenant_id", tenantId) : outboundBase.is("tenant_id", null);
  const { count: outboundCount } = await outQ;

  // Outbound from other device = direction=outbound AND metadata.raw_key.fromMe=true
  // (approximation: everything outbound not sent by the panel has metadata->>'origin' = 'device')
  const outDeviceBase = admin.from("messages")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    .eq("direction", "outbound")
    .eq("metadata->>origin", "device");
  const outDeviceQ = tenantId
    ? outDeviceBase.eq("tenant_id", tenantId)
    : outDeviceBase.is("tenant_id", null);
  const { count: outboundDeviceCount } = await outDeviceQ;

  const trafficOk = (inboundCount ?? 0) > 0;
  const deviceOk = (outboundDeviceCount ?? 0) > 0;
  checks.push({
    ok: trafficOk ? true : "warn",
    label: "Tráfego inbound (7d)",
    detail: { inbound: inboundCount ?? 0 },
    hint: trafficOk ? undefined : "Nenhuma mensagem recebida em 7 dias",
  });
  checks.push({
    ok: (outboundCount ?? 0) > 0 ? true : "warn",
    label: "Tráfego outbound (7d)",
    detail: { outbound: outboundCount ?? 0, from_device: outboundDeviceCount ?? 0 },
    hint: deviceOk
      ? undefined
      : "Nenhuma mensagem enviada pelo celular físico foi capturada. Se você já enviou do celular, provavelmente o evento SEND_MESSAGE não está sendo entregue.",
    fix: deviceOk ? undefined : "Reassinar webhook e checar 'webhookByEvents = false'",
  });

  // 6. Last 20 messages
  const lastQ = admin.from("messages")
    .select("id, sender, direction, wamid, status, created_at, conteudo, conversation_id")
    .order("created_at", { ascending: false })
    .limit(20);
  const { data: lastMessages } = tenantId
    ? await lastQ.eq("tenant_id", tenantId)
    : await lastQ.is("tenant_id", null);

  const summary = {
    healthy: checks.filter((c) => c.ok === true).length,
    warnings: checks.filter((c) => c.ok === "warn").length,
    failing: checks.filter((c) => c.ok === false).length,
  };

  return json({
    ok: summary.failing === 0,
    tenant_id: tenantId,
    connection: {
      id: conn.id,
      instance_name: conn.instance_name,
      instance_url: conn.instance_url,
      status: conn.status,
    },
    summary,
    checks,
    last_messages: lastMessages ?? [],
  });
});
