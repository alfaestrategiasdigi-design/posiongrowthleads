// Sync contacts from Evolution API and learn (@lid, phone) aliases automatically.
// POST body: { tenant_id?: string | null }
// Calls /chat/findContacts/{instance}, iterates the returned contacts, and for
// every one that exposes BOTH a @lid identifier and a phone JID persists the
// alias in whatsapp_jid_aliases + folds any pending @lid conversation into the
// canonical phone-jid one. Mirrors the "contacts_event" path in whatsapp-webhook.
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

function normalizeJid(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.endsWith("@g.us") || raw.endsWith("@broadcast")) return null;
  const at = raw.indexOf("@");
  const domain = at >= 0 ? raw.slice(at + 1).split(":")[0].toLowerCase() : "";
  if (domain === "lid" || raw.includes("@lid")) {
    const d = onlyDigits(raw.split("@")[0]);
    return d ? `${d}@lid` : null;
  }
  const digits = onlyDigits(raw.split("@")[0]);
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

function firstStandard(cands: unknown[]): string | null {
  for (const c of cands) { const j = normalizeJid(c); if (j && !j.includes("@lid")) return j; }
  return null;
}
function firstLid(cands: unknown[]): string | null {
  for (const c of cands) { const j = normalizeJid(c); if (j?.includes("@lid")) return j; }
  return null;
}

async function mergeProvisionalLidConversations(
  admin: any, tenantId: string | null, lidJid: string, phoneJid: string,
) {
  const phone = onlyDigits(phoneJid.split("@")[0]);
  if (!phone) return { merged: 0, renamed: 0 };

  let provQ = admin.from("conversations")
    .select("id, nao_lidas, ultima_interacao, ultima_mensagem, nome_contato")
    .eq("remote_jid", lidJid);
  provQ = tenantId ? provQ.eq("tenant_id", tenantId) : provQ.is("tenant_id", null);
  const { data: provList } = await provQ;
  if (!provList || provList.length === 0) return { merged: 0, renamed: 0 };

  let canonQ = admin.from("conversations")
    .select("id, nao_lidas, ultima_interacao")
    .eq("remote_jid", phoneJid);
  canonQ = tenantId ? canonQ.eq("tenant_id", tenantId) : canonQ.is("tenant_id", null);
  let { data: canonical } = await canonQ.maybeSingle();
  if (!canonical) {
    let byPhoneQ = admin.from("conversations")
      .select("id, nao_lidas, ultima_interacao")
      .eq("telefone", phone);
    byPhoneQ = tenantId ? byPhoneQ.eq("tenant_id", tenantId) : byPhoneQ.is("tenant_id", null);
    const { data } = await byPhoneQ.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
    canonical = data;
  }

  let merged = 0, renamed = 0;
  for (const provisional of provList) {
    if (canonical && canonical.id === provisional.id) continue;
    if (!canonical) {
      await admin.from("conversations")
        .update({ remote_jid: phoneJid, telefone: phone, needs_lid_review: false, lid_review_notes: null })
        .eq("id", provisional.id);
      await admin.from("messages")
        .update({ metadata: {} })
        .eq("conversation_id", provisional.id)
        .filter("metadata->>pending_lid_resolution", "eq", "true");
      canonical = { id: provisional.id, nao_lidas: provisional.nao_lidas ?? 0, ultima_interacao: provisional.ultima_interacao } as any;
      renamed++;
      continue;
    }
    await admin.from("messages")
      .update({ conversation_id: canonical.id, metadata: {} })
      .eq("conversation_id", provisional.id);
    await admin.from("message_reactions")
      .update({ conversation_id: canonical.id })
      .eq("conversation_id", provisional.id);
    await admin.from("conversations")
      .update({
        ultima_mensagem: provisional.ultima_mensagem ?? undefined,
        ultima_interacao: provisional.ultima_interacao ?? new Date().toISOString(),
        nao_lidas: (canonical.nao_lidas ?? 0) + (provisional.nao_lidas ?? 0),
        nome_contato: provisional.nome_contato ?? undefined,
        needs_lid_review: false,
        lid_review_notes: null,
      })
      .eq("id", canonical.id);
    await admin.from("conversations").delete().eq("id", provisional.id);
    merged++;
  }
  return { merged, renamed };
}

