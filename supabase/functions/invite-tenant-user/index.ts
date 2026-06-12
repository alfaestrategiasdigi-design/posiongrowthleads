// Invite a user into a tenant. Caller must be a global admin or admin of the target tenant.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

function randomPassword(len = 12) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  let p = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) p += chars[arr[i] % chars.length];
  return p;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Não autenticado" }, 401);

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Sessão inválida" }, 401);

    const body = await req.json();
    const { email, role, tenant_id } = body ?? {};
    if (!email || !role || !tenant_id) return json({ error: "Campos obrigatórios: email, role, tenant_id" }, 400);
    if (!["admin", "owner", "vendedor", "recepcao", "viewer"].includes(role)) {
      return json({ error: "Role inválida" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Check caller is global admin or tenant admin
    const { data: isGlobal } = await admin.rpc("has_role", { _user_id: user.id, _role: "admin" });
    let allowed = !!isGlobal;
    if (!allowed) {
      const { data: isTAdmin } = await admin.rpc("is_tenant_admin", {
        _user_id: user.id,
        _tenant_id: tenant_id,
      });
      allowed = !!isTAdmin;
    }
    if (!allowed) return json({ error: "Sem permissão para convidar nessa clínica" }, 403);

    const tempPassword = randomPassword(12);

    // Try to find existing user by email
    let userId: string | null = null;
    const list = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    const existing = list.data.users.find((u) => u.email?.toLowerCase() === String(email).toLowerCase());
    if (existing) {
      userId = existing.id;
    } else {
      const created = await admin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
      });
      if (created.error || !created.data.user) {
        return json({ error: created.error?.message || "Falha ao criar usuário" }, 400);
      }
      userId = created.data.user.id;
    }

    // Upsert tenant_users
    const { error: insErr } = await admin.from("tenant_users").upsert(
      { user_id: userId, tenant_id, role, active: true },
      { onConflict: "user_id,tenant_id" },
    );
    if (insErr) return json({ error: insErr.message }, 400);

    return json({
      success: true,
      user_id: userId,
      email,
      temp_password: existing ? null : tempPassword,
      created: !existing,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
