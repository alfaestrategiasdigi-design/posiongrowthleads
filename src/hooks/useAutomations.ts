import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AutomationFlow, AutomationTemplate, AutomationTask } from "@/lib/automations/types";

export interface AutomationScope {
  tenantId: string | null;
  isAdminMaster: boolean;
}

/** Determine automation scope from route context. Master when tenantId is null. */
export function useAutomationScope(tenantId: string | null): AutomationScope {
  return { tenantId, isAdminMaster: tenantId === null };
}

export function useFlows(scope: AutomationScope) {
  const [flows, setFlows] = useState<AutomationFlow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("automation_flows").select("*").order("updated_at", { ascending: false });
    if (scope.isAdminMaster) q = q.eq("is_admin_master", true);
    else if (scope.tenantId) q = q.eq("tenant_id", scope.tenantId);
    const { data } = await q;
    setFlows((data as any) || []);
    setLoading(false);
  }, [scope.isAdminMaster, scope.tenantId]);

  useEffect(() => { load(); }, [load]);
  return { flows, loading, reload: load };
}

export function useTemplates(scope: AutomationScope) {
  const [templates, setTemplates] = useState<AutomationTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const category = scope.isAdminMaster ? "agencia" : "clinica";
      const { data } = await supabase
        .from("automation_templates")
        .select("*")
        .eq("category", category)
        .order("name");
      setTemplates((data as any) || []);
      setLoading(false);
    })();
  }, [scope.isAdminMaster]);

  return { templates, loading };
}

export function useTasks(scope: AutomationScope) {
  const [tasks, setTasks] = useState<AutomationTask[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from("automation_tasks").select("*").order("scheduled_for", { ascending: true });
    if (scope.isAdminMaster) q = q.eq("is_admin_master", true);
    else if (scope.tenantId) q = q.eq("tenant_id", scope.tenantId);
    const { data } = await q;
    setTasks((data as any) || []);
    setLoading(false);
  }, [scope.isAdminMaster, scope.tenantId]);

  useEffect(() => { load(); }, [load]);
  return { tasks, loading, reload: load };
}
