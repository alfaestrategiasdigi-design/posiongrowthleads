// Import all Evolution API contacts into public.leads for a given tenant.
// POST body: { tenant_id: string | null, default_status?: string }
// - Calls /chat/findContacts/{instance}
// - Dedupes by normalize_phone(whatsapp) within the tenant scope
// - Inserts new leads; updates nome_completo of existing leads only if empty
// - The DB trigger trg_link_lead_to_conversations will back-fill conversations.lead_id
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
  // Fallback: format BR phone
  if (phone.length === 13 && phone.startsWith("55")) {
    const ddd = phone.slice(2, 4);
    const rest = phone.slice(4);
    return `+55 (${ddd}) ${rest.slice(0, -4)}-${rest.slice(-4)}`;
  }
  return `+${phone}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: userRes } = await userClient.auth.getUser(token);
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const tenantId: string | null = body.tenant_id ?? null;
  const defaultStatus: string = String(body.default_status ?? "lead");

  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (tenantId) {
    const { data: ok } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: tenantId });
    if (!isAdmin && !ok) return json({ error: "Sem permissão" }, 403);
  } else if (!isAdmin) {
    return json({ error: "Sem permissão para escopo global" }, 403);
  }

  let connQ = admin.from("zapi_connections")
    .select("instance_url, api_key, instance_name")
    .eq("provider", "evolution");
  connQ = tenantId ? connQ.eq("tenant_id", tenantId) : connQ.is("tenant_id", null);
  const { data: conn } = await connQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn?.instance_url || !conn.instance_name || !conn.api_key) {
    return json({ error: "Instância Evolution não configurada" }, 400);
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
    if (!r.ok) return json({ error: "findContacts falhou", detail: j, status: r.status }, 502);
    contacts = Array.isArray(j) ? j : (j?.contacts || j?.data || []);
  } catch (e) {
    return json({ error: "Erro de rede", detail: String(e) }, 502);
  }

  // Dedup phones within the payload itself
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

  // Preload existing leads for this tenant to dedupe by normalize_phone
  const norm = (p: string) => p.replace(/\D/g, "").slice(-11);
  const targetNormalized = new Set(rows.map((r) => norm(r.phone)));

  let existQ = admin.from("leads").select("id, whatsapp, nome_completo");
  existQ = tenantId ? existQ.eq("tenant_id", tenantId) : existQ.is("tenant_id", null);
  const { data: existing } = await existQ;
  const existingByNorm = new Map<string, { id: string; name: string | null }>();
  for (const e of existing ?? []) {
    const n = norm(String(e.whatsapp ?? ""));
    if (n && targetNormalized.has(n) && !existingByNorm.has(n)) {
      existingByNorm.set(n, { id: e.id, name: e.nome_completo ?? null });
    }
  }

  let created = 0, updated = 0, skipped = 0, errors = 0;
  const toInsert: any[] = [];
  const toUpdate: { id: string; nome: string }[] = [];

  for (const r of rows) {
    const n = norm(r.phone);
    const existing = existingByNorm.get(n);
    if (existing) {
      // Only fill missing name
      const cur = (existing.name ?? "").trim();
      if (!cur && r.name && !/^\+?\d/.test(r.name)) {
        toUpdate.push({ id: existing.id, nome: r.name });
      } else {
        skipped++;
      }
      continue;
    }
    toInsert.push({
      nome_completo: r.name,
      whatsapp: r.phone,
      tenant_id: tenantId,
      status: defaultStatus,
      origem: "whatsapp_import",
      extras: { source: "evolution_contacts", jid: r.jid, imported_at: new Date().toISOString() },
    });
  }

  // Batch insert (chunks of 200)
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    const { error, data } = await admin.from("leads").insert(chunk).select("id");
    if (error) { errors += chunk.length; console.warn("insert leads chunk failed", error.message); }
    else created += data?.length ?? 0;
  }

  for (const u of toUpdate) {
    const { error } = await admin.from("leads").update({ nome_completo: u.nome }).eq("id", u.id);
    if (error) errors++;
    else updated++;
  }

  return json({
    ok: true,
    total_contacts: contacts.length,
    valid_phones: rows.length,
    created,
    updated,
    skipped,
    errors,
  });
});
