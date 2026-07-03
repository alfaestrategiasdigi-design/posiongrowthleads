import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Plus, Trash2, MessageSquare, ChevronDown, ChevronRight, Send, Loader2, CheckCircle2 } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLeadTasks, useTaskComments, type LeadTask } from "@/hooks/useLeadTasks";
import type { UnifiedLeadView } from "@/hooks/useUnifiedLead";

export default function LeadTasksTab({ lead }: { lead: UnifiedLeadView }) {
  const { tasks, loading, addTask, updateTask, removeTask } = useLeadTasks(lead.source, lead.id, lead.tenantId);
  const [newTitle, setNewTitle] = useState("");

  const roots = tasks.filter((t) => !t.parent_task_id);
  const childrenOf = (id: string) => tasks.filter((t) => t.parent_task_id === id);

  const submit = async () => {
    if (!newTitle.trim()) return;
    await addTask(newTitle);
    setNewTitle("");
  };

  const doneCount = tasks.filter((t) => t.done).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {tasks.length === 0 ? "Nenhuma tarefa" : `${doneCount}/${tasks.length} concluídas`}
        </span>
        {loading && <Loader2 className="w-3 h-3 animate-spin" />}
      </div>

      {/* Novo */}
      <div className="flex gap-2">
        <Input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Nova tarefa (Enter para adicionar)"
          className="h-9"
        />
        <Button size="sm" onClick={submit} className="gap-1"><Plus className="w-3.5 h-3.5" /> Adicionar</Button>
      </div>

      <div className="space-y-2">
        {roots.length === 0 && !loading && (
          <div className="text-center py-8 text-xs text-muted-foreground">
            <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
            Adicione tarefas para acompanhar o lead.
          </div>
        )}
        {roots.map((t) => (
          <TaskRow
            key={t.id}
            task={t}
            subs={childrenOf(t.id)}
            onToggle={(done) => updateTask(t.id, { done })}
            onUpdate={(patch) => updateTask(t.id, patch)}
            onDelete={() => removeTask(t.id)}
            onAddSub={(title) => addTask(title, t.id)}
            onUpdateSub={(id, patch) => updateTask(id, patch)}
            onDeleteSub={(id) => removeTask(id)}
          />
        ))}
      </div>
    </div>
  );
}

interface RowProps {
  task: LeadTask;
  subs: LeadTask[];
  onToggle: (done: boolean) => void;
  onUpdate: (patch: Partial<LeadTask>) => void;
  onDelete: () => void;
  onAddSub: (title: string) => void;
  onUpdateSub: (id: string, patch: Partial<LeadTask>) => void;
  onDeleteSub: (id: string) => void;
}

function TaskRow({ task, subs, onToggle, onUpdate, onDelete, onAddSub, onUpdateSub, onDeleteSub }: RowProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [subTitle, setSubTitle] = useState("");
  const [dueDate, setDueDate] = useState(task.due_date ? task.due_date.slice(0, 10) : "");

  const commitTitle = () => {
    if (title.trim() && title !== task.title) onUpdate({ title: title.trim() });
  };
  const commitDate = () => {
    const newVal = dueDate ? new Date(dueDate).toISOString() : null;
    if (newVal !== task.due_date) onUpdate({ due_date: newVal });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border/50 bg-card/40">
      <div className="flex items-center gap-2 p-2">
        <Checkbox checked={task.done} onCheckedChange={(v) => onToggle(!!v)} />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          className={`flex-1 h-8 border-transparent bg-transparent focus-visible:border-border ${task.done ? "line-through text-muted-foreground" : ""}`}
        />
        <Input
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          onBlur={commitDate}
          className="w-36 h-8 text-xs"
        />
        <CollapsibleTrigger asChild>
          <Button size="sm" variant="ghost" className="gap-1 h-8 text-xs text-muted-foreground">
            {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {subs.length > 0 && <span>{subs.length}</span>}
          </Button>
        </CollapsibleTrigger>
        <Button size="sm" variant="ghost" onClick={onDelete} className="h-8 text-muted-foreground hover:text-destructive">
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>

      <CollapsibleContent>
        <div className="border-t border-border/40 p-3 space-y-3 bg-muted/10">
          {/* Sub-tarefas */}
          <div className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Sub-tarefas</div>
            {subs.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <Checkbox checked={s.done} onCheckedChange={(v) => onUpdateSub(s.id, { done: !!v })} />
                <span className={`flex-1 text-sm ${s.done ? "line-through text-muted-foreground" : ""}`}>{s.title}</span>
                <Button size="sm" variant="ghost" onClick={() => onDeleteSub(s.id)} className="h-7 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Input
                value={subTitle}
                onChange={(e) => setSubTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && subTitle.trim()) {
                    onAddSub(subTitle);
                    setSubTitle("");
                  }
                }}
                placeholder="Nova sub-tarefa"
                className="h-8 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (subTitle.trim()) { onAddSub(subTitle); setSubTitle(""); }
                }}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {/* Comentários */}
          <TaskComments taskId={task.id} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TaskComments({ taskId }: { taskId: string }) {
  const { comments, addComment } = useTaskComments(taskId);
  const [body, setBody] = useState("");

  const submit = async () => {
    if (!body.trim()) return;
    await addComment(body);
    setBody("");
  };

  return (
    <div className="space-y-2 pt-2 border-t border-border/40">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        <MessageSquare className="w-3 h-3" /> Comentários ({comments.length})
      </div>
      {comments.map((c) => (
        <div key={c.id} className="rounded-md bg-background/60 border border-border/40 p-2 text-sm">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-0.5">
            <span>{c.author_name || "Usuário"}</span>
            <span>{formatDistanceToNow(new Date(c.created_at), { addSuffix: true, locale: ptBR })}</span>
          </div>
          <div className="whitespace-pre-wrap">{c.body}</div>
        </div>
      ))}
      <div className="flex gap-2">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Escrever comentário..."
          rows={2}
          className="text-sm"
        />
        <Button size="sm" onClick={submit} className="self-end gap-1"><Send className="w-3.5 h-3.5" /></Button>
      </div>
    </div>
  );
}
