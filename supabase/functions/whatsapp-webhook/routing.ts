// Pure routing helpers for the whatsapp-webhook edge function.
// Extracted so we can unit-test multi-device / @lid / fromMe scenarios
// without hitting Supabase or Evolution API.

export function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function normalizePhoneJid(value: unknown): string | null {
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

export function uniqueCandidates(candidates: unknown[]): unknown[] {
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

export function firstStandardJid(candidates: unknown[], exclude = new Set<string>()): string | null {
  for (const candidate of candidates) {
    const jid = normalizePhoneJid(candidate);
    if (jid && !jid.includes("@lid") && !exclude.has(jid)) return jid;
  }
  return null;
}

export function firstLidJid(candidates: unknown[], exclude = new Set<string>()): string | null {
  for (const candidate of candidates) {
    const jid = normalizePhoneJid(candidate);
    if (jid?.includes("@lid") && !exclude.has(jid)) return jid;
  }
  return null;
}

function collectFromKeys(source: any, keys: string[]): unknown[] {
  if (!source || typeof source !== "object") return [];
  const out: unknown[] = [];
  for (const key of keys) out.push(source?.[key]);
  return out;
}

export function collectOutboundPeerCandidates(row: any, key: any): unknown[] {
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

export function collectInboundPeerCandidates(row: any, key: any): unknown[] {
  const envelope = row?.message ?? {};
  const nested = row?.message?.message ?? {};
  const nestedKey = row?.message?.key ?? row?.message?.message?.key ?? {};
  return uniqueCandidates([
    key?.remoteJidAlt, key?.remoteJid_alt, key?.participantAlt, key?.participant_alt,
    envelope?.remoteJidAlt, envelope?.remoteJid_alt,
    nested?.remoteJidAlt, nested?.remoteJid_alt,
    nestedKey?.remoteJidAlt, nestedKey?.remoteJid_alt,
    key?.remoteJid, row?.remoteJid,
  ]);
}

export function extractRootOwnJids(body: any, instanceName: string): Set<string> {
  const own = new Set<string>();
  const roots = uniqueCandidates([
    body?.sender, body?.ownerJid, body?.owner, body?.wuid,
    body?.instanceOwner, body?.instance_owner,
    body?.data?.sender, body?.data?.ownerJid, body?.data?.owner, body?.data?.wuid,
  ]);
  for (const candidate of roots) {
    const raw = String(candidate ?? "").trim();
    if (!raw || raw === instanceName) continue;
    const jid = normalizePhoneJid(raw);
    const digits = onlyDigits(raw);
    if (jid && (raw.includes("@") || digits.length >= 10)) own.add(jid);
  }
  return own;
}

export type OutboundResolution = {
  remoteJid: string | null;
  rawRemoteJid: string | null;
  unresolvedLid: boolean;
  blockedSelfJid: boolean;
};

// Pure version of resolveRemoteJid — no DB, no alias lookup.
// Used to unit-test the "phone message must never land on self conversation" rule.
export function resolveOutboundRecipientPure(
  message: any,
  key: any,
  fromMe: boolean,
  ownJids: Set<string>,
): OutboundResolution {
  const rawRemoteJid = String(key?.remoteJid ?? message?.remoteJid ?? "").trim() || null;
  const normalizedRaw = normalizePhoneJid(rawRemoteJid);
  const rawIsOwn = Boolean(normalizedRaw && ownJids.has(normalizedRaw));

  const candidateList = fromMe
    ? [
      ...collectOutboundPeerCandidates(message, key),
      ...(rawIsOwn ? [] : [rawRemoteJid]),
    ]
    : collectInboundPeerCandidates(message, key);
  const candidates = uniqueCandidates(candidateList);

  const standard = firstStandardJid(candidates, fromMe ? ownJids : new Set());
  const lid = firstLidJid(candidates, fromMe ? ownJids : new Set());

  if (standard) return { remoteJid: standard, rawRemoteJid, unresolvedLid: false, blockedSelfJid: false };

  if (fromMe && rawIsOwn) {
    return { remoteJid: null, rawRemoteJid: lid ?? rawRemoteJid, unresolvedLid: Boolean(lid), blockedSelfJid: true };
}

// ---------------------------------------------------------------------------
// Alias-creation policy (hardening after 2026-07-05 Lucas incident).
//
// Rule: a (@lid, phone) alias may only be persisted when BOTH sides come
// from the SAME key object in the webhook payload. Cross-field candidates
// (e.g. @lid in remoteJid + phone in participantAlt of a different message)
// are ambiguous and were the root cause of multiple @lids being wrongly
// glued onto the same contact.
// ---------------------------------------------------------------------------
export type AliasPairDecision =
  | { ok: true; lidJid: string; phoneJid: string }
  | { ok: false; reason: string };

export function decideAliasFromSameKey(key: any): AliasPairDecision {
  if (!key || typeof key !== "object") return { ok: false, reason: "no_key" };
  const remote = normalizePhoneJid(key.remoteJid);
  const alt = normalizePhoneJid(key.remoteJidAlt ?? key.remoteJid_alt);
  const senderPn = normalizePhoneJid(key.senderPn ?? key.sender_pn);
  const participant = normalizePhoneJid(key.participant);
  const participantAlt = normalizePhoneJid(key.participantAlt ?? key.participant_alt);

  const isLid = (j: string | null) => Boolean(j?.includes("@lid"));
  const isPhone = (j: string | null) => Boolean(j && !j.includes("@lid"));

  // Same-key pair candidates: remoteJid + remoteJidAlt is the canonical one
  // Evolution/Baileys emits for @lid mapping. senderPn also arrives on the
  // same key for messages the sender identified themselves with.
  const pairs: Array<[string | null, string | null]> = [
    [remote, alt],
    [alt, remote],
    [remote, senderPn],
    [participant, participantAlt],
    [participantAlt, participant],
  ];
  for (const [a, b] of pairs) {
    if (isLid(a) && isPhone(b)) return { ok: true, lidJid: a as string, phoneJid: b as string };
  }
  return { ok: false, reason: "no_same_key_pair" };
}

// Snapshot of the raw key fields we persist on every stored message so
// misclassifications can be audited without depending on Evolution logs.
export function extractRawKeySnapshot(key: any, message: any, fromMe: boolean) {
  const safe = (v: unknown) => (v === undefined || v === null ? null : String(v));
  return {
    fromMe: Boolean(fromMe),
    remoteJid: safe(key?.remoteJid ?? message?.remoteJid),
    remoteJidAlt: safe(key?.remoteJidAlt ?? key?.remoteJid_alt),
    participant: safe(key?.participant ?? message?.participant),
    participantAlt: safe(key?.participantAlt ?? key?.participant_alt),
    senderPn: safe(key?.senderPn ?? key?.sender_pn),
    id: safe(key?.id ?? message?.id),
    pushName: safe(message?.pushName ?? message?.push_name),
  };
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
