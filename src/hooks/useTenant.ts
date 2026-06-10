import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

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

export function useTenant() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<TenantState>({
    loading: true, user: null, tenant: null, role: null, error: null,
  });

  useEffect(() => {
    let active = true;

    const load = async (user: User | null) => {
      if (!user) {
        setState({ loading: false, user: null, tenant: null, role: null, error: null });
        return;
      }
      if (!tenantSlug) {
        // resolve first tenant
        const { data: memberships } = await supabase
          .from("tenant_users")
          .select("tenants(slug)")
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
      const { data: membership } = await supabase
        .from("tenant_users").select("role").eq("tenant_id", tenant.id).eq("user_id", user.id).maybeSingle();
      setState({ loading: false, user, tenant: tenant as Tenant, role: membership?.role ?? null, error: null });
    };

    supabase.auth.getSession().then(({ data: { session } }) => load(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => load(session?.user ?? null));
    return () => { active = false; subscription.unsubscribe(); };
  }, [tenantSlug, navigate]);

  return state;
}
