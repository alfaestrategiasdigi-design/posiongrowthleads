// Webhook público da Evolution API.
// Eventos suportados: messages.upsert, messages.update (status), connection.update,
// contacts.update / contacts.upsert (pushName + profilePicUrl). Mídia (image/audio/video/document)
// é baixada via getBase64FromMediaMessage e salva em storage whatsapp-media.
import { createClient } from "npm:@supabase/supabase-js@2";
import { decideAliasFromSameKey, extractRawKeySnapshot } from "./routing.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const ownJidCache = new Map<string, { expiresAt: number; jids: string[] }>();

function normalizeBase(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch { return s.replace(/\/+$/, ""); }
}

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizePhoneJid(value: unknown): string | null {
  let raw = String(value ?? "").trim();
  if (!raw) return null;
  raw = raw.replace(/^whatsapp:/i, "").split(/[\s,;]+/)[0]?.trim() ?? "";
  if (!raw) return null;
  const at = raw.indexOf("@");
  const normalizedDomain = at >= 0 ? raw.slice(at + 1).split(":")[0].toLowerCase() : "";
  if (normalizedDomain === "g.us" || normalizedDomain === "broadcast" || raw.endsWith("@broadcast")) return null;
  if (normalizedDomain === "lid" || raw.includes("@lid")) {
    const lidDigits = onlyDigits(raw.split("@")[0]);
    return lidDigits ? `${lidDigits}@lid` : null;
  }
  const digits = onlyDigits(raw.split("@")[0]);
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

function firstStandardJid(candidates: unknown[], exclude = new Set<string>()): string | null {
  for (const candidate of candidates) {
    const jid = normalizePhoneJid(candidate);
    if (jid && !jid.includes("@lid") && !exclude.has(jid)) return jid;
  }
  return null;
}

function firstLidJid(candidates: unknown[], exclude = new Set<string>()): string | null {
  for (const candidate of candidates) {
    const jid = normalizePhoneJid(candidate);
    if (jid?.includes("@lid") && !exclude.has(jid)) return jid;
  }
  return null;
}

function uniqueCandidates(candidates: unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === "") continue;
    const key = typeof candidate === "string" ? candidate.trim() : JSON.stringify(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function eventKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[_.-]+/g, ".");
}

function eventMatches(event: string, ...names: string[]): boolean {
  const normalized = eventKey(event);
  return names.some((name) => {
    const target = eventKey(name);
    return normalized === target || normalized.includes(target);
  });
}

function asArrayPayload(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.messages)) return data.messages;
  if (Array.isArray(data?.message)) return data.message;
  if (Array.isArray(data?.data)) return data.data;
  return data ? [data] : [];
}

function unwrapMessagePayload(row: any): any {
  // Evolution can deliver SEND_MESSAGE/MESSAGES_SET as either:
  // { key, message: { conversation } } or { message: { key, message: { conversation } } }.
  // Always return the actual WhatsApp content object, not the envelope.
  return row?.message?.message ?? row?.message ?? row;
}

function extractPushName(row: any): string {
  return String(
    row?.pushName
      ?? row?.notifyName
      ?? row?.name
      ?? row?.message?.pushName
      ?? row?.message?.notifyName
      ?? row?.message?.name
      ?? "",
  ).trim();
}

function extractMessageCreatedAt(row: any): string {
  const raw = row?.messageTimestamp
    ?? row?.timestamp
    ?? row?.createdAt
    ?? row?.message?.messageTimestamp
    ?? row?.message?.timestamp
    ?? row?.message?.createdAt
    ?? row?.message?.message?.messageTimestamp;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 10_000_000_000 ? raw : raw * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) {
      const ms = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function collectFromKeys(source: any, keys: string[]): unknown[] {
  if (!source || typeof source !== "object") return [];
  const values: unknown[] = [];
  for (const key of keys) {
    values.push(source?.[key]);
  }
  return values;
}

function collectOutboundPeerCandidates(row: any, key: any): unknown[] {
  const envelope = row?.message ?? {};
  const nested = row?.message?.message ?? {};
  const nestedKey = row?.message?.key ?? row?.message?.message?.key ?? {};
  const candidateKeys = [
    "remoteJidAlt", "remoteJid_alt", "participantAlt", "participant_alt",
    "participantPn", "participant_pn", "senderPn", "sender_pn",
    "recipientJid", "recipient_jid", "recipient", "to", "chatId", "chat_id",
    "destinationJid", "destination_jid", "targetJid", "target_jid",
  ];
  return uniqueCandidates([
    ...collectFromKeys(key, candidateKeys),
    ...collectFromKeys(row, candidateKeys),
    ...collectFromKeys(envelope, candidateKeys),
    ...collectFromKeys(nested, candidateKeys),
    ...collectFromKeys(nestedKey, candidateKeys),
    row?.participant,
    envelope?.participant,
    nested?.participant,
  ]);
}

function collectInboundPeerCandidates(row: any, key: any): unknown[] {
  const envelope = row?.message ?? {};
  const nested = row?.message?.message ?? {};
  const nestedKey = row?.message?.key ?? row?.message?.message?.key ?? {};
  // Baileys ≥ 6.7 delivers the real phone in *Pn fields alongside the opaque
  // @lid remoteJid. Reading them here lets firstStandardJid pick up the
  // canonical phone on the very first inbound webhook (prevents @lid convs).
  const pnKeys = [
    "remoteJidAlt", "remoteJid_alt", "participantAlt", "participant_alt",
    "senderPn", "sender_pn", "participantPn", "participant_pn",
  ];
  return uniqueCandidates([
    ...collectFromKeys(key, pnKeys),
    ...collectFromKeys(envelope, pnKeys),
    ...collectFromKeys(nested, pnKeys),
    ...collectFromKeys(nestedKey, pnKeys),
    key?.remoteJid, row?.remoteJid,
  ]);
}

function extractRootOwnJids(body: any, instanceName: string): Set<string> {
  const own = new Set<string>();
  const rootCandidates = uniqueCandidates([
    body?.sender,
    body?.ownerJid,
    body?.owner,
    body?.wuid,
    body?.instanceOwner,
    body?.instance_owner,
    body?.data?.sender,
    body?.data?.ownerJid,
    body?.data?.owner,
    body?.data?.wuid,
  ]);
  for (const candidate of rootCandidates) {
    const raw = String(candidate ?? "").trim();
    if (!raw || raw === instanceName) continue;
    const jid = normalizePhoneJid(raw);
    const digits = onlyDigits(raw);
    if (jid && (raw.includes("@") || digits.length >= 10)) own.add(jid);
  }
  return own;
}

function collectOwnJidsFromObject(value: any, instanceName: string): Set<string> {
  const own = new Set<string>();
  const seen = new Set<any>();
  const visit = (node: any, depth = 0) => {
    if (!node || depth > 5) return;
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    const maybeInstance = String(node?.instanceName ?? node?.instance_name ?? node?.name ?? node?.instance?.instanceName ?? node?.instance?.instance_name ?? "").trim();
    const matchesThisInstance = Boolean(!instanceName || maybeInstance === instanceName);
    const hasExplicitOwnerField = ["ownerJid", "owner", "wuid", "profileId"].some((key) => node?.[key]);
    if (matchesThisInstance && (maybeInstance || hasExplicitOwnerField)) {
      const safeKeys = hasExplicitOwnerField || maybeInstance
        ? ["ownerJid", "owner", "wuid", "jid", "number", "phoneNumber", "phone", "profileId"]
        : ["ownerJid", "owner", "wuid", "jid", "profileId"];
      for (const key of safeKeys) {
        const raw = node?.[key];
        const jid = normalizePhoneJid(raw);
        const digits = onlyDigits(raw);
        if (jid && (String(raw ?? "").includes("@") || digits.length >= 10)) own.add(jid);
      }
      for (const key of ["instance", "user", "account"]) {
        const child = node?.[key];
        if (child && typeof child === "object") {
          const childInstance = String(child?.instanceName ?? child?.instance_name ?? child?.name ?? "").trim();
          const childMatches = !instanceName || childInstance === instanceName;
          const childHasExplicitOwner = ["ownerJid", "owner", "wuid", "profileId"].some((inner) => child?.[inner]);
          const childKeys = childMatches && childInstance
            ? ["ownerJid", "owner", "wuid", "jid", "number", "phoneNumber", "phone", "id"]
            : (childHasExplicitOwner ? ["ownerJid", "owner", "wuid", "jid", "profileId"] : []);
          for (const inner of childKeys) {
            const raw = child?.[inner];
            const jid = normalizePhoneJid(raw);
            const digits = onlyDigits(raw);
            if (jid && (String(raw ?? "").includes("@") || digits.length >= 10)) own.add(jid);
          }
        }
      }
    }

    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (["contacts", "chats", "messages"].includes(key)) continue;
      visit(child, depth + 1);
    }
  };
  visit(value);
  return own;
}

