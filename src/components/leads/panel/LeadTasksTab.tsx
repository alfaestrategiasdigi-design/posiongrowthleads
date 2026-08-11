import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Plus, Trash2, MessageSquare, ChevronDown, ChevronRight, Send, Loader2,
  CheckCircle2, Sparkles, Bell, CalendarClock, ListTodo,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useLeadTasks, useTaskComments, type LeadTask, type LeadTaskFrequency } from "@/hooks/useLeadTasks";
import type { UnifiedLeadView } from "@/hooks/useUnifiedLead";
import { getSuggestedTasks, type SuggestedTask } from "@/lib/lead-task-templates";
import { toast } from "sonner";

const FREQ_LABEL: Record<LeadTaskFrequency, string> = {
  once: "uma vez",
  daily: "diariamente",
  weekly: "semanalmente",
  monthly: "mensalmente",
};

export default function LeadTasksTab({ lead }: { lead: UnifiedLeadView }) {
  const { tasks, loading, addTask, updateTask, removeTask, bulkInsert } = useLeadTasks(lead.source, lead.id, lead.tenantId);
  const [newTitle, setNewTitle] = useState("");

  const suggestions = useMemo(
    () => getSuggestedTasks({ tipoPurchase: lead.tipoPurchase, sdrScore: lead.sdr?.score ?? null }),
    [lead.tipoPurchase, lead.sdr?.score]
  );
  const existingKeys = useMemo(() => new Set(tasks.map((t) => t.template_key).filter(Boolean) as string[]), [tasks]);
  const pendingSuggestions = suggestions.filter((s) => !existingKeys.has(s.key));
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);

  const toggleSel = (k: string) => setSelected((s) => ({ ...s, [k]: !s[k] }));
  const allSelected = pendingSuggestions.every((s) => selected[s.key]);
  const toggleAll = () => {
    const next: Record<string, boolean> = {};
    if (!allSelected) pendingSuggestions.forEach((s) => (next[s.key] = true));
    setSelected(next);
  };

  const applySelected = async () => {
    const chosen: SuggestedTask[] = pendingSuggestions.filter((s) => selected[s.key]);
    const items = (chosen.length ? chosen : pendingSuggestions).map((s) => ({
      title: s.title,
      template_key: s.key,
      subtasks: s.subtasks,
    }));
    if (!items.length) return;
    setApplying(true);
    await bulkInsert(items);
    toast.success(`${items.length} tarefa(s) adicionada(s)`);
    setSelected({});
    setApplying(false);
  };


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

      {/* Novo — abas por tipo */}
      <Tabs defaultValue="geral" className="w-full">
        <TabsList className="grid grid-cols-3 h-9">
          <TabsTrigger value="geral" className="gap-1 text-xs"><ListTodo className="w-3.5 h-3.5" /> Geral</TabsTrigger>
          <TabsTrigger value="lembrete" className="gap-1 text-xs"><Bell className="w-3.5 h-3.5" /> Lembrete</TabsTrigger>
          <TabsTrigger value="mensagem" className="gap-1 text-xs"><MessageSquare className="w-3.5 h-3.5" /> Mensagem</TabsTrigger>
        </TabsList>

        <TabsContent value="geral" className="pt-3">
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
        </TabsContent>

        <TabsContent value="lembrete" className="pt-3">
          <ScheduledForm
            kind="lembrete"
            leadPhone={lead.whatsapp}
            onCreate={async (payload) => {
              const err = await addTask(payload);
              if (err) toast.error("Erro ao criar lembrete");
              else toast.success("Lembrete agendado");
            }}
          />
        </TabsContent>

        <TabsContent value="mensagem" className="pt-3">
          <ScheduledForm
            kind="mensagem"
            leadPhone={lead.whatsapp}
            leadName={lead.name}
            onCreate={async (payload) => {
              if (!lead.whatsapp) {
                toast.error("Lead sem WhatsApp cadastrado");
                return;
              }
              const err = await addTask(payload);
              if (err) toast.error("Erro ao agendar mensagem");
              else toast.success("Mensagem agendada");
            }}
          />
        </TabsContent>
      </Tabs>

      {pendingSuggestions.length > 0 && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-xs font-semibold text-primary flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" /> Sugestões para este lead
            </div>
            <Button size="sm" variant="ghost" onClick={toggleAll} className="h-6 text-[10px]">
              {allSelected ? "Limpar" : "Selecionar tudo"}
            </Button>
          </div>
          <div className="text-[10px] text-muted-foreground">
            Baseado em <span className="font-medium">{lead.tipoPurchase || "perfil não informado"}</span>
            {lead.sdr?.score != null && <> · score {lead.sdr.score}</>}
          </div>
          <div className="space-y-1">
            {pendingSuggestions.map((s) => (
              <label key={s.key} className="flex items-start gap-2 text-xs cursor-pointer hover:bg-primary/5 rounded p-1">
                <Checkbox checked={!!selected[s.key]} onCheckedChange={() => toggleSel(s.key)} className="mt-0.5" />
                <div className="flex-1">
                  <div className="font-medium">{s.title}</div>
                  {s.subtasks && s.subtasks.length > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      + {s.subtasks.length} sub-tarefa(s): {s.subtasks.join(" · ")}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
          <Button size="sm" onClick={applySelected} disabled={applying} className="w-full gap-1 h-8">
            {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            Aplicar {Object.values(selected).filter(Boolean).length || "todas"}
          </Button>
        </div>
      )}

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

interface ScheduledFormProps {
  kind: "mensagem" | "lembrete";
  leadPhone?: string | null;
  leadName?: string | null;
  onCreate: (payload: Partial<LeadTask>) => Promise<void>;
}

function ScheduledForm({ kind, leadPhone, leadName, onCreate }: ScheduledFormProps) {
  const today = new Date().toISOString().slice(0, 10);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(today);
  const [time, setTime] = useState("09:00");
  const [freq, setFreq] = useState<LeadTaskFrequency>("once");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const defaultTitle = kind === "mensagem" ? "Enviar mensagem" : "Lembrete";

  const submit = async () => {
    if (kind === "mensagem" && !body.trim()) {
      toast.error("Escreva a mensagem");
      return;
    }
    setSaving(true);
    await onCreate({
      title: title.trim() || defaultTitle,
      task_type: kind,
      scheduled_date: date,
      scheduled_time: time,
      frequency: freq,
      message_body: kind === "mensagem" ? body.trim() : null,
      phone: kind === "mensagem" ? (leadPhone || null) : null,
    });
    setSaving(false);
    setTitle("");
    setBody("");
  };

  return (
    <div className="space-y-3 rounded-lg border border-border/50 bg-card/40 p-3">
      <div>
        <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Título</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={defaultTitle}
          className="mt-1 h-9"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Data</Label>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-9" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Hora</Label>
          <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 h-9" />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Frequência</Label>
          <Select value={freq} onValueChange={(v) => setFreq(v as LeadTaskFrequency)}>
            <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="once">Uma vez</SelectItem>
              <SelectItem value="daily">Diariamente</SelectItem>
              <SelectItem value="weekly">Semanalmente</SelectItem>
              <SelectItem value="monthly">Mensalmente</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {kind === "mensagem" && (
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Mensagem {leadPhone ? <span className="normal-case text-muted-foreground/70">→ {leadPhone}</span> : <span className="text-destructive">(lead sem WhatsApp)</span>}
          </Label>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder={`Olá ${leadName || "{{nome}}"}, tudo bem? ...`}
            className="mt-1 text-sm"
          />
          <div className="text-[10px] text-muted-foreground mt-1">
            Placeholders: <code>{"{{nome}}"}</code> será substituído pelo nome do lead no envio.
          </div>
        </div>
      )}
      <Button size="sm" onClick={submit} disabled={saving} className="w-full gap-1 h-9">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarClock className="w-3.5 h-3.5" />}
        {kind === "mensagem" ? "Agendar mensagem" : "Criar lembrete"}
      </Button>
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
  const safeDate = (v: string | null | undefined): Date | null => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d;
  };
  const commitDate = () => {
    const parsed = safeDate(dueDate);
    const newVal = parsed ? parsed.toISOString() : null;
    if (newVal !== task.due_date) onUpdate({ due_date: newVal });
  };

  const isScheduled = task.task_type === "mensagem" || task.task_type === "lembrete";
  const scheduleSummary = (() => {
    if (!isScheduled || !task.scheduled_date) return null;
    const d = safeDate(`${task.scheduled_date}T${task.scheduled_time || "09:00"}:00`);
    if (!d) return null;
    const dateStr = format(d, "dd/MM 'às' HH:mm", { locale: ptBR });
    const freqStr = task.frequency && task.frequency !== "once" ? `, repete ${FREQ_LABEL[task.frequency]}` : "";
    const prefix = task.task_type === "mensagem" ? "Mensagem agendada para" : "Lembrete para";
    return `${prefix} ${dateStr}${freqStr}`;
  })();

  const status = (() => {
    if (task.task_type !== "mensagem") return null;
    const sent = safeDate(task.last_sent_at);
    if (sent) return { label: `Enviada ${formatDistanceToNow(sent, { addSuffix: true, locale: ptBR })}`, tone: "default" as const };
    const next = safeDate(task.next_send_at);
    if (next) return { label: `Próximo envio ${formatDistanceToNow(next, { addSuffix: true, locale: ptBR })}`, tone: "secondary" as const };
    return { label: "Pendente", tone: "outline" as const };
  })();

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-border/50 bg-card/40">
      <div className="flex items-center gap-2 p-2">
        <Checkbox checked={task.done} onCheckedChange={(v) => onToggle(!!v)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {task.task_type === "mensagem" && <MessageSquare className="w-3.5 h-3.5 text-primary shrink-0" />}
            {task.task_type === "lembrete" && <Bell className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              className={`h-8 border-transparent bg-transparent focus-visible:border-border ${task.done ? "line-through text-muted-foreground" : ""}`}
            />
          </div>
          {scheduleSummary && (
            <div className="flex items-center gap-2 pl-6 mt-0.5">
              <span className="text-[11px] text-muted-foreground">{scheduleSummary}</span>
              {status && <Badge variant={status.tone} className="text-[10px] h-4 px-1.5">{status.label}</Badge>}
            </div>
          )}
        </div>
        {!isScheduled && (
          <Input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            onBlur={commitDate}
            className="w-36 h-8 text-xs"
          />
        )}
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
          {task.task_type === "mensagem" && task.message_body && (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-2 text-sm whitespace-pre-wrap">
              {task.message_body}
            </div>
          )}
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
            <span>{(() => { const d = new Date(c.created_at); return isNaN(d.getTime()) ? "" : formatDistanceToNow(d, { addSuffix: true, locale: ptBR }); })()}</span>
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
