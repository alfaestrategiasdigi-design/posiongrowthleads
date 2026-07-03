import { json, requireAdmin, randomPassword, corsHeaders } from "../_shared/admin-auth.ts";

const VALID_GLOBAL = new Set(["admin", "comercial_admin_master", "admin_tenant", "comercial_tenant", "user"]);
const VALID_TENANT = new Set(["owner", "admin", "vendedor", "recepcao", "viewer", "comercial_tenant"]);
const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const MASTER_GLOBAL_ROLES = new Set(["admin", "comercial_admin_master"]);
const CLINIC_GLOBAL_ROLES = new Set(["admin_tenant", "comercial_tenant"]);

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
    if (MASTER_GLOBAL_ROLES.has(globalRole) && tenantId && tenantId !== MASTER_TENANT_ID) {
      return json({ error: "conta Admin Master não pode ser vinculada a clínica" }, 400);
    }
    if (CLINIC_GLOBAL_ROLES.has(globalRole) && (!tenantId || tenantId === MASTER_TENANT_ID)) {
      return json({ error: "usuário de clínica precisa estar vinculado a uma clínica" }, 400);
    }
    if (globalRole === "user" && tenantId === MASTER_TENANT_ID) {
      return json({ error: "usuário comum não pode ser vinculado à conta Admin Master" }, 400);
    }
    if (tenantId && !tenantRole) return json({ error: "informe cargo interno" }, 400);
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

    // Papel global exato: um usuário fica em uma categoria por vez.
    await admin.from("user_roles").delete().eq("user_id", userId);
    const { error: rErr } = await admin.from("user_roles").insert({ user_id: userId, role: globalRole as any });
    if (rErr) return json({ error: `user_roles: ${rErr.message}` }, 400);

    // Conta Admin Master: fica somente no tenant master, nunca em clínica.
    if (MASTER_GLOBAL_ROLES.has(globalRole)) {
      const masterRole = globalRole === "admin" ? "owner" : "admin";
      await admin.from("tenant_users").delete().eq("user_id", userId).neq("tenant_id", MASTER_TENANT_ID);
      const { error: tErr } = await admin.from("tenant_users").upsert(
        { user_id: userId, tenant_id: MASTER_TENANT_ID, role: masterRole as any, active: true },
        { onConflict: "user_id,tenant_id" },
      );
      if (tErr) return json({ error: `tenant_users: ${tErr.message}` }, 400);
    } else {
      // Usuário de clínica: nunca mantém vínculo com tenant master.
      await admin.from("tenant_users").delete().eq("user_id", userId).eq("tenant_id", MASTER_TENANT_ID);
      if (tenantId && tenantRole) {
        const { error: tErr } = await admin
          .from("tenant_users")
          .upsert(
            { user_id: userId, tenant_id: tenantId, role: tenantRole as any, active: true },
            { onConflict: "user_id,tenant_id" },
          );
        if (tErr) return json({ error: `tenant_users: ${tErr.message}` }, 400);
      }
    }

    return json({ ok: true, user_id: userId, email, password, created });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
