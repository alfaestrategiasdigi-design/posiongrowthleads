import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { LeadSource } from "./useUnifiedLead";

export interface LeadTask {
  id: string;
  parent_task_id: string | null;
  lead_id: string | null;
  agency_lead_id: string | null;
  tenant_id: string | null;
  title: string;
  done: boolean;
  due_date: string | null;
  assignee_user_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  author_user_id: string | null;
  author_name: string | null;
  body: string;
  created_at: string;
}

const ownerColumn = (s: LeadSource) => (s === "lead" ? "lead_id" : "agency_lead_id");

export function useLeadTasks(source: LeadSource | null, leadId: string | null, tenantId?: string | null) {
  const [tasks, setTasks] = useState<LeadTask[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!source || !leadId) return;
    setLoading(true);
    const { data } = await supabase
      .from("lead_tasks")
      .select("*")
      .eq(ownerColumn(source), leadId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    setTasks((data as LeadTask[]) || []);
    setLoading(false);
  }, [source, leadId]);

  useEffect(() => {
    if (source && leadId) load();
    else setTasks([]);
  }, [source, leadId, load]);

  const addTask = useCallback(
    async (title: string, parent_task_id: string | null = null) => {
      if (!source || !leadId || !title.trim()) return;
      const user = (await supabase.auth.getUser()).data.user;
      const payload: any = {
        title: title.trim(),
        parent_task_id,
        tenant_id: tenantId ?? null,
        created_by: user?.id ?? null,
        position: tasks.filter((t) => t.parent_task_id === parent_task_id).length,
      };
      payload[ownerColumn(source)] = leadId;
      const { error } = await supabase.from("lead_tasks").insert(payload);
      if (!error) await load();
      return error;
    },
    [source, leadId, tenantId, tasks, load]
  );

  const updateTask = useCallback(
    async (id: string, patch: Partial<LeadTask>) => {
      const { error } = await supabase.from("lead_tasks").update(patch as any).eq("id", id);
      if (!error) await load();
      return error;
    },
    [load]
  );

  const removeTask = useCallback(
    async (id: string) => {
      const { error } = await supabase.from("lead_tasks").delete().eq("id", id);
      if (!error) await load();
      return error;
    },
    [load]
  );

  return { tasks, loading, reload: load, addTask, updateTask, removeTask };
}

export function useTaskComments(taskId: string | null) {
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!taskId) return;
    setLoading(true);
    const { data } = await supabase
      .from("lead_task_comments")
      .select("*")
      .eq("task_id", taskId)
      .order("created_at", { ascending: true });
    setComments((data as TaskComment[]) || []);
    setLoading(false);
  }, [taskId]);

  useEffect(() => {
    if (taskId) load();
    else setComments([]);
  }, [taskId, load]);

  const addComment = useCallback(
    async (body: string) => {
      if (!taskId || !body.trim()) return;
      const user = (await supabase.auth.getUser()).data.user;
      const { error } = await supabase.from("lead_task_comments").insert({
        task_id: taskId,
        body: body.trim(),
        author_user_id: user?.id ?? null,
        author_name: user?.email ?? null,
      });
      if (!error) await load();
      return error;
    },
    [taskId, load]
  );

  return { comments, loading, addComment };
}
