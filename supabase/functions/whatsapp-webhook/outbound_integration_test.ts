// E2E regression suite for outbound-from-other-device (fromMe=true) flow.
//
// Locks in the fix for the "chat paralelo" bug: an outbound message from a
// physical phone to a contact without a trustworthy alias used to spawn a
// conversation with a truncated `<digits>@s.whatsapp.net` remote_jid
// (e.g. "9740540@s.whatsapp.net", "01807406@s.whatsapp.net"). The fix
// forces those cases into a provisional `@lid` conversation, reconciled
// later when the authoritative pair arrives.
//
// This file tests the invariants at the pure-function layer where the fix
// actually lives (routing.ts + _shared/phone-jid.ts + decideAliasFromSameKey).
// A regression in any of the 5 scenarios below MUST make one of these tests
// fail — no production code is refactored to make them pass.
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  collectInboundPeerCandidates,
  collectOutboundPeerCandidates,
  decideAliasFromSameKey,
  firstLidJid,
  firstStandardJid,
  normalizePhoneJid,
  resolveOutboundRecipientPure,
} from "./routing.ts";
import {
  isPlausiblePhoneDigits,
  isTrustworthyPhoneJid,
  onlyDigits,
} from "../_shared/phone-jid.ts";

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------
const TENANT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OWN_PHONE = "5511999990000@s.whatsapp.net";
const OWN_LID = "111122223333@lid";
const LEAD_LID = "888777666555@lid";
const LEAD_PHONE = "5577999032433@s.whatsapp.net";
const OTHER_LID = "444333222111@lid";

// Payload shapes mirror the fields the webhook actually reads. Kept minimal
// on purpose — every branch under test only cares about `key` + fromMe.
function outboundLidPayload(opts: {
  ownJid: string;
  lidJid: string;
  extraKey?: Record<string, unknown>;
  message?: Record<string, unknown>;
}) {
  const key = {
    fromMe: true,
    remoteJid: opts.lidJid,
    id: "3EB0" + Math.random().toString(16).slice(2, 10).toUpperCase(),
    ...(opts.extraKey ?? {}),
  };
  return { key, message: opts.message ?? {} };
}

// -----------------------------------------------------------------------------
// Cenário 1 — outbound sem alias cai em conversa provisória @lid
// -----------------------------------------------------------------------------
Deno.test("scenario 1: fromMe with only @lid remoteJid resolves as unresolved @lid (never truncated phone)", () => {
  const { key, message } = outboundLidPayload({ ownJid: OWN_PHONE, lidJid: LEAD_LID });
  const res = resolveOutboundRecipientPure(message, key, true, new Set([OWN_PHONE]));

  // Never invents a phone JID out of thin air.
  assertEquals(res.remoteJid, null, "outbound sem alias não deve inventar remoteJid");
  assertEquals(res.unresolvedLid, true, "deve sinalizar unresolvedLid para o fallback provisório");
  assertEquals(res.blockedSelfJid, false);
  // The @lid must be preserved so the caller can create a provisional row.
  assertEquals(res.rawRemoteJid, LEAD_LID);
});

Deno.test("scenario 1: no phone JID is salvageable from the payload — firstStandardJid returns null", () => {
  const { key, message } = outboundLidPayload({ ownJid: OWN_PHONE, lidJid: LEAD_LID });
  const outbound = collectOutboundPeerCandidates(message, key);
  const std = firstStandardJid(outbound, new Set([OWN_PHONE]));
  const lid = firstLidJid([...outbound, key.remoteJid], new Set([OWN_PHONE]));
  assertEquals(std, null);
  assertEquals(lid, LEAD_LID);
});

// -----------------------------------------------------------------------------
// Cenário 2 — telefones truncados / implausíveis são rejeitados
// -----------------------------------------------------------------------------
const truncated = ["9740540", "01807406", "8812944955", "914469", "820946", "0"];

for (const raw of truncated) {
  Deno.test(`scenario 2: implausible phone "${raw}" is rejected by normalizePhoneJid`, () => {
    assertEquals(normalizePhoneJid(raw), null);
    assertEquals(normalizePhoneJid(`${raw}@s.whatsapp.net`), null);
    assertFalse(isPlausiblePhoneDigits(onlyDigits(raw)));
    assertFalse(isTrustworthyPhoneJid(`${raw}@s.whatsapp.net`));
  });
}

