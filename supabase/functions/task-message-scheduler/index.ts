// Sends scheduled WhatsApp messages defined in lead_tasks (task_type='mensagem').
// Runs via pg_cron every 5 minutes. Also callable manually with the same auth
// pattern used in other scheduler functions (SERVICE_ROLE_KEY, dispatch_token,
// X-Cron-Token, or an admin user JWT).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function normalizeBase(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return s.replace(/\/+$/, "");
  }
}

let cachedDispatchToken: { value: string; expiresAt: number } | null = null;
async function getDispatchToken(admin: any): Promise<string | null> {
  if (cachedDispatchToken && cachedDispatchToken.expiresAt > Date.now())
    return cachedDispatchToken.value;
  const { data } = await admin
    .from("edge_internal_config")
    .select("dispatch_token")
    .eq("id", 1)
    .maybeSingle();
  const value = (data as any)?.dispatch_token ?? null;
  if (value) cachedDispatchToken = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

async function authorize(
  req: Request,
  admin: any,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronToken =
    req.headers.get("x-cron-token") ?? req.headers.get("X-Cron-Token");
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const internal = await getDispatchToken(admin);
  if (cronToken && internal && cronToken === internal) return { ok: true };
  if (bearer && bearer === SERVICE_KEY) return { ok: true };
  if (bearer && internal && bearer === internal) return { ok: true };
  if (!bearer) return { ok: false, status: 401, error: "Unauthorized" };
  try {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser(bearer);
    const userId = userRes?.user?.id;
    if (!userId) return { ok: false, status: 401, error: "Unauthorized" };
    const { data: isAdmin } = await admin.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (!isAdmin) return { ok: false, status: 403, error: "forbidden" };
    return { ok: true };
  } catch {
    return { ok: false, status: 401, error: "invalid_token" };
  }
}

function digitsOnly(v: string | null | undefined): string {
  return (v ?? "").replace(/\D/g, "");
}

function toJid(phone: string): string {
  const digits = digitsOnly(phone);
  const withCc = digits.length <= 11 ? "55" + digits : digits;
  return `${withCc}@s.whatsapp.net`;
}

function computeNextSend(
  frequency: string,
  fromIso: string,
): string | null {
  const d = new Date(fromIso);
  if (isNaN(d.getTime())) return null;
  switch (frequency) {
    case "daily":
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString();
    case "weekly":
      d.setUTCDate(d.getUTCDate() + 7);
      return d.toISOString();
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      return d.toISOString();
    default:
      return null;
  }
}

function interpolate(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k) => ctx[k] ?? "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const auth = await authorize(req, admin);
  if (!auth.ok) return json({ error: auth.error }, auth.status ?? 401);

  const nowIso = new Date().toISOString();
  const { data: tasks, error } = await admin
    .from("lead_tasks")
    .select("*")
    .eq("task_type", "mensagem")
    .eq("done", false)
    .not("next_send_at", "is", null)
    .lte("next_send_at", nowIso)
    .limit(50);

  if (error) return json({ error: error.message }, 500);
  if (!tasks || tasks.length === 0)
    return json({ ok: true, processed: 0, sent: 0 });

  let sent = 0;
  let failed = 0;
  const details: any[] = [];

  for (const task of tasks as any[]) {
    try {
      // Resolve target phone + lead
      let phone = task.phone as string | null;
      let leadName = "";
      let leadRow: any = null;
      let tenantId = task.tenant_id as string | null;

      if (task.lead_id) {
        const { data: lead } = await admin
          .from("leads")
          .select(
            "id, tenant_id, nome_completo, whatsapp, email, nome_empresa",
          )
          .eq("id", task.lead_id)
          .maybeSingle();
        if (lead) {
          leadRow = lead;
          tenantId = tenantId ?? lead.tenant_id;
          leadName = lead.nome_completo ?? "";
          phone = phone || lead.whatsapp;
        }
      }
      if (!phone) {
        details.push({ task_id: task.id, skipped: "no_phone" });
        continue;
      }
      const body = interpolate(String(task.message_body ?? task.title ?? ""), {
        "lead.nome": leadName || "",
        "lead.primeiro_nome": (leadName || "").split(" ")[0] || "",
        "lead.empresa": leadRow?.nome_empresa ?? "",
      }).trim();
      if (!body) {
        details.push({ task_id: task.id, skipped: "empty_body" });
        continue;
      }

      // Find Evolution connection matching tenant (nullable for master)
      let connQ = admin
        .from("zapi_connections")
        .select("instance_url, api_key, instance_name, webhook_secret, tenant_id")
        .eq("provider", "evolution");
      connQ = tenantId ? connQ.eq("tenant_id", tenantId) : connQ.is("tenant_id", null);
      const { data: conn } = await connQ
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!conn?.instance_url || !conn?.instance_name || !conn?.api_key) {
        details.push({ task_id: task.id, skipped: "no_instance" });
        failed++;
        continue;
      }

      const base = normalizeBase(conn.instance_url);
      const jid = toJid(phone);
      const r = await fetch(
        `${base}/message/sendText/${encodeURIComponent(conn.instance_name)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: conn.api_key },
          body: JSON.stringify({ number: jid, text: body }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        details.push({ task_id: task.id, error: `send_${r.status}`, detail: t.slice(0, 200) });
        failed++;
        continue;
      }
      sent++;

      // Advance schedule / mark done
      const patch: any = { last_sent_at: nowIso };
      if (task.frequency && task.frequency !== "once") {
        const next = computeNextSend(task.frequency, task.next_send_at ?? nowIso);
        patch.next_send_at = next;
      } else {
        patch.done = true;
        patch.next_send_at = null;
      }
      await admin.from("lead_tasks").update(patch).eq("id", task.id);
      details.push({ task_id: task.id, sent: true });
    } catch (e) {
      failed++;
      details.push({ task_id: task.id, error: String(e) });
    }
  }

  return json({ ok: true, processed: tasks.length, sent, failed, details });
});
