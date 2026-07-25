import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { LeadSource } from "./useUnifiedLead";

export type LeadTaskType = "geral" | "lembrete" | "mensagem";
export type LeadTaskFrequency = "once" | "daily" | "weekly" | "monthly";

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
  template_key: string | null;
  created_at: string;
  updated_at: string;
  task_type?: LeadTaskType | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  frequency?: LeadTaskFrequency | null;
  message_body?: string | null;
  phone?: string | null;
  next_send_at?: string | null;
  last_sent_at?: string | null;
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
    async (
      titleOrPayload: string | Partial<LeadTask>,
      parent_task_id: string | null = null
    ) => {
      if (!source || !leadId) return;
      const user = (await supabase.auth.getUser()).data.user;
      const extra: Partial<LeadTask> =
        typeof titleOrPayload === "string" ? { title: titleOrPayload } : titleOrPayload;
      const title = String(extra.title ?? "").trim();
      if (!title) return;
      // Compute next_send_at from scheduled_date + scheduled_time when relevant
      let next_send_at = extra.next_send_at ?? null;
      if (extra.task_type === "mensagem" && extra.scheduled_date && !next_send_at) {
        const t = extra.scheduled_time || "09:00";
        const iso = new Date(`${extra.scheduled_date}T${t}:00`).toISOString();
        next_send_at = iso;
      }
      const payload: any = {
        ...extra,
        title,
        parent_task_id: extra.parent_task_id ?? parent_task_id,
        tenant_id: extra.tenant_id ?? tenantId ?? null,
        created_by: user?.id ?? null,
        position: tasks.filter((t) => t.parent_task_id === (extra.parent_task_id ?? parent_task_id)).length,
        next_send_at,
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

  const bulkInsert = useCallback(
    async (items: { title: string; template_key?: string; subtasks?: string[] }[]) => {
      if (!source || !leadId || items.length === 0) return;
      const user = (await supabase.auth.getUser()).data.user;
      const owner = ownerColumn(source);
      const basePos = tasks.filter((t) => !t.parent_task_id).length;
      // Insere pais um a um para poder capturar os ids e criar subtarefas
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const parentPayload: any = {
          title: it.title.trim(),
          parent_task_id: null,
          tenant_id: tenantId ?? null,
          created_by: user?.id ?? null,
          position: basePos + i,
          template_key: it.template_key ?? null,
        };
        parentPayload[owner] = leadId;
        const { data: parent, error } = await supabase
          .from("lead_tasks")
          .insert(parentPayload)
          .select("id")
          .maybeSingle();
        if (error || !parent) continue;
        if (it.subtasks && it.subtasks.length) {
          const subs = it.subtasks.map((title, idx) => {
            const p: any = {
              title,
              parent_task_id: parent.id,
              tenant_id: tenantId ?? null,
              created_by: user?.id ?? null,
              position: idx,
              template_key: it.template_key ? `${it.template_key}.${idx}` : null,
            };
            p[owner] = leadId;
            return p;
          });
          await supabase.from("lead_tasks").insert(subs);
        }
      }
      await load();
    },
    [source, leadId, tenantId, tasks, load]
  );

  return { tasks, loading, reload: load, addTask, updateTask, removeTask, bulkInsert };
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
