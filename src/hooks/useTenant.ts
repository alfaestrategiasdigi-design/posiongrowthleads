import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  plan: string;
  status: string;
  segment: string | null;
}

interface TenantState {
  loading: boolean;
  user: User | null;
  tenant: Tenant | null;
  role: string | null;
  error: string | null;
}

export function useTenant(options?: { skip?: boolean }) {
  const skip = options?.skip === true;
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<TenantState>({
    loading: !skip, user: null, tenant: null, role: null, error: null,
  });

  useEffect(() => {
    if (skip) return;
    let active = true;

    const load = async (user: User | null) => {
      if (!user) {
        setState({ loading: false, user: null, tenant: null, role: null, error: null });
        return;
      }
      if (!tenantSlug) {
        const { data: masterRoles } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .in("role", ["admin", "comercial_admin_master"]);
        if ((masterRoles || []).length > 0) {
          navigate("/admin", { replace: true });
          return;
        }

        // resolve first real clinic, never the admin master tenant
        const { data: memberships } = await supabase
          .from("tenant_users")
          .select("tenants(slug)")
          .eq("active", true)
          .neq("tenant_id", MASTER_TENANT_ID)
          .limit(1);
        const slug = (memberships?.[0] as any)?.tenants?.slug;
        if (slug) navigate(`/app/${slug}/dashboard`, { replace: true });
        return;
      }
      const { data: tenant, error } = await supabase
        .from("tenants").select("*").eq("slug", tenantSlug).maybeSingle();
      if (!active) return;
      if (error || !tenant) {
        setState({ loading: false, user, tenant: null, role: null, error: "Tenant não encontrado" });
        return;
      }
      if (tenant.id === MASTER_TENANT_ID) {
        navigate("/admin", { replace: true });
        return;
      }
      const { data: membership } = await supabase
        .from("tenant_users")
        .select("role")
        .eq("tenant_id", tenant.id)
        .eq("user_id", user.id)
        .eq("active", true)
        .maybeSingle();
      setState({ loading: false, user, tenant: tenant as Tenant, role: membership?.role ?? null, error: null });
    };

    supabase.auth.getSession().then(({ data: { session } }) => load(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => load(session?.user ?? null));
    return () => { active = false; subscription.unsubscribe(); };
  }, [tenantSlug, navigate, skip]);

  return state;
}