Deno.test("scenario 2: fromMe with only a truncated phone in remoteJidAlt does NOT resolve to that phone", () => {
  const { key, message } = outboundLidPayload({
    ownJid: OWN_PHONE,
    lidJid: LEAD_LID,
    extraKey: { remoteJidAlt: "9740540" }, // truncado
  });
  const res = resolveOutboundRecipientPure(message, key, true, new Set([OWN_PHONE]));
  assertEquals(res.remoteJid, null, "não pode aceitar telefone truncado como recipiente");
  assertEquals(res.unresolvedLid, true, "deve degradar para provisório @lid");
});

Deno.test("scenario 2: fromMe with ONLY implausible phone candidates (no @lid) collapses to null (message must be dropped upstream)", () => {
  const key = {
    fromMe: true,
    remoteJid: "9740540@s.whatsapp.net", // implausível
    remoteJidAlt: "01807406",
    id: "3EB0AAAA",
  };
  const res = resolveOutboundRecipientPure({}, key, true, new Set([OWN_PHONE]));
  // Neither a standard nor a @lid can be salvaged. remoteJid must be null so
  // the handler drops the message instead of creating a truncated conversation.
  assertEquals(res.remoteJid, null);
  assertEquals(res.unresolvedLid, false);
  assertFalse(isTrustworthyPhoneJid(String(key.remoteJid)));
});

Deno.test("scenario 2: plausible phone still passes (guard doesn't over-reject)", () => {
  assertEquals(normalizePhoneJid("5577999032433"), LEAD_PHONE);
  assert(isTrustworthyPhoneJid(LEAD_PHONE));
  assert(isPlausiblePhoneDigits("5577999032433"));
});

// -----------------------------------------------------------------------------
// Cenário 3 — renomeação posterior via same-key pair (sem duplicata)
// -----------------------------------------------------------------------------
Deno.test("scenario 3: same-key contacts.update with (@lid + phone) yields a trustworthy pair for merge", () => {
  // The alias-creation policy: only accept the pair when BOTH sides come from
  // the SAME key object (protects against the 2026-07-05 cross-glue incident).
  const key = {
    remoteJid: LEAD_LID,
    remoteJidAlt: "5577999032433", // phone recebido no MESMO key
  };
  const decision = decideAliasFromSameKey(key);
  assertEquals(decision.ok, true);
  if (decision.ok) {
    assertEquals(decision.lidJid, LEAD_LID);
    assertEquals(decision.phoneJid, LEAD_PHONE);
    assert(isTrustworthyPhoneJid(decision.phoneJid), "phoneJid do par deve ser confiável");
  }
});

Deno.test("scenario 3: same-key pair with TRUNCATED phone is not upgraded (would leave provisional intact)", () => {
  const key = { remoteJid: LEAD_LID, remoteJidAlt: "9740540" };
  const decision = decideAliasFromSameKey(key);
  // The phone side is normalized to null by normalizePhoneJid, so no pair.
  assertEquals(decision.ok, false);
  if (!decision.ok) assertEquals(decision.reason, "no_same_key_pair");
});

Deno.test("scenario 3: after promotion, subsequent outbound with the phone as remoteJid resolves cleanly (no orphan)", () => {
  const key = { fromMe: true, remoteJid: LEAD_PHONE, id: "3EB0PROMOTED" };
  const res = resolveOutboundRecipientPure({}, key, true, new Set([OWN_PHONE]));
  assertEquals(res.remoteJid, LEAD_PHONE, "após promoção, outbound deve ir direto pra conversa canônica");
  assertEquals(res.unresolvedLid, false);
  assertEquals(res.blockedSelfJid, false);
});

// -----------------------------------------------------------------------------
// Cenário 4 — isolamento entre tenants
// -----------------------------------------------------------------------------
// A resolução pura de JID é tenant-agnóstica: quem escopa por tenant é o
// caller (queries em `whatsapp_jid_aliases` e `conversations` sempre filtram
// por `tenant_id`). O invariante testável no nível puro é que o mesmo @lid
// aparecendo em dois tenants distintos produz decisões independentes e não
// carrega informação cruzada.
Deno.test("scenario 4: same @lid resolves identically for tenants A and B — no cross-tenant state in pure layer", () => {
  const payload = outboundLidPayload({ ownJid: OWN_PHONE, lidJid: LEAD_LID });
  const resA = resolveOutboundRecipientPure(payload.message, payload.key, true, new Set([OWN_PHONE]));
  const resB = resolveOutboundRecipientPure(payload.message, payload.key, true, new Set([OWN_PHONE]));
  assertEquals(resA, resB);
  // The caller MUST attach its own tenantId when creating the row; the pure
  // resolver never emits a tenant field, so it cannot leak.
  assertFalse("tenantId" in (resA as unknown as Record<string, unknown>));
  assertFalse("tenant_id" in (resA as unknown as Record<string, unknown>));
});

