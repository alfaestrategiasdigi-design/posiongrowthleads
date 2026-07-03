import { json, requireAdmin, randomPassword, corsHeaders } from "../_shared/admin-auth.ts";

const VALID_GLOBAL = new Set(["admin", "comercial_admin_master", "admin_tenant", "comercial_tenant", "user"]);
const VALID_TENANT = new Set(["owner", "admin", "vendedor", "recepcao", "viewer", "comercial_tenant"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { admin } = auth;

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "").trim() || randomPassword(12);
    const globalRole = String(body.global_role || "user");
    const tenantId = body.tenant_id ? String(body.tenant_id) : null;
    const tenantRole = body.tenant_role ? String(body.tenant_role) : null;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "e-mail inválido" }, 400);
    if (password.length < 8) return json({ error: "senha deve ter 8+ caracteres" }, 400);
    if (!VALID_GLOBAL.has(globalRole)) return json({ error: "papel global inválido" }, 400);
    if (tenantId && !tenantRole) return json({ error: "informe cargo interno da clínica" }, 400);
    if (tenantRole && !VALID_TENANT.has(tenantRole)) return json({ error: "cargo interno inválido" }, 400);

    // Find or create user
    let userId: string | null = null;
    let created = false;
    const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list.data.users.find((u) => u.email?.toLowerCase() === email);
    if (existing) {
      userId = existing.id;
      // Reset password + confirm email
      await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    } else {
      const c = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (c.error || !c.data.user) return json({ error: c.error?.message || "falha ao criar usuário" }, 400);
      userId = c.data.user.id;
      created = true;
    }

    // Global role (upsert)
    if (globalRole) {
      const { error: rErr } = await admin
        .from("user_roles")
        .upsert({ user_id: userId, role: globalRole as any }, { onConflict: "user_id,role" });
      if (rErr) return json({ error: `user_roles: ${rErr.message}` }, 400);
    }

    // Tenant link
    if (tenantId && tenantRole) {
      const { error: tErr } = await admin
        .from("tenant_users")
        .upsert(
          { user_id: userId, tenant_id: tenantId, role: tenantRole as any, active: true },
          { onConflict: "user_id,tenant_id" },
        );
      if (tErr) return json({ error: `tenant_users: ${tErr.message}` }, 400);
    }

    return json({ ok: true, user_id: userId, email, password, created });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
