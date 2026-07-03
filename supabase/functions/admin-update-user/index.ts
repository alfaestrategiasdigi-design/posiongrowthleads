import { json, requireAdmin, corsHeaders } from "../_shared/admin-auth.ts";

const VALID_GLOBAL = new Set(["admin", "comercial_admin_master", "admin_tenant", "comercial_tenant", "user"]);
const VALID_TENANT = new Set(["owner", "admin", "vendedor", "recepcao", "viewer", "comercial_tenant"]);

/**
 * Actions:
 *  - set_global_role   { user_id, role }             — replace global roles with single value (or [] to clear)
 *  - add_global_role   { user_id, role }
 *  - remove_global_role{ user_id, role }
 *  - upsert_tenant     { user_id, tenant_id, tenant_role, active? }
 *  - remove_tenant     { user_id, tenant_id }
 *  - set_tenant_active { user_id, tenant_id, active }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { admin, user: caller } = auth;

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const userId = body.user_id ? String(body.user_id) : null;
    if (!userId) return json({ error: "user_id obrigatório" }, 400);

    switch (action) {
      case "set_global_role":
      case "add_global_role":
      case "remove_global_role": {
        const role = String(body.role || "");
        if (!VALID_GLOBAL.has(role)) return json({ error: "papel inválido" }, 400);
        // Anti-lockout: caller cannot remove their own admin
        if (caller.id === userId && role === "admin" && action !== "add_global_role") {
          return json({ error: "você não pode remover seu próprio papel admin" }, 400);
        }
        if (action === "set_global_role") {
          await admin.from("user_roles").delete().eq("user_id", userId);
          const { error } = await admin.from("user_roles").insert({ user_id: userId, role: role as any });
          if (error) return json({ error: error.message }, 400);
        } else if (action === "add_global_role") {
          const { error } = await admin
            .from("user_roles")
            .upsert({ user_id: userId, role: role as any }, { onConflict: "user_id,role" });
          if (error) return json({ error: error.message }, 400);
        } else {
          const { error } = await admin.from("user_roles").delete().eq("user_id", userId).eq("role", role as any);
          if (error) return json({ error: error.message }, 400);
        }
        return json({ ok: true });
      }
      case "upsert_tenant": {
        const tenantId = String(body.tenant_id || "");
        const tenantRole = String(body.tenant_role || "");
        const active = body.active !== false;
        if (!tenantId || !VALID_TENANT.has(tenantRole)) return json({ error: "tenant/role inválidos" }, 400);
        const { error } = await admin
          .from("tenant_users")
          .upsert(
            { user_id: userId, tenant_id: tenantId, role: tenantRole as any, active },
            { onConflict: "user_id,tenant_id" },
          );
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case "remove_tenant": {
        const tenantId = String(body.tenant_id || "");
        if (!tenantId) return json({ error: "tenant_id obrigatório" }, 400);
        const { error } = await admin.from("tenant_users").delete().eq("user_id", userId).eq("tenant_id", tenantId);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case "set_tenant_active": {
        const tenantId = String(body.tenant_id || "");
        const active = !!body.active;
        if (!tenantId) return json({ error: "tenant_id obrigatório" }, 400);
        const { error } = await admin
          .from("tenant_users")
          .update({ active })
          .eq("user_id", userId)
          .eq("tenant_id", tenantId);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      default:
        return json({ error: "action inválida" }, 400);
    }
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