async function upsertJidAlias(
  admin: any, tenantId: string | null, instanceName: string | null,
  lidJid: string | null, phoneJid: string | null,
): Promise<{ aliased: boolean; merged: number; renamed: number }> {
  if (!lidJid?.includes("@lid") || !phoneJid || phoneJid.includes("@lid")) return { aliased: false, merged: 0, renamed: 0 };
  await admin.from("whatsapp_jid_aliases").upsert({
    tenant_id: tenantId,
    instance_name: instanceName,
    lid_jid: lidJid,
    phone_jid: phoneJid,
    updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "tenant_scope,lid_jid" });
  const res = await mergeProvisionalLidConversations(admin, tenantId, lidJid, phoneJid);
  return { aliased: true, ...res };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const token = authHeader.replace("Bearer ", "");
  const { data: userRes } = await userClient.auth.getUser(token);
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const tenantId: string | null = body?.tenant_id ?? null;

  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (tenantId) {
    const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: tenantId });
    if (!isAdmin && !allowed) return json({ error: "Sem permissão" }, 403);
  } else if (!isAdmin) {
    return json({ error: "Sem permissão para escopo global" }, 403);
  }

  // Load Evolution connection
  let connQ = admin.from("zapi_connections")
    .select("instance_url, api_key, instance_name")
    .eq("provider", "evolution");
  connQ = tenantId ? connQ.eq("tenant_id", tenantId) : connQ.is("tenant_id", null);
  const { data: conn } = await connQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn?.instance_url || !conn.instance_name || !conn.api_key) {
    return json({ error: "Instância Evolution não configurada" }, 400);
  }
  const base = normalizeBase(conn.instance_url);

  // Fetch contacts. Evolution v2 exposes /chat/findContacts with an empty body
  // to return the whole contact book — this is exactly where LID <-> phone
  // pairings live.
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
    return json({ error: "Erro de rede ao buscar contatos", detail: String(e) }, 502);
  }

  let inspected = 0, aliased = 0, merged = 0, renamed = 0, pairedInPayload = 0, sampleNoPair: any[] = [];
  for (const c of contacts) {
    inspected++;
    // Cast a wide net across every field Evolution/Baileys uses for JIDs.
    const cands = [
      c?.remoteJid, c?.remoteJidAlt, c?.remoteJid_alt,
      c?.jid, c?.jidAlt, c?.jid_alt,
      c?.id, c?.idAlt, c?.id_alt,
      c?.lid, c?.lidJid, c?.lid_jid,
      c?.pn, c?.phoneNumber, c?.phone_number, c?.phone, c?.whatsappNumber, c?.wa_id, c?.number,
      c?.senderPn, c?.senderLid,
      c?.key?.remoteJid, c?.key?.remoteJidAlt, c?.key?.participant, c?.key?.participantAlt,
      c?.key?.senderPn, c?.key?.senderLid,
    ];
    const phoneJid = firstStandard(cands);
    const lidJid = firstLid(cands);
    if (phoneJid && lidJid) {
      pairedInPayload++;
      const res = await upsertJidAlias(admin, tenantId, conn.instance_name, lidJid, phoneJid);
      if (res.aliased) aliased++;
      merged += res.merged;
      renamed += res.renamed;
    } else if (lidJid && !phoneJid && sampleNoPair.length < 5) {
      // Diagnostic sample so we can see what Evolution actually returns for a @lid-only contact.
      sampleNoPair.push({ keys: Object.keys(c ?? {}), sample: c });
    }

    // Extra pass: even if this contact only carries a phone JID, try folding
    // any alias already stored for that phone (webhook may have saved it later).
    if (phoneJid && !lidJid) {
      let aliasQ = admin.from("whatsapp_jid_aliases")
        .select("lid_jid")
        .eq("phone_jid", phoneJid)
        .is("quarantined_at", null);
      aliasQ = tenantId ? aliasQ.eq("tenant_id", tenantId) : aliasQ.is("tenant_id", null);
      const { data: aliases } = await aliasQ;
      for (const a of aliases ?? []) {
        if (a?.lid_jid) {
          const res = await mergeProvisionalLidConversations(admin, tenantId, a.lid_jid, phoneJid);
          merged += res.merged;
          renamed += res.renamed;
        }
      }
    }
  }

  // Count how many @lid conversations remain for the caller.
  let remQ = admin.from("conversations").select("id", { count: "exact", head: true }).like("remote_jid", "%@lid");
  if (tenantId) remQ = remQ.eq("tenant_id", tenantId);
  const { count: remaining } = await remQ;

  return json({
    ok: true,
    inspected,
    paired_in_payload: pairedInPayload,
    aliased,
    merged,
    renamed,
    remaining_lid: remaining ?? 0,
    sample_no_pair: sampleNoPair,
  });
});
