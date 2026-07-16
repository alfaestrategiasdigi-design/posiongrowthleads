import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return json({ error: "missing_token" }, 401);
    }
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: "invalid_token" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    // Accept either `tenant_id` (uuid) or `target: "master"` to migrate into the
    // admin master (tenant_id NULL). This keeps environments strictly isolated.
    const rawTenant = body?.tenant_id;
    const targetFlag = String(body?.target ?? "").toLowerCase();
    const isMasterTarget = targetFlag === "master" || rawTenant === null;
    const tenantId: string | null = isMasterTarget ? null : String(rawTenant ?? "").trim() || null;
    const dryRun: boolean = body?.dry_run !== false;
    if (!isMasterTarget && !tenantId) return json({ error: "missing_tenant_id" }, 400);

    const { data: isSuper } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    let authorized = Boolean(isSuper);
    if (!authorized && tenantId) {
      const { data: isTenantAdmin } = await admin.rpc("is_tenant_admin", { _user_id: userId, _tenant_id: tenantId });
      authorized = Boolean(isTenantAdmin);
    }
    // Master target always requires super admin.
    if (isMasterTarget && !isSuper) authorized = false;
    if (!authorized) return json({ error: "forbidden" }, 403);

    // Load verified numbers scoped to the SAME environment.
    let numQ = admin
      .from("tenant_whatsapp_numbers")
      .select("phone_e164, status");
    numQ = tenantId ? numQ.eq("tenant_id", tenantId) : numQ.is("tenant_id", null);
    const { data: nums } = await numQ;
    const digitsList = (nums || [])
      .filter((n: any) => n.status === "verified")
      .map((n: any) => String(n.phone_e164));
    if (digitsList.length === 0) {
      return json({
        dry_run: dryRun,
        error: "no_verified_numbers",
        message: "Cadastre e valide ao menos um número neste ambiente antes de migrar.",
      }, 200);
    }

    const jidVariants = digitsList.map((d) => `${d}@s.whatsapp.net`);

    // Find messages whose own_jids matches ANY of the verified numbers AND
    // whose tenant_id is DIFFERENT from the target environment.
    const conversationIds = new Set<string>();
    let messagesFound = 0;
    for (const jid of jidVariants) {
      // Case A: rows in some other tenant
      let q = admin
        .from("messages")
        .select("id, conversation_id, tenant_id")
        .contains("metadata", { own_jids: [jid] })
        .limit(5000);
      q = tenantId ? q.or(`tenant_id.neq.${tenantId},tenant_id.is.null`) : q.not("tenant_id", "is", null);
      const { data: msgs, error } = await q;
      if (error) { console.error("[reassign] messages query", error); continue; }
      for (const m of msgs || []) {
        // Guard: same-env rows must be skipped even if the OR pattern was too broad
        const sameEnv = tenantId ? m.tenant_id === tenantId : m.tenant_id === null;
        if (sameEnv) continue;
        messagesFound++;
        if (m.conversation_id) conversationIds.add(m.conversation_id);
      }
    }

    const convIds = Array.from(conversationIds);
    const preview = {
      dry_run: dryRun,
      target: tenantId ?? "master",
      target_tenant_id: tenantId,
      matched_numbers: digitsList,
      messages_found: messagesFound,
      conversations_found: convIds.length,
    };

    if (dryRun || convIds.length === 0) {
      return json(preview, 200);
    }

    let convMoved = 0;
    let msgMoved = 0;
    for (let i = 0; i < convIds.length; i += 200) {
      const chunk = convIds.slice(i, i + 200);
      const { error: convErr, count: cc } = await admin
        .from("conversations")
        .update({ tenant_id: tenantId }, { count: "exact" })
        .in("id", chunk);
      if (convErr) { console.error("[reassign] conv update", convErr); continue; }
      convMoved += cc || 0;
      const { error: msgErr, count: mc } = await admin
        .from("messages")
        .update({ tenant_id: tenantId }, { count: "exact" })
        .in("conversation_id", chunk);
      if (msgErr) { console.error("[reassign] msg update", msgErr); continue; }
      msgMoved += mc || 0;
    }

    return json({ ...preview, applied: true, conversations_moved: convMoved, messages_moved: msgMoved }, 200);
  } catch (e) {
    console.error("[whatsapp-reassign-by-owner]", e);
    return json({ error: "internal_error", message: String(e) }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
