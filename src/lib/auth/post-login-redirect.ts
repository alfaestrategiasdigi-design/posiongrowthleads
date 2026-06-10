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

  // Super admin tem prioridade
  const { data: adminRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (adminRole) return "/admin";

  // Buscar tenant vinculado
  const { data: membership } = await supabase
    .from("tenant_users")
    .select("tenant_id, tenants(slug)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const slug = (membership as any)?.tenants?.slug;
  if (slug) return `/app/${slug}/dashboard`;

  return "/";
}
