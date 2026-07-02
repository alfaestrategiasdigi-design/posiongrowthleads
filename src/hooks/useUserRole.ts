import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type GlobalRole =
  | "admin"                  // Admin Master
  | "comercial_admin_master"
  | "admin_tenant"
  | "comercial_tenant"
  | "user";

interface State {
  loading: boolean;
  userId: string | null;
  globalRoles: GlobalRole[];
  isMaster: boolean;            // admin
  isComercialMaster: boolean;   // comercial_admin_master
}

export function useUserRole(): State {
  const [state, setState] = useState<State>({
    loading: true, userId: null, globalRoles: [],
    isMaster: false, isComercialMaster: false,
  });

  useEffect(() => {
    let active = true;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        if (active) setState({ loading: false, userId: null, globalRoles: [], isMaster: false, isComercialMaster: false });
        return;
      }
      const { data: rows } = await supabase
        .from("user_roles").select("role").eq("user_id", user.id);
      const roles = (rows ?? []).map(r => r.role as GlobalRole);
      if (!active) return;
      setState({
        loading: false,
        userId: user.id,
        globalRoles: roles,
        isMaster: roles.includes("admin"),
        isComercialMaster: roles.includes("comercial_admin_master"),
      });
    };
    load();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => load());
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  return state;
}