async function fetchInstanceOwnJids(conn: any, instanceName: string): Promise<Set<string>> {
  const own = new Set<string>();
  if (!conn?.instance_url || !conn?.api_key || !instanceName) return own;
  const cacheKey = `${normalizeBase(conn.instance_url)}::${instanceName}`;
  const cached = ownJidCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return new Set(cached.jids);
  const base = normalizeBase(conn.instance_url);
  const attempts = [
    { method: "GET", url: `${base}/instance/connectionState/${encodeURIComponent(instanceName)}` },
    { method: "GET", url: `${base}/instance/fetchInstances` },
    { method: "POST", url: `${base}/instance/fetchInstances`, body: {} },
  ];
  for (const attempt of attempts) {
    try {
      const r = await fetch(attempt.url, {
        method: attempt.method,
        headers: { "Content-Type": "application/json", apikey: conn.api_key },
        body: attempt.body ? JSON.stringify(attempt.body) : undefined,
        signal: AbortSignal.timeout(3500),
      });
      const text = await r.text();
      if (!r.ok || !text) continue;
      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
      for (const jid of collectOwnJidsFromObject(parsed, instanceName)) own.add(jid);
      if (own.size > 0) break;
    } catch {
      // non-fatal; webhook routing still uses payload-level candidates.
    }
  }
  if (own.size > 0) ownJidCache.set(cacheKey, { expiresAt: Date.now() + 5 * 60 * 1000, jids: Array.from(own) });
  return own;
}

// Persist a (@lid, phone) alias. Callers MUST pass source="same_key" only when
// both sides came from the SAME payload key object (see decideAliasFromSameKey
// in routing.ts). Any other source is rejected — this is the hardening after
// the 2026-07-05 wrong-merge incident that glued 4 unrelated @lids onto a
// single contact via pushName heuristics.
type AliasSource = "same_key" | "contacts_event" | "wamid_dedup" | "evolution_lookup";
async function upsertJidAlias(
  tenantId: string | null,
  instanceName: string | null,
  lidJid: string | null,
  phoneJid: string | null,
  source: AliasSource,
) {
  if (!lidJid?.includes("@lid") || !phoneJid || phoneJid.includes("@lid")) return;
  if (!source) return;
  try {
    await admin.from("whatsapp_jid_aliases").upsert({
      tenant_id: tenantId,
      instance_name: instanceName,
      lid_jid: lidJid,
      phone_jid: phoneJid,
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "tenant_scope,lid_jid" });
    await mergeProvisionalLidConversations(tenantId, lidJid, phoneJid);
  } catch (e) {
    console.warn("[whatsapp-webhook] upsertJidAlias_failed", String(e));
  }
}


// Merge a provisional @lid conversation into the canonical phone-jid conversation.
// Safe to call repeatedly. If no canonical exists, renames the provisional in place.
async function mergeProvisionalLidConversations(tenantId: string | null, lidJid: string, phoneJid: string) {
  const phone = onlyDigits(phoneJid.split("@")[0]);
  if (!phone) return;

  let provQ = admin.from("conversations")
    .select("id, nao_lidas, ultima_interacao, ultima_mensagem, nome_contato")
    .eq("remote_jid", lidJid);
  provQ = tenantId ? provQ.eq("tenant_id", tenantId) : provQ.is("tenant_id", null);
  const { data: provList } = await provQ;
  if (!provList || provList.length === 0) return;

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
      // First iteration becomes the canonical for subsequent ones.
      canonical = { id: provisional.id, nao_lidas: provisional.nao_lidas ?? 0, ultima_interacao: provisional.ultima_interacao } as any;
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
  }
}

async function adoptLegacyGlobalConversation(target: any, tenantId: string | null) {
  if (!tenantId || !target || target.tenant_id) return target;
  await admin.from("conversations")
    .update({ tenant_id: tenantId, needs_lid_review: false, lid_review_notes: null })
    .eq("id", target.id)
    .is("tenant_id", null);
  await admin.from("messages")
    .update({ tenant_id: tenantId })
    .eq("conversation_id", target.id)
    .is("tenant_id", null);
  await admin.from("message_reactions")
    .update({ tenant_id: tenantId })
    .eq("conversation_id", target.id)
    .is("tenant_id", null);
  return { ...target, tenant_id: tenantId };
}

// Root-cause hardening: when a message arrives on a KNOWN canonical conversation
// (non-@lid), look for any provisional @lid conversation in the same tenant with
// the same pushName. If exactly one candidate exists, register the alias — which
// triggers mergeProvisionalLidConversations — so we no longer depend solely on
// CONTACTS_UPDATE firing. Multiple candidates are flagged for manual review.
// HARDENED (2026-07-05): pushName-only matching NEVER creates aliases anymore.
// It only flags candidates for manual review. PushName collisions between
// unrelated contacts were the exact vector for the wrong-merge incident.
async function tryResolveByPushNameFromCanonical(
  tenantId: string | null,
  _instanceName: string | null,
  canonicalRemoteJid: string,
  pushName: string,
) {
  if (!pushName || pushName.length < 2) return;
  if (canonicalRemoteJid.includes("@lid")) return;
  let q = admin.from("conversations")
    .select("id, tenant_id, remote_jid")
    .like("remote_jid", "%@lid")
    .ilike("nome_contato", pushName);
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  const { data } = await q.limit(3);
  if (!data || data.length === 0) return;
  // Never auto-alias by pushName. Flag every candidate for human review.
  await admin.from("conversations")
    .update({
      needs_lid_review: true,
      lid_review_notes: `pushName='${pushName}' também corresponde à conversa canônica ${canonicalRemoteJid}. Revise manualmente antes de mesclar.`,
    })
    .in("id", data.map((c: any) => c.id));
}

