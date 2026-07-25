// Import all Evolution API contacts into public.leads for a given tenant (or all tenants).
// POST body: { tenant_id?: string | null, default_status?: string, all_tenants?: boolean }
// - Calls /chat/findContacts/{instance}
// - Dedupes by normalize_phone(whatsapp) within the tenant scope
// - Inserts new leads; updates nome_completo of existing leads only if empty
// - Upserts a row in public.conversations for every imported contact so the
//   Evolution inbox always shows them (fixes orphan leads created by imports).
// - Authorization: user JWT (admin/tenant), service-role key, or the dispatch_token
//   stored in edge_internal_config (used by pg_cron).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function normalizeBase(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try { const u = new URL(s); return `${u.protocol}//${u.host}`; }
  catch { return s.replace(/\/+$/, ""); }
}

// Extract a usable E.164 digits string (10-15) from any candidate field.
function extractPhone(c: any): string | null {
  const cands = [
    c?.pn, c?.phoneNumber, c?.phone_number, c?.phone, c?.wa_id, c?.whatsappNumber, c?.number,
    c?.remoteJid, c?.remoteJidAlt, c?.jid, c?.jidAlt, c?.id,
    c?.key?.remoteJid, c?.key?.remoteJidAlt,
    c?.senderPn,
  ];
  for (const raw of cands) {
    if (!raw) continue;
    const s = String(raw);
    if (s.endsWith("@g.us") || s.endsWith("@broadcast") || s.includes("@lid")) continue;
    const digits = onlyDigits(s.split("@")[0]);
    if (digits.length >= 10 && digits.length <= 15) return digits;
  }
  return null;
}

function extractName(c: any, phone: string): string {
  const cands = [c?.pushName, c?.name, c?.notify, c?.verifiedName, c?.contactName, c?.profileName];
  for (const v of cands) {
    const s = String(v ?? "").trim();
    if (s && !/^\d+$/.test(s)) return s.slice(0, 120);
  }
  if (phone.length === 13 && phone.startsWith("55")) {
    const ddd = phone.slice(2, 4);
    const rest = phone.slice(4);
    return `+55 (${ddd}) ${rest.slice(0, -4)}-${rest.slice(-4)}`;
  }
  return `+${phone}`;
}

let cachedDispatchToken: { value: string; expiresAt: number } | null = null;
async function getDispatchToken(admin: any): Promise<string | null> {
  if (cachedDispatchToken && cachedDispatchToken.expiresAt > Date.now()) return cachedDispatchToken.value;
  const { data } = await admin.from("edge_internal_config").select("dispatch_token").eq("id", 1).maybeSingle();
  const value = (data as any)?.dispatch_token ?? null;
  if (value) cachedDispatchToken = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

interface AuthResult {
  ok: boolean;
  internal: boolean;      // service role / dispatch token / cron
  userId?: string | null;
  isAdmin?: boolean;
  error?: string;
  status?: number;
}

async function authorize(req: Request, admin: any): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronToken = req.headers.get("x-cron-token") ?? req.headers.get("X-Cron-Token");
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const internal = await getDispatchToken(admin);
  if (cronToken && internal && cronToken === internal) return { ok: true, internal: true };
  if (bearer && bearer === SERVICE_KEY) return { ok: true, internal: true };
  if (bearer && internal && bearer === internal) return { ok: true, internal: true };
  if (!bearer) return { ok: false, internal: false, status: 401, error: "Unauthorized" };
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userRes } = await userClient.auth.getUser(bearer);
    const userId = userRes?.user?.id;
    if (!userId) return { ok: false, internal: false, status: 401, error: "Unauthorized" };
    const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    return { ok: true, internal: false, userId, isAdmin: !!isAdmin };
  } catch {
    return { ok: false, internal: false, status: 401, error: "invalid_token" };
  }
}