Deno.test("scenario 4: own-JID sets are per-instance — a payload from tenant B's owner does not match tenant A's ownJids", () => {
  const OWN_B = "5511888880000@s.whatsapp.net";
  const key = { fromMe: true, remoteJid: OWN_B, remoteJidAlt: LEAD_PHONE, id: "x" };
  // Tenant A processes a payload that belongs to tenant B's instance:
  // its ownJids set doesn't include OWN_B, so remoteJid=OWN_B is treated as
  // a normal recipient and routed AS-IS — never blocked as "self" of tenant A.
  const resA = resolveOutboundRecipientPure({}, key, true, new Set([OWN_PHONE]));
  assertEquals(resA.remoteJid, LEAD_PHONE, "tenant A não conhece OWN_B, então usa o alt como recipiente");
  assertFalse(resA.blockedSelfJid);

  // Tenant B, com seu próprio ownJids, bloqueia corretamente OWN_B como self
  // e roteia para o phone alt.
  const resB = resolveOutboundRecipientPure({}, key, true, new Set([OWN_B]));
  assertEquals(resB.remoteJid, LEAD_PHONE);
});

// -----------------------------------------------------------------------------
// Cenário 5 — anti-merge por pushName (proteção do incidente de 05/07)
// -----------------------------------------------------------------------------
Deno.test("scenario 5: pushName alone NEVER produces an alias pair", () => {
  // Two distinct @lids arrive with identical pushName. Neither key contains a
  // same-key phone. `decideAliasFromSameKey` must refuse both.
  const key1 = { remoteJid: LEAD_LID, id: "m1" };
  const key2 = { remoteJid: OTHER_LID, id: "m2" };
  const d1 = decideAliasFromSameKey(key1);
  const d2 = decideAliasFromSameKey(key2);
  assertEquals(d1.ok, false);
  assertEquals(d2.ok, false);
});

Deno.test("scenario 5: two distinct @lids with same pushName remain separate at the routing layer", () => {
  // pushName lives in the message payload, not the key. The pure resolver
  // never consults it — this test locks the contract in place so a future
  // change that starts using pushName to bridge @lids would fail here.
  const p1 = outboundLidPayload({
    ownJid: OWN_PHONE,
    lidJid: LEAD_LID,
    message: { pushName: "Lucas" },
  });
  const p2 = outboundLidPayload({
    ownJid: OWN_PHONE,
    lidJid: OTHER_LID,
    message: { pushName: "Lucas" },
  });
  const r1 = resolveOutboundRecipientPure(p1.message, p1.key, true, new Set([OWN_PHONE]));
  const r2 = resolveOutboundRecipientPure(p2.message, p2.key, true, new Set([OWN_PHONE]));

  assertEquals(r1.rawRemoteJid, LEAD_LID);
  assertEquals(r2.rawRemoteJid, OTHER_LID);
  assert(r1.rawRemoteJid !== r2.rawRemoteJid, "@lids distintos não podem colapsar via pushName");
  assertEquals(r1.remoteJid, null);
  assertEquals(r2.remoteJid, null);
});

Deno.test("scenario 5: cross-key candidates (phone from one msg + @lid from another) do NOT form a pair", () => {
  // Simulates the 2026-07-05 pattern: cross-field candidates were being glued.
  // decideAliasFromSameKey enforces same-key locality — an "assembled" key
  // that mixes fields from unrelated messages must still be rejected unless
  // the pairing rule matches one of the whitelisted intra-key combinations.
  const key = {
    // Only remoteJid is set; nothing else in the SAME key object provides a phone.
    remoteJid: LEAD_LID,
    id: "cross",
  };
  const decision = decideAliasFromSameKey(key);
  assertEquals(decision.ok, false);
});

// -----------------------------------------------------------------------------
// Sanity: inbound path unaffected by outbound hardening
// -----------------------------------------------------------------------------
Deno.test("sanity: inbound with @lid + phone in senderPn resolves to canonical phone (unchanged)", () => {
  const key = { fromMe: false, remoteJid: LEAD_LID, senderPn: "5577999032433", id: "in1" };
  const res = resolveOutboundRecipientPure({}, key, false, new Set([OWN_PHONE]));
  assertEquals(res.remoteJid, LEAD_PHONE);
  const candidates = collectInboundPeerCandidates({}, key);
  assertEquals(firstStandardJid(candidates), LEAD_PHONE);
});