// HARDENED (2026-07-05): return null (no auto-route) and flag for review
// when a new @lid arrives with a matching pushName. Alias creation is only
// allowed via same-key payload pairing (decideAliasFromSameKey) or authoritative
// contacts.* events.
async function tryRouteLidToCanonicalByPushName(
  tenantId: string | null,
  _instanceName: string | null,
  lidJid: string,
  pushName: string,
): Promise<string | null> {
  if (!pushName || pushName.length < 2) return null;
  let q = admin.from("conversations")
    .select("id, tenant_id, remote_jid")
    .not("remote_jid", "like", "%@lid")
    .not("remote_jid", "is", null)
    .ilike("nome_contato", pushName);
  q = tenantId ? q.or(`tenant_id.eq.${tenantId},tenant_id.is.null`) : q.is("tenant_id", null);
  const { data } = await q.limit(3);
  if (!data || data.length === 0) return null;
  // Flag candidate(s) — do not auto-alias.
  await admin.from("conversations")
    .update({
      needs_lid_review: true,
      lid_review_notes: `Novo @lid ${lidJid} tem pushName='${pushName}' igual a esta conversa. Confirme manualmente antes de mesclar.`,
    })
    .in("id", data.map((c: any) => c.id));
  return null;
}



async function mappedPhoneJid(tenantId: string | null, lidJid: string | null): Promise<string | null> {
  if (!lidJid?.includes("@lid")) return null;
  // HARDENED: quarantined aliases must never be used for routing.
  let q = admin.from("whatsapp_jid_aliases")
    .select("phone_jid")
    .eq("lid_jid", lidJid)
    .is("quarantined_at", null);
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  const { data } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (data?.phone_jid) return data.phone_jid;
  if (tenantId) {
    const { data: globalAlias } = await admin.from("whatsapp_jid_aliases")
      .select("phone_jid")
      .eq("lid_jid", lidJid)
      .is("tenant_id", null)
      .is("quarantined_at", null)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return globalAlias?.phone_jid ?? null;
  }
  return null;
}

// On-demand LID -> phone JID resolution via Evolution API.
// Called when an outbound (fromMe) message arrives with only an @lid recipient
// and no existing conversation, to avoid creating a duplicate provisional chat.
// Result cached in-memory per instance for 5 min to bound API calls.
const lidResolveCache = new Map<string, { at: number; phoneJid: string | null }>();
const lidResolveNegativeTtl = 60 * 1000;
const lidResolvePositiveTtl = 30 * 60 * 1000;

async function resolveLidViaEvolution(
  conn: { instance_url?: string; api_key?: string; instance_name?: string } | null | undefined,
  tenantId: string | null,
  instanceName: string | null,
  lidJid: string | null,
): Promise<string | null> {
  if (!lidJid || !lidJid.includes("@lid")) return null;
  if (!conn?.instance_url || !conn?.api_key || !conn?.instance_name) return null;
  const cacheKey = `${conn.instance_name}::${lidJid}`;
  const cached = lidResolveCache.get(cacheKey);
  if (cached) {
    const ttl = cached.phoneJid ? lidResolvePositiveTtl : lidResolveNegativeTtl;
    if (Date.now() - cached.at < ttl) return cached.phoneJid;
  }
  const base = normalizeBase(conn.instance_url);
  const attempts: Array<{ method: string; url: string; body?: unknown }> = [
    { method: "POST", url: `${base}/chat/findContacts/${encodeURIComponent(conn.instance_name)}`, body: { where: { id: lidJid } } },
    { method: "POST", url: `${base}/chat/findContacts/${encodeURIComponent(conn.instance_name)}`, body: { where: { lid: lidJid } } },
    { method: "POST", url: `${base}/chat/findContacts/${encodeURIComponent(conn.instance_name)}`, body: { where: { remoteJid: lidJid } } },
  ];
  let phoneJid: string | null = null;
  for (const ep of attempts) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(ep.url, {
        method: ep.method,
        headers: { "Content-Type": "application/json", apikey: conn.api_key },
        body: ep.body ? JSON.stringify(ep.body) : undefined,
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const parsed = await res.json().catch(() => null);
      const list: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.contacts) ? parsed.contacts
        : Array.isArray(parsed?.data) ? parsed.data
        : Array.isArray(parsed?.response?.contacts) ? parsed.response.contacts
        : [];
      for (const c of list) {
        const cands = [
          c?.id, c?.remoteJid, c?.remoteJidAlt, c?.jid, c?.jidAlt,
          c?.lid, c?.lidJid, c?.lid_jid,
          c?.pn, c?.phoneNumber, c?.wa_id, c?.senderPn, c?.participantPn,
        ];
        const foundPhone = firstStandardJid(cands);
        const foundLid = firstLidJid(cands);

        if (foundPhone && (!foundLid || foundLid === lidJid)) {
          phoneJid = foundPhone;
          break;
        }
      }
      if (phoneJid) break;
    } catch {
      // try next endpoint
    }
  }
  lidResolveCache.set(cacheKey, { at: Date.now(), phoneJid });
  if (phoneJid) {
    await upsertJidAlias(tenantId, instanceName, lidJid, phoneJid, "evolution_lookup");
    console.log("[whatsapp-webhook] lid_resolved_via_evolution", { lidJid, phoneJid });
  }
  return phoneJid;
}


async function resolveRemoteJid(
  message: any,
  key: any,
  tenantId: string | null,
  instanceName: string | null,
  fromMe: boolean,
  ownJids: Set<string>,
): Promise<{ remoteJid: string | null; rawRemoteJid: string | null; unresolvedLid: boolean; blockedSelfJid: boolean }> {
  const rawRemoteJid = String(key?.remoteJid ?? message?.remoteJid ?? "").trim() || null;
  const normalizedRaw = normalizePhoneJid(rawRemoteJid);
  const rawIsOwn = Boolean(normalizedRaw && ownJids.has(normalizedRaw));

  // Same-key pairing takes priority: if the payload's KEY object carries both
  // a @lid and a phone-JID (e.g. remoteJid=<lid>@lid + senderPn=<phone>), we
  // persist the alias AND route the message to the canonical phone conversation.
  // This prevents "Contato não identificado" from ever being created for
  // contacts whose payload includes the phone.
  const sameKey = decideAliasFromSameKey(key);
  if (sameKey.ok && !(fromMe && ownJids.has(sameKey.phoneJid))) {
    await upsertJidAlias(tenantId, instanceName, sameKey.lidJid, sameKey.phoneJid, "same_key");
    return { remoteJid: sameKey.phoneJid, rawRemoteJid, unresolvedLid: false, blockedSelfJid: false };
  }

  const candidateList = fromMe
    ? [
      ...collectOutboundPeerCandidates(message, key),
      ...(rawIsOwn ? [] : [rawRemoteJid]),
    ]
    : collectInboundPeerCandidates(message, key);
  const candidates = uniqueCandidates(candidateList);
  const standard = firstStandardJid(candidates, fromMe ? ownJids : new Set());
  const lid = firstLidJid(candidates, fromMe ? ownJids : new Set());
  if (standard) {
    // Also try same-key alias registration (already ran above but harmless).
    return { remoteJid: standard, rawRemoteJid, unresolvedLid: false, blockedSelfJid: false };
  }


  const mapped = await mappedPhoneJid(tenantId, lid ?? normalizedRaw ?? null);
  if (mapped) return { remoteJid: mapped, rawRemoteJid, unresolvedLid: false, blockedSelfJid: false };

  if (fromMe && rawIsOwn) {
    return { remoteJid: null, rawRemoteJid: lid ?? rawRemoteJid, unresolvedLid: Boolean(lid), blockedSelfJid: true };
  }

  if (lid) {
    return { remoteJid: null, rawRemoteJid: lid, unresolvedLid: true, blockedSelfJid: false };
  }

  return {
    remoteJid: normalizedRaw?.includes("@lid") ? null : normalizedRaw,
    rawRemoteJid,
    unresolvedLid: Boolean(normalizedRaw?.includes("@lid")),
    blockedSelfJid: false,
  };
}