async function upsertConversationForContact(
  admin: any,
  tenantId: string | null,
  phone: string,
  jid: string | null,
  name: string,
  leadId: string | null,
) {
  const remoteJid = jid && jid.includes("@") ? jid : `${phone}@s.whatsapp.net`;

  // Try find by remote_jid first
  let byJid = admin.from("conversations").select("id, lead_id, nome_contato").eq("remote_jid", remoteJid);
  byJid = tenantId ? byJid.eq("tenant_id", tenantId) : byJid.is("tenant_id", null);
  let existing = await byJid.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();

  // Fallback: by normalized phone
  if (!existing?.data) {
    let byPhone = admin.from("conversations").select("id, lead_id, nome_contato").eq("telefone", phone);
    byPhone = tenantId ? byPhone.eq("tenant_id", tenantId) : byPhone.is("tenant_id", null);
    existing = await byPhone.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
  }

  if (existing?.data) {
    const patch: any = {};
    if (!existing.data.lead_id && leadId) patch.lead_id = leadId;
    if (!existing.data.nome_contato && name) patch.nome_contato = name;
    if (Object.keys(patch).length > 0) {
      await admin.from("conversations").update(patch).eq("id", existing.data.id);
    }
    return { updated: true };
  }

  const insertRes = await admin.from("conversations").insert({
    tenant_id: tenantId,
    telefone: phone,
    remote_jid: remoteJid,
    nome_contato: name,
    provider: "evolution",
    lead_id: leadId,
    ultima_mensagem: "Lead importado da campanha de WhatsApp",
    ultima_interacao: new Date().toISOString(),
  });
  if (insertRes.error) {
    // race: retry find and patch lead_id
    let retryQ = admin.from("conversations").select("id, lead_id").eq("telefone", phone);
    retryQ = tenantId ? retryQ.eq("tenant_id", tenantId) : retryQ.is("tenant_id", null);
    const retry = await retryQ.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
    if (retry.data?.id && leadId && !retry.data.lead_id) {
      await admin.from("conversations").update({ lead_id: leadId, nome_contato: name, remote_jid: remoteJid }).eq("id", retry.data.id);
    }
    return { updated: true };
  }
  return { created: true };
}

