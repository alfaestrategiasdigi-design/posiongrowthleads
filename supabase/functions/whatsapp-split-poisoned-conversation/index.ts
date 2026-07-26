// Splits a poisoned conversation: for each outbound message currently attached
// to `conversation_id`, asks the Evolution API (chat/findMessages by wamid) for
// the REAL `key.remoteJid`, then moves the message to the correct conversation
// (creating it if missing). Inbound messages are left untouched.
//
// POST body:
//   { conversation_id: uuid, tenant_id?: uuid, dry_run?: boolean,
//     limit?: number (default 500, max 2000),
//     internal_token?: string }  ← alternative to Bearer auth (cron/service)
//
// Auth: Bearer JWT (admin or tenant with access), service bearer, or the
// backend dispatch token. Secrets are never accepted in the request body.
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

function normalizeBase(raw: string): string {
  let s = (raw || "").trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try { const u = new URL(s); return `${u.protocol}//${u.host}`; }
  catch { return s.replace(/\/+$/, ""); }
}

const onlyDigits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const isPlausiblePhoneDigits = (d: string) => d.length >= 10 && d.length <= 15 && !d.startsWith("0");

function normalizePhoneJid(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (s.includes("@lid")) return null;
  const digits = onlyDigits(s);
  if (!isPlausiblePhoneDigits(digits)) return null;
  return `${digits}@s.whatsapp.net`;
}

function normalizeLidJid(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s.includes("@lid")) return null;
  const digits = onlyDigits(s.split("@")[0]);
  if (!digits) return null;
  return `${digits}@lid`;
}

// Returns any usable recipient JID (phone preferred, LID acceptable) that is
// NOT one of our own JIDs. This lets us split a poisoned sink into one
// provisional per LID even when Evolution has no phone mapping.
function extractRecipientJid(m: any, ownJids: Set<string>): string | null {
  const candidates = [
    m?.key?.remoteJid, m?.remoteJid,
    m?.key?.remoteJidAlt, m?.key?.participantAlt,
    m?.key?.senderPn, m?.key?.participantPn,
    m?.key?.recipientJid, m?.key?.to, m?.key?.chatId,
  ];
  for (const c of candidates) {
    const jid = normalizePhoneJid(c);
    if (jid && !ownJids.has(jid)) return jid;
  }
  for (const c of candidates) {
    const jid = normalizeLidJid(c);
    if (jid && !ownJids.has(jid)) return jid;
  }
  return null;
}

