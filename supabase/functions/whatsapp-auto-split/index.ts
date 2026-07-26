// Automatic guard-rail for poisoned WhatsApp conversations.
// Scans recent outbound messages, compares the recipient evidence stored from
// the original Evolution key with the conversation where the message landed,
// then delegates suspicious conversations to the authoritative split routine.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const onlyDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");

function normalizeJid(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const digits = onlyDigits(raw.split("@")[0]);
  if (!digits) return null;
  if (raw.includes("@lid")) return `${digits}@lid`;
  if (digits.length < 10 || digits.length > 15 || digits.startsWith("0")) return null;
  return `${digits}@s.whatsapp.net`;
}

async function authorize(req: Request): Promise<boolean> {
  const auth = req.headers.get("Authorization") ?? "";
  const bearer = auth.replace(/^Bearer\s+/i, "").trim();
  const cronToken = req.headers.get("x-cron-token") ?? "";
  if (bearer === SERVICE_KEY) return true;
  const { data } = await admin.from("edge_internal_config")
    .select("dispatch_token").eq("id", 1).maybeSingle();
  const internal = String(data?.dispatch_token ?? "");
  if (internal && (bearer === internal || cronToken === internal)) return true;
  if (!bearer) return false;
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await userClient.auth.getUser(bearer);
  if (!userData?.user?.id) return false;
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: userData.user.id,
    _role: "admin",
  });
  return Boolean(isAdmin);
}

function recipientEvidence(metadata: any): Set<string> {
  const raw = metadata?.raw_key ?? {};
  const own = new Set<string>((metadata?.own_jids ?? []).map(normalizeJid).filter(Boolean));
  const values = [
    raw.remoteJidAlt, raw.participantAlt, raw.senderPn,
    raw.remoteJid, raw.participant,
  ];
  const out = new Set<string>();
  for (const value of values) {
    const jid = normalizeJid(value);
    if (jid && !own.has(jid)) out.add(jid);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!(await authorize(req))) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const sinceHours = Math.max(1, Math.min(Number(body?.since_hours ?? 24), 168));
  const scanLimit = Math.max(20, Math.min(Number(body?.scan_limit ?? 1000), 3000));
  const maxConversations = Math.max(1, Math.min(Number(body?.max_conversations ?? 8), 20));
  const deadline = Date.now() + 120_000;
  const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();

  const { data: messages, error } = await admin.from("messages")
    .select("conversation_id, metadata, conversations(id, remote_jid, telefone)")
    .eq("direction", "outbound")
    .not("wamid", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(scanLimit);
  if (error) return json({ error: "Falha ao inspecionar mensagens", detail: error.message }, 500);

  const suspicious = new Set<string>();
  for (const row of messages ?? []) {
    const conv = Array.isArray((row as any).conversations)
      ? (row as any).conversations[0]
      : (row as any).conversations;
    if (!conv?.id) continue;
    const current = normalizeJid(conv.remote_jid ?? conv.telefone);
    const evidence = recipientEvidence((row as any).metadata);
    if (current && evidence.size > 0 && !evidence.has(current)) suspicious.add(conv.id);
    if (suspicious.size >= maxConversations) break;
  }

  const results: unknown[] = [];
  for (const conversationId of suspicious) {
    if (Date.now() >= deadline) {
      results.push({ conversation_id: conversationId, skipped: "deadline" });
      continue;
    }
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-split-poisoned-conversation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SERVICE_KEY}`,
        },
        body: JSON.stringify({ conversation_id: conversationId, dry_run: false, limit: 500 }),
        signal: AbortSignal.timeout(Math.max(5_000, deadline - Date.now())),
      });
      const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      results.push(result);
    } catch (cause) {
      results.push({ conversation_id: conversationId, error: String(cause) });
    }
  }

  return json({
    ok: true,
    scanned_messages: messages?.length ?? 0,
    suspicious_conversations: suspicious.size,
    processed: results.length,
    results,
  });
});