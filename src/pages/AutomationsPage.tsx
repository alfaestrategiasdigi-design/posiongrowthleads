import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Zap, Plus, GitBranch, FileText, ListChecks, History, Play, Pause,
  Search, Sparkles, Trash2, Edit, Loader2,
} from "lucide-react";
import { toast } from "sonner";
import FlowEditor from "@/components/automations/FlowEditor";
import { useFlows, useTemplates, useTasks, type AutomationScope } from "@/hooks/useAutomations";
import { formatDistanceToNow, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { AutomationTemplate } from "@/lib/automations/types";

interface Props { scope: AutomationScope }

export default function AutomationsPage({ scope }: Props) {
  const [view, setView] = useState<"flows" | "templates" | "tasks" | "history">("flows");
  const [editingId, setEditingId] = useState<string | null>(null);

  if (editingId) {
    return <FlowEditor flowId={editingId} onBack={() => setEditingId(null)} />;
  }

  return (
    <div className="p-4 md:p-6 max-w-[1600px] mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 flex items-center justify-center">
            <Zap className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Central de Automações</h1>
            <p className="text-sm text-muted-foreground">
              Crie fluxos de mensagens, gatilhos e follow-ups — {scope.isAdminMaster ? "Agência POSION" : "sua clínica"}
            </p>
          </div>
        </div>
      </header>

      <Tabs value={view} onValueChange={(v) => setView(v as any)}>
        <TabsList>
          <TabsTrigger value="flows"><GitBranch className="w-4 h-4 mr-2" /> Meus Fluxos</TabsTrigger>
          <TabsTrigger value="templates"><Sparkles className="w-4 h-4 mr-2" /> Modelos</TabsTrigger>
          <TabsTrigger value="tasks"><ListChecks className="w-4 h-4 mr-2" /> Tarefas</TabsTrigger>
          <TabsTrigger value="history"><History className="w-4 h-4 mr-2" /> Histórico</TabsTrigger>
        </TabsList>

        <TabsContent value="flows"><FlowsList scope={scope} onEdit={setEditingId} onOpenTemplates={() => setView("templates")} /></TabsContent>
        <TabsContent value="templates"><TemplatesView scope={scope} onCreated={(id) => setEditingId(id)} /></TabsContent>
        <TabsContent value="tasks"><TasksView scope={scope} /></TabsContent>
        <TabsContent value="history"><HistoryView scope={scope} /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================================================
   FLUXOS
============================================================ */
function FlowsList({
  scope, onEdit, onOpenTemplates,
}: { scope: AutomationScope; onEdit: (id: string) => void; onOpenTemplates: () => void }) {
  const { flows, loading, reload } = useFlows(scope);
  const [q, setQ] = useState("");
  const filtered = flows.filter((f) => f.name.toLowerCase().includes(q.toLowerCase()));

  const createBlank = async () => {
    const payload = {
      tenant_id: scope.tenantId,
      is_admin_master: scope.isAdminMaster,
      name: "Novo fluxo",
      trigger_type: "manual",
      nodes: [{ id: "t1", type: "trigger", position: { x: 200, y: 100 }, data: { kind: "manual", label: "Início manual" } }] as any,
      edges: [] as any,
      status: "draft",
    };
    const { data, error } = await supabase.from("automation_flows").insert(payload).select("id").single();
    if (error) return toast.error(error.message);
    toast.success("Fluxo criado");
    onEdit(data.id);
  };

  const toggle = async (id: string, current: string) => {
    const next = current === "active" ? "paused" : "active";
    const { error } = await supabase.from("automation_flows").update({ status: next }).eq("id", id);
    if (error) return toast.error(error.message);
    reload();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este fluxo?")) return;
    const { error } = await supabase.from("automation_flows").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Buscar fluxo…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button variant="outline" onClick={onOpenTemplates} className="gap-2">
          <Sparkles className="w-4 h-4" /> Modelos
        </Button>
        <Button onClick={createBlank} className="gap-2">
          <Plus className="w-4 h-4" /> Novo fluxo
        </Button>
      </div>

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center">
          <Zap className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
          <div className="font-semibold">Nenhum fluxo ainda</div>
          <p className="text-sm text-muted-foreground mb-4">Crie do zero ou escolha um modelo pronto.</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={onOpenTemplates}>Ver modelos</Button>
            <Button onClick={createBlank}>Criar fluxo</Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((f) => {
            const nodeCount = Array.isArray(f.nodes) ? (f.nodes as any).length : 0;
            return (
              <Card key={f.id} className="p-4 space-y-3 hover:border-primary/50 transition-colors group">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{f.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {nodeCount} nós • atualizado {formatDistanceToNow(new Date(f.updated_at), { locale: ptBR, addSuffix: true })}
                    </div>
                  </div>
                  <Badge variant={f.status === "active" ? "default" : f.status === "paused" ? "secondary" : "outline"}>
                    {f.status === "active" ? "Ativo" : f.status === "paused" ? "Pausado" : "Rascunho"}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground">Gatilho: <span className="font-mono">{f.trigger_type}</span></div>
                <div className="flex gap-1.5 pt-2 border-t border-border/60">
                  <Button size="sm" variant="outline" className="flex-1 gap-1" onClick={() => onEdit(f.id)}>
                    <Edit className="w-3 h-3" /> Editar
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => toggle(f.id, f.status)}>
                    {f.status === "active" ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => remove(f.id)}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TEMPLATES
============================================================ */
function TemplatesView({ scope, onCreated }: { scope: AutomationScope; onCreated: (id: string) => void }) {
  const { templates, loading } = useTemplates(scope);

  const useTemplate = async (t: AutomationTemplate) => {
    const payload = {
      tenant_id: scope.tenantId,
      is_admin_master: scope.isAdminMaster,
      name: t.name,
      description: t.description,
      trigger_type: t.trigger_type,
      trigger_config: t.trigger_config as any,
      nodes: t.nodes as any,
      edges: t.edges as any,
      status: "draft",
    };
    const { data, error } = await supabase.from("automation_flows").insert(payload).select("id").single();
    if (error) return toast.error(error.message);
    toast.success(`Modelo "${t.name}" adicionado`);
    onCreated(data.id);
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {templates.map((t) => (
        <Card key={t.id} className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/10 border border-primary/30 flex items-center justify-center text-lg">
              {t.icon || "⚡"}
            </div>
            <div className="flex-1">
              <div className="font-semibold text-sm">{t.name}</div>
              <div className="text-xs text-muted-foreground line-clamp-2">{t.description}</div>
            </div>
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">{Array.isArray(t.nodes) ? (t.nodes as any).length : 0} etapas</Badge>
            <span className="font-mono">{t.trigger_type}</span>
          </div>
          <Button size="sm" className="w-full" onClick={() => useTemplate(t)}>
            Usar este modelo
          </Button>
        </Card>
      ))}
    </div>
  );
}

/* ============================================================
   TAREFAS
============================================================ */
function TasksView({ scope }: { scope: AutomationScope }) {
  const { tasks, loading, reload } = useTasks(scope);
  const [creating, setCreating] = useState(false);

  const cancelTask = async (id: string) => {
    const { error } = await supabase.from("automation_tasks").update({ status: "cancelled" }).eq("id", id);
    if (error) return toast.error(error.message);
    reload();
  };
  const approveTask = async (id: string) => {
    const { error } = await supabase.from("automation_tasks").update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Aprovado — será enviado no horário");
    reload();
  };

  const now = Date.now();

  return (
    <div className="space-y-4">
      <div className="flex justify-between">
        <div className="text-sm text-muted-foreground">{tasks.length} tarefa(s)</div>
        <Button size="sm" variant="outline" className="gap-2" onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4" /> Nova tarefa
        </Button>
      </div>

      {creating && (
        <NewTaskCard scope={scope} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />
      )}

      {loading ? (
        <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : tasks.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted-foreground">
          Nenhuma tarefa agendada.
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase">
              <tr>
                <th className="text-left px-3 py-2 w-12"></th>
                <th className="text-left px-3 py-2">Contato</th>
                <th className="text-left px-3 py-2">Mensagem</th>
                <th className="text-left px-3 py-2">Enviar em</th>
                <th className="text-right px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const scheduled = new Date(t.scheduled_for).getTime();
                const overdue = t.status === "pending" && scheduled < now;
                const color =
                  t.status === "sent" ? "bg-emerald-500" :
                  t.status === "cancelled" || t.status === "failed" ? "bg-destructive" :
                  overdue ? "bg-red-500 animate-pulse" :
                  t.status === "approved" ? "bg-blue-500" :
                  "bg-yellow-500";
                return (
                  <tr key={t.id} className="border-t border-border">
                    <td className="px-3 py-2"><span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} /></td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{t.contact_name || "—"}</div>
                      <div className="text-xs text-muted-foreground font-mono">{t.contact_phone}</div>
                    </td>
                    <td className="px-3 py-2 max-w-md">
                      <div className="line-clamp-2 text-xs">{t.message_content}</div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {format(new Date(t.scheduled_for), "dd/MM HH:mm", { locale: ptBR })}
                      {overdue && <div className="text-destructive font-semibold">Atrasado</div>}
                      {t.status === "sent" && t.sent_at && (
                        <div className="text-emerald-500">Enviado {formatDistanceToNow(new Date(t.sent_at), { locale: ptBR, addSuffix: true })}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {t.requires_approval && t.status === "pending" && (
                        <Button size="sm" variant="outline" onClick={() => approveTask(t.id)}>Aprovar</Button>
                      )}
                      {(t.status === "pending" || t.status === "approved") && (
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancelTask(t.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function NewTaskCard({
  scope, onClose, onCreated,
}: { scope: AutomationScope; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [when, setWhen] = useState<string>(new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16));
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!phone || !msg) return toast.error("Preencha telefone e mensagem");
    setBusy(true);
    const { error } = await supabase.from("automation_tasks").insert({
      tenant_id: scope.tenantId,
      is_admin_master: scope.isAdminMaster,
      contact_name: name || null,
      contact_phone: phone,
      message_content: msg,
      scheduled_for: new Date(when).toISOString(),
      status: "pending",
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Tarefa agendada");
    onCreated();
  };

  return (
    <Card className="p-4 space-y-3 border-primary/40">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input placeholder="Nome do contato" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Telefone (com DDD)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="md:col-span-2">
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
            placeholder="Mensagem"
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
          />
        </div>
        <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button size="sm" onClick={create} disabled={busy}>
          {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Agendar"}
        </Button>
      </div>
    </Card>
  );
}

/* ============================================================
   HISTÓRICO
============================================================ */
function HistoryView({ scope }: { scope: AutomationScope }) {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useState(() => {
    (async () => {
      let q = supabase.from("automation_executions")
        .select("*, automation_flows(name)")
        .order("started_at", { ascending: false }).limit(100);
      if (scope.isAdminMaster) q = q.eq("is_admin_master", true);
      else if (scope.tenantId) q = q.eq("tenant_id", scope.tenantId);
      const { data } = await q;
      setItems(data || []);
      setLoading(false);
    })();
  });

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  if (items.length === 0) return <Card className="p-10 text-center text-sm text-muted-foreground">Nenhuma execução ainda.</Card>;

  return (
    <Card className="p-0 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs uppercase">
          <tr>
            <th className="text-left px-3 py-2">Fluxo</th>
            <th className="text-left px-3 py-2">Contato</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-left px-3 py-2">Iniciado</th>
          </tr>
        </thead>
        <tbody>
          {items.map((x) => (
            <tr key={x.id} className="border-t border-border">
              <td className="px-3 py-2 font-medium">{x.automation_flows?.name || "—"}</td>
              <td className="px-3 py-2 text-xs">{x.contact_name || x.contact_phone || "—"}</td>
              <td className="px-3 py-2">
                <Badge variant={x.status === "completed" ? "default" : x.status === "failed" ? "destructive" : "outline"}>
                  {x.status}
                </Badge>
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(x.started_at), { locale: ptBR, addSuffix: true })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
