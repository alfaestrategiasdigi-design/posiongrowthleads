import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function onlyDigits(s: string) {
  return String(s || "").replace(/\D/g, "");
}
function normalizeE164(s: string) {
  const d = onlyDigits(s);
  return d.length >= 10 ? d : null;
}
function extractOwnerJidFromInstances(payload: any, instanceName: string): string | null {
  const nodes: any[] = Array.isArray(payload) ? payload : [payload];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const name = String(node.instanceName ?? node.name ?? node.instance?.instanceName ?? node.instance?.name ?? "").trim();
    if (instanceName && name && name !== instanceName) continue;
    const candidates = [
      node.ownerJid, node.owner, node.wuid, node.jid,
      node.instance?.ownerJid, node.instance?.owner, node.instance?.wuid,
      node.instance?.profileId, node.profileId,
    ];
    for (const c of candidates) {
      const raw = String(c ?? "").trim();
      if (!raw) continue;
      const digits = onlyDigits(raw);
      if (digits.length >= 10) return digits;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "missing_token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "invalid_token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const numberId = String(body?.number_id ?? "").trim();
    if (!numberId) {
      return new Response(JSON.stringify({ error: "missing_number_id" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: rowErr } = await admin
      .from("tenant_whatsapp_numbers")
      .select("id, tenant_id, phone_e164, zapi_connection_id")
      .eq("id", numberId)
      .maybeSingle();
    if (rowErr || !row) {
      return new Response(JSON.stringify({ error: "not_found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Authorization: super admin OR tenant admin
    const { data: isSuper } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    let authorized = Boolean(isSuper);
    if (!authorized) {
      const { data: isTenantAdmin } = await admin.rpc("is_tenant_admin", { _user_id: userId, _tenant_id: row.tenant_id });
      authorized = Boolean(isTenantAdmin);
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load Evolution connection for the tenant
    const { data: conn } = await admin
      .from("zapi_connections")
      .select("id, instance_url, api_key, instance_name")
      .eq("tenant_id", row.tenant_id)
      .eq("provider", "evolution")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!conn?.instance_url || !conn?.api_key || !conn?.instance_name) {
      const result = { verified: false, reason: "no_evolution_connection" };
      await admin.from("tenant_whatsapp_numbers").update({
        status: "pending", last_check_at: new Date().toISOString(), last_check_result: result,
      }).eq("id", row.id);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const base = conn.instance_url.replace(/\/+$/, "");
    const attempts = [
      `${base}/instance/fetchInstances?instanceName=${encodeURIComponent(conn.instance_name)}`,
      `${base}/instance/fetchInstances`,
      `${base}/instance/connectionState/${encodeURIComponent(conn.instance_name)}`,
    ];

    let ownerDigits: string | null = null;
    let rawResp: any = null;
    for (const url of attempts) {
      try {
        const r = await fetch(url, {
          headers: { "Content-Type": "application/json", apikey: conn.api_key },
          signal: AbortSignal.timeout(6000),
        });
        const text = await r.text();
        if (!r.ok || !text) continue;
        try { rawResp = JSON.parse(text); } catch { rawResp = { raw: text }; }
        ownerDigits = extractOwnerJidFromInstances(rawResp, conn.instance_name);
        if (ownerDigits) break;
      } catch { /* try next */ }
    }

    const expected = normalizeE164(row.phone_e164);
    const matches = ownerDigits && expected && ownerDigits.endsWith(expected.slice(-11));
    const nowIso = new Date().toISOString();
    const result = {
      verified: Boolean(matches),
      detected_owner: ownerDigits,
      expected,
      reason: matches ? "ok" : (ownerDigits ? "mismatch" : "no_owner_from_evolution"),
    };

    await admin.from("tenant_whatsapp_numbers").update({
      status: matches ? "verified" : (ownerDigits ? "mismatch" : "pending"),
      verified_at: matches ? nowIso : null,
      verified_owner_jid: ownerDigits ? `${ownerDigits}@s.whatsapp.net` : null,
      phone_jid: matches ? `${expected}@s.whatsapp.net` : (row as any).phone_jid ?? null,
      zapi_connection_id: conn.id,
      last_check_at: nowIso,
      last_check_result: result,
    }).eq("id", row.id);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[tenant-whatsapp-number-verify]", e);
    return new Response(JSON.stringify({ error: "internal_error", message: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
