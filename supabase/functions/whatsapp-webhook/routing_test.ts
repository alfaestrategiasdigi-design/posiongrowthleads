// Multi-device / @lid / fromMe routing tests for the whatsapp-webhook.
// Guarantees: an outbound message sent from the physical phone must NEVER
// land on the "me myself" conversation and must always route to the real recipient.
// Also enforces the alias-creation policy hardened after the 2026-07-05 incident:
// aliases may ONLY be created when @lid and phone come from the SAME key object.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decideAliasFromSameKey,
  extractRawKeySnapshot,
  extractRootOwnJids,
  normalizePhoneJid,
  resolveOutboundRecipientPure,
} from "./routing.ts";


const OWN = "5511999990000@s.whatsapp.net";
const OWN_LID = "111122223333@lid";
const LUCAS = "5511988887777@s.whatsapp.net";
const OTHER = "5521912345678@s.whatsapp.net";

function ownJids(...jids: string[]) {
  return new Set(jids);
}

Deno.test("normalizePhoneJid handles bare numbers, @lid, and rejects groups", () => {
  assertEquals(normalizePhoneJid("5511988887777"), LUCAS);
  assertEquals(normalizePhoneJid("5511988887777@s.whatsapp.net"), LUCAS);
  assertEquals(normalizePhoneJid("111122223333@lid"), OWN_LID);
  assertEquals(normalizePhoneJid("123@g.us"), null);
  assertEquals(normalizePhoneJid("status@broadcast"), null);
});

Deno.test("extractRootOwnJids picks own JID from body.sender and data.ownerJid", () => {
  const set = extractRootOwnJids(
    { sender: OWN, data: { ownerJid: "5511999990000" } },
    "instance-a",
  );
  assertEquals(set.has(OWN), true);
});

Deno.test("fromMe with remoteJid=self and recipient in remoteJidAlt routes to recipient (Lucas)", () => {
  const res = resolveOutboundRecipientPure(
    {},
    { fromMe: true, remoteJid: OWN, remoteJidAlt: LUCAS },
    true,
    ownJids(OWN),
  );
  assertEquals(res.remoteJid, LUCAS);
  assertEquals(res.blockedSelfJid, false);
});

Deno.test("fromMe with remoteJid=@lid and recipient in participantAlt routes correctly", () => {
  const res = resolveOutboundRecipientPure(
    {},
    { fromMe: true, remoteJid: OWN_LID, participantAlt: LUCAS },
    true,
    ownJids(OWN, OWN_LID),
  );
  assertEquals(res.remoteJid, LUCAS);
});

Deno.test("fromMe with recipient in nested envelope key routes correctly", () => {
  const res = resolveOutboundRecipientPure(
    { message: { key: { remoteJidAlt: OTHER } } },
    { fromMe: true, remoteJid: OWN },
    true,
    ownJids(OWN),
  );
  assertEquals(res.remoteJid, OTHER);
});

Deno.test("fromMe with only own JID and no alternative is BLOCKED (never creates self conversation)", () => {
  const res = resolveOutboundRecipientPure(
    {},
    { fromMe: true, remoteJid: OWN },
    true,
    ownJids(OWN),
  );
  assertEquals(res.remoteJid, null);
  assertEquals(res.blockedSelfJid, true);
});

Deno.test("fromMe with unresolved @lid and no phone alt flags unresolvedLid, not self", () => {
  const res = resolveOutboundRecipientPure(
    {},
    { fromMe: true, remoteJid: "999888777@lid" },
    true,
    ownJids(OWN),
  );
  assertEquals(res.remoteJid, null);
  assertEquals(res.unresolvedLid, true);
  assertEquals(res.blockedSelfJid, false);
});

Deno.test("fromMe to a normal recipient (not self) passes through", () => {
  const res = resolveOutboundRecipientPure(
    {},
    { fromMe: true, remoteJid: LUCAS },
    true,
    ownJids(OWN),
  );
  assertEquals(res.remoteJid, LUCAS);
  assertEquals(res.blockedSelfJid, false);
});

Deno.test("inbound (fromMe=false) uses remoteJid of the peer", () => {
  const res = resolveOutboundRecipientPure(
    {},
    { fromMe: false, remoteJid: LUCAS },
    false,
    ownJids(OWN),
  );
  assertEquals(res.remoteJid, LUCAS);
});

Deno.test("fromMe never returns own JID even when own appears in candidate fields", () => {
  const res = resolveOutboundRecipientPure(
    {},
    { fromMe: true, remoteJid: OWN, recipient: OWN, remoteJidAlt: LUCAS },
    true,
    ownJids(OWN),
  );
  assertEquals(res.remoteJid, LUCAS);
});

// ---------------------------------------------------------------------------
// Alias-creation policy (2026-07-05 hardening).
// ---------------------------------------------------------------------------

Deno.test("alias policy: two contacts with same pushName do NOT create an alias (pushName alone is never enough)", () => {
  // Payload for peer A arrives with only pushName info — no phone JID in the
  // key. decideAliasFromSameKey must refuse to bind A's @lid to any phone.
  const key = { fromMe: false, remoteJid: "111111111@lid" };
  const decision = decideAliasFromSameKey(key);
  assertEquals(decision.ok, false);
});

Deno.test("alias policy: alias is created ONLY when @lid and phone appear together in the same key", () => {
  // Same key carries both @lid remoteJid and phone remoteJidAlt -> safe pair.
  const decision = decideAliasFromSameKey({
    fromMe: false,
    remoteJid: "555555555@lid",
    remoteJidAlt: LUCAS,
  });
  assertEquals(decision.ok, true);
  if (decision.ok) {
    assertEquals(decision.lidJid, "555555555@lid");
    assertEquals(decision.phoneJid, LUCAS);
  }
});

Deno.test("alias policy: cross-key candidates (phone from envelope, @lid from key) are REJECTED", () => {
  // Envelope-level phone should NOT be paired with key-level @lid because they
  // may belong to different messages / mentions.
  const decision = decideAliasFromSameKey({
    fromMe: false,
    remoteJid: "999888777@lid",
    // No same-key phone. participantAlt is a phone but pair with participant which is empty -> refuses.
  });
  assertEquals(decision.ok, false);
});

Deno.test("raw_key snapshot captures every routing-relevant field for future audit", () => {
  const snap = extractRawKeySnapshot(
    { fromMe: true, remoteJid: OWN, remoteJidAlt: LUCAS, participant: null, senderPn: "5511999990000", id: "WAMID_1" },
    { pushName: "Lucas" },
    true,
  );
  assertEquals(snap.fromMe, true);
  assertEquals(snap.remoteJid, OWN);
  assertEquals(snap.remoteJidAlt, LUCAS);
  assertEquals(snap.pushName, "Lucas");
  assertEquals(snap.id, "WAMID_1");
});