async function findConversation(tenantId: string | null, remoteJid: string, phone: string) {
  let byJid = admin.from("conversations")
    .select("id, tenant_id, nao_lidas, remote_jid, telefone, ultima_interacao")
    .eq("remote_jid", remoteJid);
  byJid = tenantId ? byJid.or(`tenant_id.eq.${tenantId},tenant_id.is.null`) : byJid.is("tenant_id", null);
  const jidResult = await byJid.order("tenant_id", { ascending: false, nullsFirst: false }).order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
  if (jidResult.data) return await adoptLegacyGlobalConversation(jidResult.data, tenantId);

  let byPhone = admin.from("conversations")
    .select("id, tenant_id, nao_lidas, remote_jid, telefone, ultima_interacao")
    .eq("telefone", phone);
  byPhone = tenantId ? byPhone.or(`tenant_id.eq.${tenantId},tenant_id.is.null`) : byPhone.is("tenant_id", null);
  const phoneResult = await byPhone.order("tenant_id", { ascending: false, nullsFirst: false }).order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
  return phoneResult.data ? await adoptLegacyGlobalConversation(phoneResult.data, tenantId) : null;
}

async function fetchAndStoreMedia(
  conn: { instance_url: string; api_key: string; instance_name: string },
  message: any,
  tipo: string,
): Promise<{ url: string | null; mime: string | null }> {
  try {
    const base = normalizeBase(conn.instance_url);
    const r = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(conn.instance_name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.api_key },
      body: JSON.stringify({ message: { key: message.key, message: message.message } , convertToMp4: false }),
    });
    if (!r.ok) return { url: null, mime: null };
    const j = await r.json();
    const b64 = j?.base64 ?? j?.data ?? j?.mediaBase64;
    const mime = j?.mimetype ?? j?.mediaType ?? null;
    if (!b64) return { url: null, mime };
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const ext = tipo === "image" ? "jpg" : tipo === "audio" ? "ogg" : tipo === "video" ? "mp4" : "bin";
    const path = `${conn.instance_name}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const { error } = await admin.storage.from("whatsapp-media").upload(path, bin, {
      contentType: mime || `application/${ext}`,
      upsert: false,
    });
    if (error) { console.error("[wa media upload]", error); return { url: null, mime }; }
    const { data: signed } = await admin.storage.from("whatsapp-media").createSignedUrl(path, 60 * 60 * 24 * 365);
    return { url: signed?.signedUrl ?? null, mime };
  } catch (e) {
    console.error("[wa media fetch]", e);
    return { url: null, mime: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, name: "whatsapp-webhook" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { return new Response("ok", { headers: corsHeaders }); }

  try {
    const event = (body?.event ?? body?.type ?? "").toString().toLowerCase();
    const senderCandidate = String(body?.sender ?? "").trim();
    const senderLooksLikeJid = Boolean(normalizePhoneJid(senderCandidate))
      && (senderCandidate.includes("@") || onlyDigits(senderCandidate).length >= 10);
    const instanceName: string = body?.instance ?? body?.instanceName ?? (senderLooksLikeJid ? "" : senderCandidate);
    const url = new URL(req.url);
    const tenantSlug = url.searchParams.get("tenant");
    const tenantIdParam = url.searchParams.get("tenant_id");

    let resolvedTenantId: string | null = tenantIdParam;
    if (!resolvedTenantId && tenantSlug) {
      const { data: tenant } = await admin.from("tenants").select("id").eq("slug", tenantSlug).maybeSingle();
      resolvedTenantId = tenant?.id ?? null;
    }

    const requestSecret = url.searchParams.get("secret") || req.headers.get("x-webhook-secret") || "";
    let conn: any = null;
    let connResolvedBy: "instance_name" | "tenant" | null = null;
    if (instanceName) {
      const { data } = await admin.from("zapi_connections")
        .select("id, tenant_id, instance_url, api_key, instance_name, webhook_secret, status")
        .eq("provider", "evolution")
        .eq("instance_name", instanceName)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) { conn = data; connResolvedBy = "instance_name"; }
    }
    if (!conn && resolvedTenantId) {
      // Fallback: the URL carries a valid tenant slug/id, so accept the payload
      // and auto-heal the stored instance_name (Evolution may have been
      // recreated with a slightly different name).
      const { data } = await admin.from("zapi_connections")
        .select("id, tenant_id, instance_url, api_key, instance_name, webhook_secret, status")
        .eq("provider", "evolution")
        .eq("tenant_id", resolvedTenantId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) { conn = data; connResolvedBy = "tenant"; }
    }
    // Only refuse when BOTH the instance name and the URL tenant fail to
    // resolve any registered connection. Otherwise ingestion continues.
    if (!conn) {
      console.warn("[whatsapp-webhook] unknown_instance", {
        instanceName, tenantSlug, tenantIdParam,
      });
      return new Response(JSON.stringify({ ok: true, dropped: "unknown_instance" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Verify the per-connection webhook secret (protects against spoofed events).
    // Auto-heal when the stored secret is empty AND the URL identifies the tenant
    // (slug or id) — this covers freshly-created connections that never had a
    // secret written to the DB yet.
    if (!conn.webhook_secret) {
      if (requestSecret && (tenantSlug || tenantIdParam)) {
        await admin.from("zapi_connections")
          .update({ webhook_secret: requestSecret, updated_at: new Date().toISOString() })
          .eq("id", conn.id);
        conn.webhook_secret = requestSecret;
        console.log("[whatsapp-webhook] webhook_secret_auto_heal", { instanceName, tenant: conn.tenant_id });
      }
    } else if (requestSecret !== conn.webhook_secret) {
      console.warn("[whatsapp-webhook] invalid_secret", { instanceName, tenant: conn.tenant_id });
      return new Response(JSON.stringify({ ok: false, error: "invalid_secret" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (connResolvedBy === "tenant" && instanceName && conn.instance_name !== instanceName) {
      console.log("[whatsapp-webhook] instance_name_updated", {
        tenant_id: conn.tenant_id, from: conn.instance_name, to: instanceName,
      });
      await admin.from("zapi_connections")
        .update({ instance_name: instanceName, updated_at: new Date().toISOString() })
        .eq("provider", "evolution")
        .eq("tenant_id", conn.tenant_id);
      conn.instance_name = instanceName;
    }
    let tenantId: string | null = conn?.tenant_id ?? null;
    const ownJids = extractRootOwnJids(body, instanceName);

    // ── Trava de roteamento por número (tenant_whatsapp_numbers) ──
    // Se conhecemos o ownerJid dessa instância, cruzamos com os números
    // verificados dos tenants. Isso impede que mensagens caiam no admin master
    // por engano quando URL/instance_name apontam para o tenant errado.
    try {
      const ownerDigitsSet = new Set<string>();
      for (const jid of ownJids) {
        const digits = onlyDigits(jid);
        if (digits.length >= 10) ownerDigitsSet.add(digits);
      }
      if (ownerDigitsSet.size > 0) {
        const digitsList = Array.from(ownerDigitsSet);
        const { data: numRows } = await admin
          .from("tenant_whatsapp_numbers")
          .select("tenant_id, phone_e164, status")
          .in("phone_e164", digitsList);
        const verified = (numRows || []).find((r: any) => r.status === "verified");
        const any = verified || (numRows || [])[0];
        if (any?.tenant_id && any.tenant_id !== tenantId) {
          console.log("[whatsapp-webhook] tenant_reroute_by_owner", {
            from: tenantId, to: any.tenant_id, owner: any.phone_e164, instanceName,
          });
          tenantId = any.tenant_id;
          if (conn) conn.tenant_id = any.tenant_id;
        } else if (!any?.tenant_id && tenantId === null) {
          console.warn("[whatsapp-webhook] unknown_owner_jid", {
            instanceName, owners: digitsList,
          });
        }
      }
    } catch (e) {
      console.error("[whatsapp-webhook] owner_route_error", e);
    }


    // Connection state
    if (eventMatches(event, "connection.update") || body?.data?.state) {
      const state = body?.data?.state ?? body?.state;
      const status = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
      if (instanceName) {
        let upd = admin.from("zapi_connections")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("provider", "evolution").eq("instance_name", instanceName);
        upd = tenantId ? upd.eq("tenant_id", tenantId) : upd.is("tenant_id", null);
        await upd;
      }
    }

    // Auto-heal: if traffic is arriving (messages/contacts events), the instance
    // IS connected — even if we never received the connection.update event.
    // This unblocks the UI from staying stuck on "Pareando" for tenants like Roar.
    if (conn?.id && conn.status !== "connected" && eventMatches(
      event, "messages.upsert", "messages.set", "send.message",
      "messages.update", "contacts.update", "contacts.upsert", "contacts.set",
    )) {
      await admin.from("zapi_connections")
        .update({ status: "connected", updated_at: new Date().toISOString() })
        .eq("id", conn.id);
      conn.status = "connected";
      console.log("[whatsapp-webhook] status_auto_healed", {
        connection_id: conn.id, tenant_id: conn.tenant_id, event,
      });
    }


    // Contacts update -> pushName + profile pic + automatic (@lid, phone) alias learning.
    // The Evolution/Baileys `contacts.*` events are AUTHORITATIVE: when a single
    // contact object exposes BOTH a @lid identifier and a phone JID, the pairing
    // is trustworthy (unlike pushName heuristics). We scan every field variant
    // Evolution v2 has been observed to emit so no pairing is missed.
    if (eventMatches(event, "contacts.update", "contacts.upsert", "contacts.set")) {
      const contacts: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const c of contacts) {
        // Wide net across every field name Baileys / Evolution has been seen to use.
        const contactCandidates = [
          c?.remoteJid, c?.remoteJidAlt, c?.remoteJid_alt,
          c?.jid, c?.jidAlt, c?.jid_alt,
          c?.id, c?.idAlt, c?.id_alt,
          c?.lid, c?.lidJid, c?.lid_jid,
          c?.pn, c?.phoneNumber, c?.phone_number, c?.phone, c?.whatsappNumber, c?.wa_id,
          c?.senderPn, c?.senderLid, c?.participantPn, c?.participantAlt,
          c?.key?.remoteJid, c?.key?.remoteJidAlt, c?.key?.participant, c?.key?.participantAlt,
          c?.key?.senderPn, c?.key?.senderLid,
        ];
        const phoneJid = firstStandardJid(contactCandidates);
        const lidJid = firstLidJid(contactCandidates);

        // Same-object pairing -> save alias (source "contacts_event") which also
        // triggers mergeProvisionalLidConversations() and folds any pending @lid
        // thread into the canonical phone thread without human intervention.
        await upsertJidAlias(tenantId, instanceName || null, lidJid, phoneJid, "contacts_event");

        // Update pushName / avatar on whichever JID we can address.
        const updates: any = {};
        if (c?.pushName || c?.name || c?.verifiedName) updates.nome_contato = c.pushName || c.name || c.verifiedName;
        if (c?.profilePicUrl || c?.profilePictureUrl) updates.foto_url = c.profilePicUrl || c.profilePictureUrl;
        if (Object.keys(updates).length > 0) {
          const targetJid = phoneJid ?? lidJid;
          if (targetJid) {
            let q = admin.from("conversations").update(updates).eq("remote_jid", targetJid);
            if (tenantId) q = q.eq("tenant_id", tenantId); else q = q.is("tenant_id", null);
            await q;
          }
        }

        // If we learned a phone JID (with or without an alias in the same event),
        // try to fold any previously-stored alias for this phone: some Evolution
        // builds emit the @lid event first and the phone event second.
        if (phoneJid && !lidJid) {
          let aliasQ = admin.from("whatsapp_jid_aliases")
            .select("lid_jid")
            .eq("phone_jid", phoneJid)
            .is("quarantined_at", null);
          aliasQ = tenantId ? aliasQ.eq("tenant_id", tenantId) : aliasQ.is("tenant_id", null);
          const { data: aliases } = await aliasQ;
          for (const a of aliases ?? []) {
            if (a?.lid_jid) await mergeProvisionalLidConversations(tenantId, a.lid_jid, phoneJid);
          }
        }
      }
    }

    // Message status updates (sent/delivered/read)
    if (eventMatches(event, "messages.update", "send.message.update")) {
      const arr: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      const statusRank: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 0 };
      for (const u of arr) {
        const wamid = u?.key?.id ?? u?.keyId ?? u?.update?.key?.id ?? u?.message?.key?.id ?? u?.id;
        const rawRemoteJid: string | undefined = u?.key?.remoteJid ?? u?.update?.key?.remoteJid ?? u?.remoteJid;
        const rawStatus = u?.status ?? u?.update?.status ?? u?.messageStatus ?? "";
        const st = String(rawStatus).toLowerCase().replace(/[_-]/g, "_");
        if (!st) continue;
        const map: Record<string,string> = {
          read: "read", read_self: "read", played: "read",
          delivery_ack: "delivered", delivered: "delivered",
          server_ack: "sent", sent: "sent", pending: "sent",
          error: "failed", failed: "failed",
        };
        const status = map[st] ?? st;

        let matchedId: string | null = null;
        let matchedConvId: string | null = null;

        if (wamid) {
          const { data: updated } = await admin
            .from("messages")
            .update({ status })
            .eq("wamid", wamid)
            .select("id, conversation_id");
          if (updated && updated.length > 0) {
            matchedId = updated[0].id; matchedConvId = updated[0].conversation_id;
          }
        }

        // Fallback: correlate by JID/phone → latest outbound msg without ACK yet.
        if (!matchedId && rawRemoteJid) {
          const phone = String(rawRemoteJid).split("@")[0].replace(/\D/g, "");
          let convQ = admin.from("conversations").select("id, tenant_id").limit(1);
          if (tenantId) convQ = convQ.eq("tenant_id", tenantId); else convQ = convQ.is("tenant_id", null);
          const { data: conv } = await convQ.or(`remote_jid.eq.${rawRemoteJid},telefone.eq.${phone}`).maybeSingle();
          if (conv?.id) {
            const { data: candidate } = await admin.from("messages")
              .select("id, status, wamid")
              .eq("conversation_id", conv.id)
              .eq("direction", "outbound")
              .order("created_at", { ascending: false })
              .limit(1).maybeSingle();
            if (candidate) {
              const curRank = statusRank[candidate.status ?? "sent"] ?? 1;
              const newRank = statusRank[status] ?? 0;
              if (newRank > curRank) {
                const patch: any = { status };
                if (!candidate.wamid && wamid) patch.wamid = wamid;
                await admin.from("messages").update(patch).eq("id", candidate.id);
              }
              matchedId = candidate.id; matchedConvId = conv.id;
            }
          }
        }

        if (!matchedId) {
          console.warn("[whatsapp-webhook] messages.update no-match", { wamid, rawRemoteJid, status, rawStatus });
        } else if (status === "read" && matchedConvId) {
          // When counterpart reads our messages we don't touch unread counter (that's inbound).
          // But we do refresh conversation activity so the panel sorts correctly.
          await admin.from("conversations")
            .update({ ultima_interacao: new Date().toISOString() })
            .eq("id", matchedConvId);
        }
      }
    }

    // Message DELETE (revoked)
    if (eventMatches(event, "messages.delete", "message.delete")) {
      const arr: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const u of arr) {
        const wamid = u?.key?.id ?? u?.id;
        if (!wamid) continue;
        await admin.from("messages").update({
          deleted_at: new Date().toISOString(),
          conteudo: "🚫 Mensagem apagada",
        }).eq("wamid", wamid);
      }
    }

    // Message EDITED
    if (eventMatches(event, "messages.edited", "message.edited")) {
      const arr: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const u of arr) {
        const wamid = u?.key?.id ?? u?.id;
        const newText = u?.message?.editedMessage?.message?.conversation
          ?? u?.message?.editedMessage?.message?.extendedTextMessage?.text
          ?? u?.text;
        if (!wamid || !newText) continue;
        await admin.from("messages").update({
          conteudo: newText,
          edited_at: new Date().toISOString(),
        }).eq("wamid", wamid);
      }
    }

    // REACTIONS
    if (eventMatches(event, "messages.reaction", "message.reaction")) {
      const arr: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const r of arr) {
        const targetWamid = r?.reaction?.key?.id ?? r?.message?.reactionMessage?.key?.id ?? r?.key?.id;
        const emoji = r?.reaction?.text ?? r?.message?.reactionMessage?.text ?? r?.text;
        const actor = r?.key?.participant ?? r?.key?.remoteJid ?? r?.reaction?.key?.participant ?? "unknown";
        const fromMe = Boolean(r?.key?.fromMe);
        if (!targetWamid) continue;
        // Find conversation via target message
        const { data: targetMsg } = await admin.from("messages")
          .select("conversation_id, tenant_id").eq("wamid", targetWamid).maybeSingle();
        if (!targetMsg) continue;
        if (!emoji || emoji === "") {
          // reaction removed
          await admin.from("message_reactions").delete()
            .eq("message_wamid", targetWamid).eq("actor_jid", actor);
        } else {
          await admin.from("message_reactions").upsert({
            message_wamid: targetWamid,
            conversation_id: targetMsg.conversation_id,
            tenant_id: targetMsg.tenant_id,
            actor_jid: actor,
            from_me: fromMe,
            emoji,
          }, { onConflict: "message_wamid,actor_jid" });
        }
      }
    }

    // Messages upsert (includes SEND_MESSAGE for outbound echoes from other devices)
    if (
      eventMatches(event, "messages.upsert", "messages.set", "send.message") ||
      (!event && body?.data)
    ) {
      const messagesArr: any[] = asArrayPayload(body?.data);
      const isHistorySet = eventMatches(event, "messages.set");

      for (const m of messagesArr) {
        const key = m?.key ?? m?.message?.key ?? m?.message?.message?.key ?? {};
        const wamid: string | null = key?.id ?? m?.id ?? null;
        const fromMe: boolean = Boolean(key?.fromMe ?? m?.fromMe);
        const resolved = await resolveRemoteJid(m, key, tenantId, instanceName || null, fromMe, ownJids);
        const rawRemoteJid = resolved.rawRemoteJid;
        // Structured log for diagnosing "outbound from phone doesn't appear" (case A audit)
        console.log("[wa-in]", {
          event,
          fromMe,
          wamid,
          rawRemoteJid,
          resolvedJid: resolved.remoteJid,
          unresolvedLid: resolved.unresolvedLid,
          blockedSelfJid: resolved.blockedSelfJid,
          ownJids: Array.from(ownJids),
        });
        if (rawRemoteJid?.endsWith("@g.us") || rawRemoteJid?.endsWith("@broadcast")) continue;

        // Fallback for outbound: if resolver blocked because it thinks recipient
        // is our own JID, try senderPn / participantAlt on the key as the real
        // recipient before dropping. This fixes echoes where Evolution nests the
        // recipient in participantAlt while remoteJid comes as our ownerJid.
        let effectiveJid = resolved.remoteJid
          ?? (resolved.blockedSelfJid && !rawRemoteJid?.includes("@lid") ? null : rawRemoteJid);
        if (!effectiveJid && fromMe) {
          const alt = normalizePhoneJid(
            key?.senderPn ?? key?.participantAlt ?? key?.remoteJidAlt ?? null,
          );
          if (alt && !ownJids.has(alt)) {
            effectiveJid = alt;
            console.log("[wa-in] outbound_recovered_via_alt", { wamid, alt });
          }
        }
        if (!effectiveJid) {
          console.warn("[whatsapp-webhook] no_jid_dropped", { wamid, fromMe, blockedSelfJid: resolved.blockedSelfJid, ownJids: Array.from(ownJids) });
          continue;
        }
        let remoteJid = effectiveJid;
        let isPendingLid = resolved.unresolvedLid || remoteJid.includes("@lid");
        const rawPushName: string = extractPushName(m);
        // CRITICAL: on fromMe payloads, `pushName` is the SENDER's (phone owner)
        // own name, not the recipient's. Using it as `nome_contato` created a
        // storm of conversations all labelled with the operator's name pointing
        // to random @lid recipients. Only trust pushName for inbound messages.
        const pushName: string = fromMe ? "" : rawPushName;

        // Root-cause hardening #1: if this arrived as @lid, try to route it into
        // an existing canonical conversation by pushName BEFORE creating a new
        // provisional row. Zero dependency on CONTACTS_UPDATE. Skip for fromMe:
        // matching by operator's own pushName would attach every outbound to the
        // wrong contact (root cause of the "56 conversas @lid" storm).
        if (isPendingLid && pushName && !fromMe) {
          const canonical = await tryRouteLidToCanonicalByPushName(tenantId, instanceName || null, remoteJid, pushName);
          if (canonical) {
            remoteJid = canonical;
            isPendingLid = false;
          }
        }

        // Previously we DROPPED outbound @lid messages when no conversation
        // existed yet. That silently ate every "operator texted a new lead
        // from the physical phone" case (audit case A). Now we keep them as
        // provisional so they show up in the panel; when the phone JID alias
        // arrives (CONTACTS_UPDATE / same-key alias), mergeProvisionalLid...
        // migrates the conversation and messages to the canonical JID.
        // Root-cause hardening #1b: outbound-only proactive LID -> phone lookup.
        // When the operator texts from the physical phone to a contact whose
        // recipient JID arrives only as @lid, ask Evolution for the canonical
        // phone before creating a provisional conversation. This eliminates the
        // "Contato não identificado" duplicate chat for device-originated sends.
        if (isPendingLid && fromMe) {
          const resolvedPhoneJid = await resolveLidViaEvolution(
            conn as any, tenantId, instanceName || null, remoteJid,
          );
          if (resolvedPhoneJid) {
            remoteJid = resolvedPhoneJid;
            isPendingLid = false;
          }
        }

        if (isPendingLid && fromMe) {
          console.log("[whatsapp-webhook] outbound_lid_kept_provisional", {
            wamid, rawRemoteJid, remoteJid,
          });
        }


        if (isPendingLid) {
          console.log("[whatsapp-webhook] pending_lid_stored", { wamid, rawRemoteJid, fromMe, pushName });
        }

        const msgObj = unwrapMessagePayload(m);

        // Detect message type (broad coverage)
        const stickerMsg = msgObj?.stickerMessage;
        const locationMsg = msgObj?.locationMessage ?? msgObj?.liveLocationMessage;
        const contactMsg = msgObj?.contactMessage ?? msgObj?.contactsArrayMessage;
        const reactionMsg = msgObj?.reactionMessage;

        // Reactions arriving inside upsert flow -> reroute
        if (reactionMsg) {
          const targetWamid = reactionMsg?.key?.id;
          if (targetWamid) {
            const { data: targetMsg } = await admin.from("messages")
              .select("conversation_id, tenant_id").eq("wamid", targetWamid).maybeSingle();
            if (targetMsg) {
              const emoji = reactionMsg?.text ?? "";
              const actor = key?.participant ?? key?.remoteJid ?? "unknown";
              if (!emoji) {
                await admin.from("message_reactions").delete()
                  .eq("message_wamid", targetWamid).eq("actor_jid", actor);
              } else {
                await admin.from("message_reactions").upsert({
                  message_wamid: targetWamid,
                  conversation_id: targetMsg.conversation_id,
                  tenant_id: targetMsg.tenant_id,
                  actor_jid: actor, from_me: fromMe, emoji,
                }, { onConflict: "message_wamid,actor_jid" });
              }
            }
          }
          continue;
        }

        // Extract button/list selection (Evolution/Baileys formats)
        const paramsJsonRaw = msgObj?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
        let interactiveReplyId: string | null = null;
        let interactiveReplyText = "";
        if (paramsJsonRaw) {
          try {
            const parsed = typeof paramsJsonRaw === "string" ? JSON.parse(paramsJsonRaw) : paramsJsonRaw;
            interactiveReplyId = parsed?.id ?? parsed?.button_id ?? parsed?.buttonId ?? parsed?.selectedButtonId ?? null;
            interactiveReplyText = parsed?.display_text ?? parsed?.displayText ?? parsed?.title ?? parsed?.text ?? "";
          } catch {
            interactiveReplyId = String(paramsJsonRaw);
          }
        }
        const buttonReplyId: string | null =
          msgObj?.buttonsResponseMessage?.selectedButtonId
          ?? msgObj?.buttonReplyMessage?.id
          ?? msgObj?.templateButtonReplyMessage?.selectedId
          ?? msgObj?.interactiveResponseMessage?.buttonReply?.id
          ?? interactiveReplyId
          ?? null;
        const buttonReplyText: string =
          msgObj?.buttonsResponseMessage?.selectedDisplayText
          ?? msgObj?.buttonReplyMessage?.displayText
          ?? msgObj?.buttonReplyMessage?.title
          ?? msgObj?.templateButtonReplyMessage?.selectedDisplayText
          ?? msgObj?.interactiveResponseMessage?.buttonReply?.displayText
          ?? msgObj?.interactiveResponseMessage?.buttonReply?.title
          ?? interactiveReplyText
          ?? msgObj?.listResponseMessage?.title
          ?? "";
        const listReplyId: string | null = msgObj?.listResponseMessage?.singleSelectReply?.selectedRowId ?? null;

        const text: string = msgObj?.conversation
          ?? msgObj?.extendedTextMessage?.text
          ?? msgObj?.imageMessage?.caption
          ?? msgObj?.videoMessage?.caption
          ?? msgObj?.documentMessage?.caption
          ?? buttonReplyText
          ?? buttonReplyId
          ?? listReplyId
          ?? m?.text
          ?? "";


        const tipo = msgObj?.imageMessage ? "image"
          : msgObj?.audioMessage ? "audio"
          : msgObj?.videoMessage ? "video"
          : msgObj?.documentMessage ? "document"
          : stickerMsg ? "sticker"
          : locationMsg ? "location"
          : contactMsg ? "contact"
          : "text";
        // Do not discard a first-contact conversation just because Evolution sent
        // a message shape we do not render yet. Previously, an empty text fallback
        // returned here before the conversation was created, making legitimate
        // non-form contacts disappear completely from the inbox.
        const unsupportedMessageType = !text && tipo === "text"
          ? Object.keys(msgObj ?? {}).find((key) => key.endsWith("Message")) ?? "unknown"
          : null;

        // Exact dedup must happen BEFORE mutating conversations. Evolution may
        // deliver the same phone-originated wamid twice: once as a canonical JID
        // and once as an unresolved @lid. If we create/update the @lid thread
        // before checking wamid, the UI gets an empty/phantom duplicated chat.
        if (wamid) {
          const { data: existingMsg } = await admin.from("messages")
            .select("id, conversation_id, tenant_id, conversations(id, tenant_id, remote_jid, telefone)")
            .eq("wamid", wamid)
            .maybeSingle();
          if (existingMsg) {
            const existingConv = Array.isArray((existingMsg as any).conversations)
              ? (existingMsg as any).conversations[0]
              : (existingMsg as any).conversations;
            const adopted = await adoptLegacyGlobalConversation(existingConv, tenantId);
            if (isPendingLid && adopted?.remote_jid && !adopted.remote_jid.includes("@lid")) {
              await upsertJidAlias(tenantId, instanceName || null, remoteJid, adopted.remote_jid, "wamid_dedup");
            }
            continue;
          }
        }

        // Quoted / reply context
        const ctx = msgObj?.extendedTextMessage?.contextInfo
          ?? msgObj?.imageMessage?.contextInfo
          ?? msgObj?.videoMessage?.contextInfo
          ?? msgObj?.audioMessage?.contextInfo
          ?? msgObj?.documentMessage?.contextInfo
          ?? msgObj?.stickerMessage?.contextInfo
          ?? null;
        const replyToWamid: string | null = ctx?.stanzaId ?? null;
        let replyPreview: string | null = null;
        if (ctx?.quotedMessage) {
          const qm = ctx.quotedMessage;
          replyPreview = qm?.conversation
            ?? qm?.extendedTextMessage?.text
            ?? (qm?.imageMessage ? "📷 Imagem" : null)
            ?? (qm?.videoMessage ? "🎬 Vídeo" : null)
            ?? (qm?.audioMessage ? "🎤 Áudio" : null)
            ?? (qm?.documentMessage ? "📄 Documento" : null)
            ?? null;
        }

        // Location / contact payloads
        let locationJson: any = null;
        if (locationMsg) {
          locationJson = {
            lat: locationMsg?.degreesLatitude,
            lng: locationMsg?.degreesLongitude,
            name: locationMsg?.name || null,
            address: locationMsg?.address || null,
          };
        }
        let contactJson: any = null;
        if (contactMsg) {
          contactJson = {
            name: contactMsg?.displayName || null,
            vcard: contactMsg?.vcard || null,
            contacts: contactMsg?.contacts || null,
          };
        }

        const phone = onlyDigits(remoteJid.split("@")[0]);
        if (!phone) continue;

        let conv = await findConversation(tenantId, remoteJid, phone);

        const preview = text
          || (tipo === "audio" ? "🎤 Áudio"
            : tipo === "image" ? "📷 Imagem"
            : tipo === "video" ? "🎬 Vídeo"
            : tipo === "document" ? "📄 Documento"
            : tipo === "sticker" ? "😊 Figurinha"
            : tipo === "location" ? "📍 Localização"
            : tipo === "contact" ? "👤 Contato"
            : unsupportedMessageType ? "Mensagem não suportada"
            : `[${tipo}]`);
        const messageCreatedAt = extractMessageCreatedAt(m);
        const shouldUpdateConversationPreview = !conv?.ultima_interacao
          || new Date(messageCreatedAt).getTime() >= new Date(conv.ultima_interacao).getTime();

        if (!conv) {
          // For unresolved @lid, avoid storing the LID digits as nome_contato — that
          // creates noisy fake "pushNames" that never match a real contact.
          const initialName = isPendingLid ? (pushName || null) : (pushName || phone);
          const ins = await admin.from("conversations").insert({
            tenant_id: tenantId,
            telefone: phone,
            remote_jid: remoteJid,
            nome_contato: initialName,
            provider: "evolution",
            ultima_mensagem: preview,
            ultima_interacao: messageCreatedAt,
            nao_lidas: fromMe || isHistorySet ? 0 : 1,
            needs_lid_review: isPendingLid,
            lid_review_notes: isPendingLid ? "unresolved @lid — aguardando pushName ou reconciliação" : null,
          }).select("id, nao_lidas, remote_jid, telefone").maybeSingle();
          conv = ins.data;
          if (!conv && ins.error) {
            conv = await findConversation(tenantId, remoteJid, phone);
          }

          // Auto-create lead (tenant scope, inbound only, skip while pending @lid
          // because the "phone" is a lid id, not a real MSISDN).
          if (!fromMe && tenantId && !isPendingLid) {
            try {
              const { data: existingLead } = await admin
                .from("leads")
                .select("id").eq("tenant_id", tenantId).eq("whatsapp", phone)
                .limit(1).maybeSingle();
              if (!existingLead) {
                await admin.from("leads").insert({
                  tenant_id: tenantId,
                  nome_completo: pushName || phone,
                  whatsapp: phone, origem: "whatsapp",
                  status: "lead", is_organic: true,
                  observacoes: "Lead criado automaticamente via WhatsApp",
                });
              }
            } catch (e) { console.error("[wa auto-lead]", e); }
          }
        } else {
          await admin.from("conversations").update({
            ...(shouldUpdateConversationPreview ? {
              ultima_mensagem: preview,
              ultima_interacao: messageCreatedAt,
            } : {}),
            nao_lidas: fromMe || isHistorySet ? conv.nao_lidas : (conv.nao_lidas ?? 0) + 1,
            telefone: phone,
            remote_jid: remoteJid,
            nome_contato: !fromMe && pushName ? pushName : undefined,
          }).eq("id", conv.id);
        }

        // Root-cause hardening #2: when this message is on a KNOWN canonical
        // conversation, opportunistically resolve any pending @lid siblings by
        // pushName. This makes merges independent of CONTACTS_UPDATE arriving.
        if (!isPendingLid && pushName) {
          await tryResolveByPushNameFromCanonical(tenantId, instanceName || null, remoteJid, pushName);
        }

        if (!conv?.id) continue;

        // Dedup: by wamid first, then by (conversation + sender + content + 10s window)
        if (wamid) {
          const dup = await admin.from("messages").select("id").eq("wamid", wamid).maybeSingle();
          if (dup.data) continue;
        }
        if (fromMe && text) {
          const since = new Date(Date.now() - 15000).toISOString();
          const dup2 = await admin.from("messages")
            .select("id")
            .eq("conversation_id", conv.id)
            .eq("sender", "usuario")
            .eq("conteudo", text)
            .gte("created_at", since)
            .limit(1).maybeSingle();
          if (dup2.data) {
            // Attach the wamid to the existing outbound row so future ACKs match.
            if (wamid) {
              await admin.from("messages").update({ wamid, status: "delivered" }).eq("id", dup2.data.id);
            }
            continue;
          }
        }

        let media_url: string | null = null;
        let media_mime: string | null = null;
        const isMedia = ["image","audio","video","document","sticker"].includes(tipo);
        if (isMedia && conn) {
          const r = await fetchAndStoreMedia(conn as any, m, tipo);
          media_url = r.url; media_mime = r.mime;
        }

        await admin.from("messages").insert({
          conversation_id: conv.id,
          sender: fromMe ? "usuario" : "cliente",
          conteudo: text || preview,
          tipo: tipo === "sticker" || tipo === "location" || tipo === "contact" ? "text" : tipo,
          media_type: isMedia ? tipo : null,
          media_url, media_mime,
          direction: fromMe ? "outbound" : "inbound",
          status: fromMe ? "sent" : "delivered",
          wamid,
          reply_to_wamid: replyToWamid,
          reply_preview: replyPreview,
          location: locationJson,
          contact_card: contactJson,
          tenant_id: tenantId,
          created_at: messageCreatedAt,
          metadata: {
            raw_key: extractRawKeySnapshot(key, m, fromMe),
            own_jids: Array.from(ownJids),
             ...(unsupportedMessageType ? { unsupported_message_type: unsupportedMessageType } : {}),
            ...(isPendingLid ? { pending_lid_resolution: true, raw_lid: rawRemoteJid } : {}),
          },

        });

        // Fire automation dispatcher for inbound text messages (best-effort, non-blocking)
        if (!fromMe && text && !isPendingLid) {
          try {
            fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/automation-dispatch`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SERVICE_KEY}`,
              },
              body: JSON.stringify({
                trigger: "message_received",
                tenant_id: tenantId,
                context: {
                  phone, name: pushName || phone, text,
                  button_id: buttonReplyId || listReplyId || null,
                  conversation_id: conv.id, wamid,
                },

              }),
            }).catch(() => {});
          } catch (_) { /* ignore */ }
        }
      }
    }



    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[whatsapp-webhook]", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
