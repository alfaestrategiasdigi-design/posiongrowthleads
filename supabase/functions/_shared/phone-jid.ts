// Shared JID / phone-plausibility helpers.
//
// Used by every writer to whatsapp_jid_aliases so all four ingestion paths
// (whatsapp-webhook, evolution-sync-contacts, whatsapp-lid-merge and
// whatsapp-lid-reconcile) share the SAME plausibility rule. A previous fix
// only hardened the webhook, which let the other three paths keep writing
// aliases like `914469@s.whatsapp.net` (6 digits) and re-spawn "chat órfão"
// conversations on outbound-from-another-device.
//
// Rule: a real WhatsApp phone JID is E.164 (country code + national). At
// minimum 11 digits, at most 15, and never starts with "0". Anything else
// (LID pn digits, message IDs, truncated internal keys) is an opaque
// identifier and MUST NOT be persisted as `<digits>@s.whatsapp.net`.

export function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

export function isPlausiblePhoneDigits(digits: string): boolean {
  if (!digits) return false;
  if (digits.startsWith("0")) return false;
  return digits.length >= 11 && digits.length <= 15;
}

/** True when `phoneJid` is a `<digits>@s.whatsapp.net` with plausible E.164 digits. */
export function isTrustworthyPhoneJid(phoneJid: string | null | undefined): boolean {
  if (!phoneJid) return false;
  if (phoneJid.includes("@lid")) return false;
  if (!phoneJid.includes("@s.whatsapp.net")) return false;
  return isPlausiblePhoneDigits(onlyDigits(phoneJid.split("@")[0]));
}
