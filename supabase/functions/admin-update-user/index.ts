import { json, requireAdmin, corsHeaders } from "../_shared/admin-auth.ts";

const VALID_GLOBAL = new Set(["admin", "comercial_admin_master", "admin_tenant", "comercial_tenant", "user"]);
const VALID_TENANT = new Set(["owner", "admin", "vendedor", "recepcao", "viewer", "comercial_tenant"]);
const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const MASTER_GLOBAL_ROLES = new Set(["admin", "comercial_admin_master"]);
const CLINIC_GLOBAL_ROLES = new Set(["admin_tenant", "comercial_tenant"]);

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

        // Se virou conta Admin Master/Agência, fica só no tenant master.
        if (action !== "remove_global_role" && MASTER_GLOBAL_ROLES.has(role)) {
          const masterRole = role === "admin" ? "owner" : "admin";
          await admin.from("tenant_users").delete().eq("user_id", userId).neq("tenant_id", MASTER_TENANT_ID);
          await admin.from("tenant_users").upsert(
            {
              user_id: userId,
              tenant_id: MASTER_TENANT_ID,
              role: masterRole as any,
              active: true,
            },
            { onConflict: "user_id,tenant_id" },
          );
        } else if (action !== "remove_global_role") {
          // Se deixou de ser Admin Master, não mantém acesso ao tenant master.
          await admin.from("tenant_users").delete().eq("user_id", userId).eq("tenant_id", MASTER_TENANT_ID);
        }
        return json({ ok: true });
      }
      case "upsert_tenant": {
        const tenantId = String(body.tenant_id || "");
        const tenantRole = String(body.tenant_role || "");
        const active = body.active !== false;
        if (!tenantId || !VALID_TENANT.has(tenantRole)) return json({ error: "tenant/role inválidos" }, 400);
        if (tenantId === MASTER_TENANT_ID) return json({ error: "use papel Admin Master para vincular à conta admin" }, 400);
        const { data: masterRoles } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .in("role", Array.from(MASTER_GLOBAL_ROLES) as any);
        if ((masterRoles || []).length > 0) {
          return json({ error: "conta Admin Master não pode ser vinculada a clínica" }, 400);
        }
        const { data: clinicRoles } = await admin
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .in("role", Array.from(CLINIC_GLOBAL_ROLES) as any);
        if ((clinicRoles || []).length === 0) {
          const { error: roleErr } = await admin
            .from("user_roles")
            .upsert({ user_id: userId, role: "admin_tenant" as any }, { onConflict: "user_id,role" });
          if (roleErr) return json({ error: roleErr.message }, 400);
        }
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
        if (tenantId === MASTER_TENANT_ID) return json({ error: "não remova o vínculo master por aqui; altere o papel global" }, 400);
        const { error } = await admin.from("tenant_users").delete().eq("user_id", userId).eq("tenant_id", tenantId);
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }
      case "set_tenant_active": {
        const tenantId = String(body.tenant_id || "");
        const active = !!body.active;
        if (!tenantId) return json({ error: "tenant_id obrigatório" }, 400);
        if (tenantId === MASTER_TENANT_ID && !active) return json({ error: "conta Admin Master precisa ficar ativa" }, 400);
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
