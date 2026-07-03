import { supabase } from "@/integrations/supabase/client";

/**
 * Decide para onde mandar o usuário logo após login:
 * - Se for super admin → /admin
 * - Se tiver vínculo em tenant_users → /app/{slug}/dashboard
 * - Caso contrário → /
 */
export async function getPostLoginRedirect(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return "/";

  // Super admin / comercial master têm prioridade → painel /admin
  const { data: masterRoles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["admin", "comercial_admin_master"]);
  if (masterRoles && masterRoles.length > 0) return "/admin";

  // Buscar tenant vinculado (ignorando o tenant master)
  const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";
  const { data: membership } = await supabase
    .from("tenant_users")
    .select("tenant_id, tenants(slug)")
    .eq("user_id", user.id)
    .neq("tenant_id", MASTER_TENANT_ID)
    .limit(1)
    .maybeSingle();

  const slug = (membership as any)?.tenants?.slug;
  if (slug) return `/app/${slug}/dashboard`;


  return "/";
}
