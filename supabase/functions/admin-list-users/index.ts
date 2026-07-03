import { json, requireAdmin, corsHeaders } from "../_shared/admin-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { admin } = auth;

    const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (list.error) return json({ error: list.error.message }, 400);

    const users = list.data.users.map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at,
      banned_until: (u as any).banned_until ?? null,
    }));
    const ids = users.map((u) => u.id);

    const [{ data: roles }, { data: memberships }] = await Promise.all([
      admin.from("user_roles").select("user_id, role").in("user_id", ids),
      admin
        .from("tenant_users")
        .select("user_id, tenant_id, role, active, tenants(name, slug)")
        .in("user_id", ids),
    ]);

    const rolesByUser: Record<string, string[]> = {};
    (roles || []).forEach((r: any) => {
      (rolesByUser[r.user_id] ||= []).push(r.role);
    });
    const memByUser: Record<string, any[]> = {};
    (memberships || []).forEach((m: any) => {
      (memByUser[m.user_id] ||= []).push({
        tenant_id: m.tenant_id,
        role: m.role,
        active: m.active,
        tenant_name: m.tenants?.name || null,
        tenant_slug: m.tenants?.slug || null,
      });
    });

    return json({
      ok: true,
      users: users.map((u) => ({
        ...u,
        global_roles: rolesByUser[u.id] || [],
        tenants: memByUser[u.id] || [],
      })),
    });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