async function findMessageRecipient(
  base: string, apiKey: string, instanceName: string, wamid: string, ownJids: Set<string>,
): Promise<string | null> {
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
        signal: AbortSignal.timeout(8_000),
      });
      if (!r.ok) continue;
      const j: any = await r.json().catch(() => null);
      const arr = Array.isArray(j) ? j
        : Array.isArray(j?.messages?.records) ? j.messages.records
        : Array.isArray(j?.records) ? j.records
        : Array.isArray(j?.data) ? j.data
        : null;
      if (!arr || arr.length === 0) continue;
      const hit = arr.find((x: any) => (x?.key?.id ?? x?.id) === wamid) ?? arr[0];
      const jid = extractRecipientJid(hit, ownJids);
      if (jid) return jid;
    } catch { /* try next shape */ }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const conversationId: string | null = body?.conversation_id ?? null;
  const tenantFilter: string | null = body?.tenant_id ?? null;
  const dryRun: boolean = Boolean(body?.dry_run);
  const limit = Math.max(1, Math.min(Number(body?.limit ?? 500), 2000));
  if (!conversationId) return json({ error: "conversation_id obrigatório" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Auth
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  const cronToken = req.headers.get("x-cron-token") ?? "";
  const { data: internalConfig } = await admin.from("edge_internal_config")
    .select("dispatch_token").eq("id", 1).maybeSingle();
  const dispatchToken = String(internalConfig?.dispatch_token ?? "");
  const internalAuthorized = bearer === SERVICE_KEY
    || Boolean(dispatchToken && (bearer === dispatchToken || cronToken === dispatchToken));
  if (!internalAuthorized) {
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    const userId = userRes?.user?.id ?? null;
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (!isAdmin) {
      // must have access to the conversation's tenant
      const { data: conv } = await admin.from("conversations").select("tenant_id").eq("id", conversationId).maybeSingle();
      if (!conv?.tenant_id) return json({ error: "Somente admin master pode operar em conversas globais" }, 403);
      const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: conv.tenant_id });
      if (!allowed) return json({ error: "Sem acesso a este tenant" }, 403);
    }
  }

  // Load source conversation
  const { data: source, error: srcErr } = await admin.from("conversations")
    .select("id, tenant_id, remote_jid, telefone")
    .eq("id", conversationId)
    .maybeSingle();
  if (srcErr || !source) return json({ error: "Conversa não encontrada", detail: srcErr?.message }, 404);
  const tenantId = tenantFilter ?? source.tenant_id ?? null;

  // Resolve Evolution connection (tenant scope preferred)
  let connQ = admin.from("zapi_connections")
    .select("id, tenant_id, instance_url, api_key, instance_name")
    .eq("provider", "evolution");
  connQ = tenantId ? connQ.eq("tenant_id", tenantId) : connQ.is("tenant_id", null);
  const { data: conn } = await connQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) return json({ error: "Nenhuma conexão Evolution para o tenant" }, 400);

  // Own JIDs (avoid mapping to sender's own number)
  const ownJids = new Set<string>();
  {
    const { data: instRow } = await admin.from("tenant_whatsapp_numbers")
      .select("phone_jid, verified_owner_jid").eq("tenant_id", tenantId ?? "");
    for (const r of instRow ?? []) {
      const a = normalizePhoneJid(r.phone_jid); if (a) ownJids.add(a);
      const b = normalizePhoneJid(r.verified_owner_jid); if (b) ownJids.add(b);
    }
  }
  const sourceJid = normalizePhoneJid(source.remote_jid ?? source.telefone);
  if (sourceJid) ownJids.add(sourceJid); // protect against loops

  // Pull outbound messages to split
  const { data: msgs, error: msgErr } = await admin.from("messages")
    .select("id, wamid, direction, created_at")
    .eq("conversation_id", conversationId)
    .eq("direction", "outbound")
    .not("wamid", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (msgErr) return json({ error: "Falha lendo mensagens", detail: msgErr.message }, 500);

  const stats = {
    conversation_id: conversationId,
    tenant_id: tenantId,
    scanned: msgs?.length ?? 0,
    moved: 0,
    kept: 0,
    unresolved: 0,
    conversations_created: 0,
    moves: [] as Array<{ wamid: string; toJid: string; toConvId: string; created: boolean }>,
    unresolved_wamids: [] as string[],
    dry_run: dryRun,
  };

  // Cache: target conversation per JID (avoid dozens of upserts to the same one)
  const targetCache = new Map<string, string>();

  async function getOrCreateTargetConversation(recipientJid: string): Promise<{ id: string; created: boolean } | null> {
    const cached = targetCache.get(recipientJid);
    if (cached) return { id: cached, created: false };
    const isLid = recipientJid.includes("@lid");
    const phone = isLid ? "" : onlyDigits(recipientJid.split("@")[0]);
    // Try by remote_jid
    let q = admin.from("conversations").select("id").eq("remote_jid", recipientJid);
    q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
    const { data: hit } = await q.limit(1).maybeSingle();
    if (hit?.id) { targetCache.set(recipientJid, hit.id); return { id: hit.id, created: false }; }
    if (!isLid) {
      let byPhoneQ = admin.from("conversations").select("id").eq("telefone", phone);
      byPhoneQ = tenantId ? byPhoneQ.eq("tenant_id", tenantId) : byPhoneQ.is("tenant_id", null);
      const { data: byPhone } = await byPhoneQ.limit(1).maybeSingle();
      if (byPhone?.id) { targetCache.set(recipientJid, byPhone.id); return { id: byPhone.id, created: false }; }
    }
    if (dryRun) { targetCache.set(recipientJid, "(new)"); return { id: "(new)", created: true }; }
    const insertPayload: Record<string, unknown> = {
      tenant_id: tenantId,
      remote_jid: recipientJid,
      telefone: phone || onlyDigits(recipientJid.split("@")[0]),
      nome_contato: isLid ? "Contato não identificado" : phone,
      provider: "evolution",
      ultima_interacao: new Date().toISOString(),
    };
    if (isLid) {
      insertPayload.needs_lid_review = true;
      insertPayload.lid_review_notes = "Criada por whatsapp-split-poisoned-conversation. Aguardando resolução de LID → telefone.";
    }
    const { data: created, error: cErr } = await admin.from("conversations")
      .insert(insertPayload)
      .select("id")
      .single();
    if (cErr || !created) return null;
    targetCache.set(recipientJid, created.id);
    return { id: created.id, created: true };
  }

  for (const m of msgs ?? []) {
    const wamid = m.wamid as string;
    const recipient = await findMessageRecipient(conn.instance_url, conn.api_key, conn.instance_name, wamid, ownJids);
    if (!recipient) { stats.unresolved += 1; stats.unresolved_wamids.push(wamid); continue; }
    if (sourceJid && recipient === sourceJid) { stats.kept += 1; continue; }
    const target = await getOrCreateTargetConversation(recipient);
    if (!target) { stats.unresolved += 1; stats.unresolved_wamids.push(wamid); continue; }
    if (target.created) stats.conversations_created += 1;
    if (!dryRun && target.id !== "(new)") {
      await admin.from("messages").update({ conversation_id: target.id }).eq("id", m.id);
      await admin.from("message_reactions").update({ conversation_id: target.id }).eq("message_id", m.id);
      // Bump target activity
      await admin.from("conversations").update({ ultima_interacao: new Date().toISOString() }).eq("id", target.id);
    }
    stats.moved += 1;
    stats.moves.push({ wamid, toJid: recipient, toConvId: target.id, created: target.created });
  }

  // Trim overly large arrays before returning
  if (stats.moves.length > 50) stats.moves = stats.moves.slice(0, 50);
  if (stats.unresolved_wamids.length > 50) stats.unresolved_wamids = stats.unresolved_wamids.slice(0, 50);

  return json({ ok: true, ...stats });
});