async function runForTenant(admin: any, tenantId: string | null, defaultStatus: string) {
  let connQ = admin.from("zapi_connections")
    .select("instance_url, api_key, instance_name")
    .eq("provider", "evolution");
  connQ = tenantId ? connQ.eq("tenant_id", tenantId) : connQ.is("tenant_id", null);
  const { data: conn } = await connQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn?.instance_url || !conn.instance_name || !conn.api_key) {
    return { tenant_id: tenantId, error: "no_instance" };
  }
  const base = normalizeBase(conn.instance_url);
  const url = `${base}/chat/findContacts/${encodeURIComponent(conn.instance_name)}`;

  let contacts: any[] = [];
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.api_key },
      body: JSON.stringify({ where: {} }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { tenant_id: tenantId, error: "findContacts_failed", status: r.status, detail: j };
    contacts = Array.isArray(j) ? j : (j?.contacts || j?.data || []);
  } catch (e) {
    return { tenant_id: tenantId, error: "network", detail: String(e) };
  }

  const byPhone = new Map<string, { phone: string; name: string; jid: string | null }>();
  for (const c of contacts) {
    const phone = extractPhone(c);
    if (!phone) continue;
    if (byPhone.has(phone)) continue;
    const name = extractName(c, phone);
    const jid = c?.remoteJid || c?.jid || c?.id || null;
    byPhone.set(phone, { phone, name, jid: jid ? String(jid) : null });
  }
  const rows = Array.from(byPhone.values());

  const norm = (p: string) => p.replace(/\D/g, "").slice(-11);
  const normalizedTargets = Array.from(new Set(rows.map((r) => norm(r.phone)).filter(Boolean)));

  // Deduplication anti-join in Postgres — avoids the 1000-row PostgREST cap that
  // previously caused the import to see only the first 1000 leads as "existing"
  // and re-insert everything else as duplicates on every cron run.
  const existingByNorm = new Map<string, { id: string; name: string | null }>();
  if (normalizedTargets.length > 0) {
    // The RPC scopes by tenant (NULL means master) and returns at most one
    // row per normalized phone (oldest lead wins), so we never lose the anchor
    // even for tenants with 100k+ leads.
    const { data: existing, error: existErr } = await admin.rpc("leads_existing_by_norm_phone", {
      p_tenant_id: tenantId,
      p_phones: normalizedTargets,
    });
    if (existErr) {
      console.error("leads_existing_by_norm_phone failed", existErr);
      return { tenant_id: tenantId, error: "dedup_lookup_failed", detail: existErr.message };
    }
    for (const e of (existing as any[]) ?? []) {
      if (e?.norm && !existingByNorm.has(e.norm)) {
        existingByNorm.set(e.norm, { id: e.id, name: e.nome_completo ?? null });
      }
    }
  }

  let created = 0, updated = 0, skipped = 0, errors = 0;
  let convsCreated = 0, convsUpdated = 0, convsErrors = 0;

  const toInsert: { row: typeof rows[number]; payload: any }[] = [];
  const toUpdate: { id: string; nome: string; row: typeof rows[number] }[] = [];
  const existingResolved: { leadId: string; row: typeof rows[number] }[] = [];

  for (const r of rows) {
    const n = norm(r.phone);
    const ex = existingByNorm.get(n);
    if (ex) {
      existingResolved.push({ leadId: ex.id, row: r });
      const cur = (ex.name ?? "").trim();
      if (!cur && r.name && !/^\+?\d/.test(r.name)) {
        toUpdate.push({ id: ex.id, nome: r.name, row: r });
      } else {
        skipped++;
      }
      continue;
    }
    toInsert.push({
      row: r,
      payload: {
        nome_completo: r.name,
        whatsapp: r.phone,
        tenant_id: tenantId,
        status: defaultStatus,
        origem: "whatsapp_import",
        extras: { source: "evolution_contacts", jid: r.jid, imported_at: new Date().toISOString() },
      },
    });
  }

  const insertedIds: { leadId: string; row: typeof rows[number] }[] = [];
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { error, data } = await admin.from("leads").insert(chunk.map((c) => c.payload)).select("id");
    if (error) {
      errors += chunk.length;
      console.warn("insert leads chunk failed", error.message);
    } else {
      // Preserve order: PostgREST returns rows in insertion order for the same call.
      (data ?? []).forEach((d: any, idx: number) => {
        insertedIds.push({ leadId: d.id, row: chunk[idx].row });
      });
      created += data?.length ?? 0;
    }
  }

  for (const u of toUpdate) {
    const { error } = await admin.from("leads").update({ nome_completo: u.nome }).eq("id", u.id);
    if (error) errors++;
    else updated++;
  }

  // Upsert conversations for EVERY contact (new + existing) so the inbox always has them.
  // Process bounded parallel batches: large tenants previously spent several minutes
  // awaiting each contact serially and hit the Edge Function idle timeout.
  const allWithLead = [...existingResolved, ...insertedIds];
  const linkedLeadIds = new Set<string>();
  const leadIdChunks: string[][] = [];
  for (let i = 0; i < allWithLead.length; i += 200) {
    leadIdChunks.push(allWithLead.slice(i, i + 200).map((item) => item.leadId));
  }
  const linkedResults = await Promise.all(leadIdChunks.map(async (ids) => {
    const { data, error } = await admin
      .from("conversations")
      .select("lead_id")
      .in("lead_id", ids);
    if (error) throw new Error(`conversation_lookup_failed: ${error.message}`);
    return data ?? [];
  }));
  for (const rows of linkedResults) {
    for (const row of rows) {
      if (row.lead_id) linkedLeadIds.add(row.lead_id);
    }
  }
  const conversationsToUpsert = allWithLead.filter((item) => !linkedLeadIds.has(item.leadId));
  const conversationBatchSize = 12;
  for (let i = 0; i < conversationsToUpsert.length; i += conversationBatchSize) {
    const batch = conversationsToUpsert.slice(i, i + conversationBatchSize);
    const results = await Promise.all(batch.map(async (item) => {
      try {
        return await upsertConversationForContact(
          admin,
          tenantId,
          item.row.phone,
          item.row.jid,
          item.row.name,
          item.leadId,
        );
      } catch (e) {
        console.warn("conversation upsert failed", String(e));
        return { error: true };
      }
    }));
    for (const result of results) {
      if ("error" in result) convsErrors++;
      else if (result.created) convsCreated++;
      else if (result.updated) convsUpdated++;
    }
  }

  return {
    tenant_id: tenantId,
    total_contacts: contacts.length,
    valid_phones: rows.length,
    created, updated, skipped, errors,
    conversations_created: convsCreated,
    conversations_updated: convsUpdated,
    conversations_errors: convsErrors,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const authz = await authorize(req, admin);
  if (!authz.ok) return json({ error: authz.error }, authz.status ?? 401);

  const body = await req.json().catch(() => ({}));
  const defaultStatus: string = String(body.default_status ?? "lead");
  const allTenants: boolean = body.all_tenants === true;

  if (allTenants) {
    if (!authz.internal && !authz.isAdmin) {
      return json({ error: "Sem permissão para escopo global" }, 403);
    }
    const { data: conns } = await admin
      .from("zapi_connections")
      .select("tenant_id")
      .eq("provider", "evolution");
    const seen = new Set<string>();
    const scopes: (string | null)[] = [];
    for (const c of conns ?? []) {
      const key = c.tenant_id === null ? "__master__" : String(c.tenant_id);
      if (seen.has(key)) continue;
      seen.add(key);
      scopes.push(c.tenant_id as string | null);
    }
    const results: any[] = [];
    for (const scope of scopes) {
      try {
        results.push(await runForTenant(admin, scope, defaultStatus));
      } catch (e) {
        results.push({ tenant_id: scope, error: String((e as Error).message ?? e) });
      }
    }
    return json({ ok: true, all_tenants: true, results });
  }

  const tenantId: string | null = body.tenant_id ?? null;

  // Per-tenant permission (only user calls need this; internal already trusted)
  if (!authz.internal) {
    if (tenantId) {
      const { data: ok } = await admin.rpc("has_tenant_access", { _user_id: authz.userId, _tenant_id: tenantId });
      if (!authz.isAdmin && !ok) return json({ error: "Sem permissão" }, 403);
    } else if (!authz.isAdmin) {
      return json({ error: "Sem permissão para escopo global" }, 403);
    }
  }

  const res = await runForTenant(admin, tenantId, defaultStatus);
  return json({ ok: true, ...res });
});
