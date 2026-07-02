// Cria um convite (token único, 24h). Admin master OU admin/owner da clínica alvo.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VALID_APP_ROLES = new Set([
  "admin", "comercial_admin_master", "admin_tenant", "comercial_tenant", "user",
]);
const VALID_TENANT_ROLES = new Set([
  "owner", "admin", "vendedor", "recepcao", "viewer", "comercial_tenant",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const role = String(body.role || "").trim();
    const tenant_id = body.tenant_id ? String(body.tenant_id) : null;
    const tenant_role = body.tenant_role ? String(body.tenant_role) : null;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "email inválido" }, 400);
    if (!VALID_APP_ROLES.has(role)) return json({ error: "role inválida" }, 400);
    if (tenant_role && !VALID_TENANT_ROLES.has(tenant_role)) return json({ error: "tenant_role inválida" }, 400);

    const admin = createClient(URL_, SERVICE);

    // Autorização: master global OU admin/owner do tenant alvo
    const { data: isMaster } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    let allowed = !!isMaster;
    if (!allowed && tenant_id) {
      const { data: isTAdmin } = await admin.rpc("is_tenant_admin", { _user_id: user.id, _tenant_id: tenant_id });
      allowed = !!isTAdmin;
    }
    if (!allowed) return json({ error: "sem permissão" }, 403);

    // Roles master-only só admin master pode criar
    if (!isMaster && ["admin", "comercial_admin_master"].includes(role)) {
      return json({ error: "apenas o Admin Master pode conceder papéis globais" }, 403);
    }

    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { data: inv, error } = await admin.from("invites").insert({
      email, role, tenant_id, tenant_role, token,
      created_by: user.id,
    }).select("id, token, expires_at").single();
    if (error) return json({ error: error.message }, 400);

    const origin = req.headers.get("origin") || req.headers.get("referer") || "";
    const link = origin ? `${origin.replace(/\/$/, "")}/convite/${token}` : `/convite/${token}`;

    return json({ ok: true, id: inv.id, token: inv.token, expires_at: inv.expires_at, link });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
