import { supabase } from "@/integrations/supabase/client";

const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Decide para onde mandar o usuário logo após login:
 * - Se for super admin → /admin
 * - Se tiver vínculo em tenant_users → /app/{slug}/dashboard
 * - Caso contrário → /
 */
export async function getPostLoginRedirect(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "/";

  // 1) Conta Agência/Admin Master (papel global) → /admin
  const { data: masterRoles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["admin", "comercial_admin_master"]);
  if (masterRoles && masterRoles.length > 0) return "/admin";

  // 2) Vínculo com o tenant Master (qualquer papel) → /admin
  const { data: masterLink } = await supabase
    .from("tenant_users")
    .select("tenant_id")
    .eq("user_id", user.id)
    .eq("tenant_id", MASTER_TENANT_ID)
    .eq("active", true)
    .maybeSingle();
  if (masterLink) return "/admin";

  // 3) Vínculo com clínica ativa → /app/{slug}/dashboard
  const { data: membership } = await supabase
    .from("tenant_users")
    .select("tenant_id, active, tenants(slug)")
    .eq("user_id", user.id)
    .eq("active", true)
    .neq("tenant_id", MASTER_TENANT_ID)
    .limit(1)
    .maybeSingle();

  const slug = (membership as any)?.tenants?.slug;
  if (slug) return `/app/${slug}/dashboard`;

  return "/login";
}

