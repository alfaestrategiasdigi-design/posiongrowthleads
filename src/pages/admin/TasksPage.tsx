import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { format, formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CheckCircle2, Clock, MessageSquare, Bell, ListTodo, User, Loader2, Building2 } from "lucide-react";
import UnifiedLeadPanel from "@/components/leads/UnifiedLeadPanel";

type Filter = "pendente" | "atrasada" | "concluida" | "todas";

interface TaskRow {
  id: string;
  title: string;
  done: boolean;
  due_date: string | null;
  assignee_user_id: string | null;
  lead_id: string | null;
  agency_lead_id: string | null;
  tenant_id: string | null;
  task_type: "geral" | "lembrete" | "mensagem" | null;
  scheduled_date: string | null;
  scheduled_time: string | null;
  frequency: string | null;
  next_send_at: string | null;
  last_sent_at: string | null;
  message_body: string | null;
  created_at: string;
  lead?: { id: string; nome_completo: string | null; whatsapp: string | null } | null;
  agency_lead?: { id: string; nome_clinica: string | null; responsavel: string | null } | null;
  tenant?: { name: string | null } | null;
  assignee?: { email: string | null } | null;
}

const typeMeta: Record<string, { label: string; icon: any; badge: string }> = {
  mensagem: { label: "Mensagem", icon: MessageSquare, badge: "bg-green-500/15 text-green-300" },
  lembrete: { label: "Lembrete", icon: Bell,          badge: "bg-blue-500/15 text-blue-300" },
  geral:    { label: "Geral",    icon: ListTodo,       badge: "bg-muted text-muted-foreground" },
};

export default function TasksPage() {
  const [rows, setRows] = useState<TaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("pendente");
  const [assignee, setAssignee] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [openLead, setOpenLead] = useState<{ source: "lead" | "agency_lead"; id: string } | null>(null);
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("lead_tasks")
      .select(`
        id, title, done, due_date, assignee_user_id, lead_id, agency_lead_id, tenant_id,
        task_type, scheduled_date, scheduled_time, frequency, next_send_at, last_sent_at, message_body, created_at,
        lead:leads (id, nome_completo, whatsapp),
        agency_lead:agency_leads (id, nome_clinica, responsavel),
        tenant:tenants (name)
      `)
      .order("created_at", { ascending: false })
      .limit(500);
    setRows((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const channel = supabase
      .channel("tasks-page-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_tasks" },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const assignees = useMemo(() => {
    const set = new Map<string, string>();
    rows.forEach((r) => {
      if (r.assignee_user_id) set.set(r.assignee_user_id, r.assignee_user_id.slice(0, 8));
    });
    return Array.from(set.entries());
  }, [rows]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return rows.filter((r) => {
      if (assignee !== "all" && r.assignee_user_id !== assignee) return false;
      if (filter === "pendente" && r.done) return false;
      if (filter === "concluida" && !r.done) return false;
      if (filter === "atrasada") {
        if (r.done) return false;
        if (!r.due_date || new Date(r.due_date).getTime() >= now) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = [
          r.title,
          r.lead?.nome_completo,
          r.agency_lead?.nome_clinica,
          r.agency_lead?.responsavel,
          r.tenant?.name,
          r.message_body,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, filter, assignee, search]);

  const toggleDone = async (id: string, done: boolean) => {
    await supabase.from("lead_tasks").update({ done: !done }).eq("id", id);
  };

  const counts = useMemo(() => {
    const now = Date.now();
    return {
      pendente: rows.filter((r) => !r.done).length,
      atrasada: rows.filter((r) => !r.done && r.due_date && new Date(r.due_date).getTime() < now).length,
      concluida: rows.filter((r) => r.done).length,
    };
  }, [rows]);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ListTodo className="w-6 h-6 text-primary" /> Tarefas
          </h1>
          <p className="text-sm text-muted-foreground">
            Central de tarefas comerciais — todos os leads, todos os tenants.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="border-blue-500/30 text-blue-300">
            {counts.pendente} pendentes
          </Badge>
          <Badge variant="outline" className="border-rose-500/30 text-rose-300">
            {counts.atrasada} atrasadas
          </Badge>
          <Badge variant="outline" className="border-emerald-500/30 text-emerald-300">
            {counts.concluida} concluídas
          </Badge>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="pendente">Pendentes</SelectItem>
            <SelectItem value="atrasada">Atrasadas</SelectItem>
            <SelectItem value="concluida">Concluídas</SelectItem>
            <SelectItem value="todas">Todas</SelectItem>
          </SelectContent>
        </Select>
        <Select value={assignee} onValueChange={setAssignee}>
          <SelectTrigger className="w-56"><SelectValue placeholder="Responsável" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos responsáveis</SelectItem>
            {assignees.map(([id, label]) => (
              <SelectItem key={id} value={id}>Usuário {label}…</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Buscar por lead, cliente, texto…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Recarregar"}
        </Button>
      </div>

      <div className="rounded-lg border border-border/50 overflow-hidden">
        {loading ? (
          <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Nenhuma tarefa nesse filtro.</div>
        ) : (
          <ul className="divide-y divide-border/50">
            {filtered.map((t) => {
              const meta = typeMeta[t.task_type ?? "geral"] ?? typeMeta.geral;
              const Icon = meta.icon;
              const overdue = !t.done && t.due_date && new Date(t.due_date).getTime() < Date.now();
              const leadName = t.lead?.nome_completo || t.agency_lead?.nome_clinica || t.agency_lead?.responsavel || "—";
              return (
                <li key={t.id} className="p-3 flex items-start gap-3 hover:bg-muted/30 transition-colors">
                  <Checkbox checked={t.done} onCheckedChange={() => toggleDone(t.id, t.done)} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className={`text-sm font-medium ${t.done ? "line-through text-muted-foreground" : ""}`}>
                        {t.title}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${meta.badge}`}>
                        {meta.label}
                      </span>
                      {t.frequency && t.frequency !== "once" && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300 font-semibold">
                          {t.frequency === "daily" ? "Diária" : t.frequency === "weekly" ? "Semanal" : "Mensal"}
                        </span>
                      )}
                      {overdue && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-rose-500/15 text-rose-300 font-semibold">
                          Atrasada
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {leadName}
                      </span>
                      {t.tenant?.name && (
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3" /> {t.tenant.name}
                        </span>
                      )}
                      {t.due_date && (
                        <span className={`flex items-center gap-1 ${overdue ? "text-rose-400" : ""}`}>
                          <Clock className="w-3 h-3" />
                          {format(new Date(t.due_date), "dd/MM 'às' HH:mm", { locale: ptBR })}
                        </span>
                      )}
                      {t.next_send_at && (
                        <span className="flex items-center gap-1 text-blue-300">
                          <MessageSquare className="w-3 h-3" />
                          Próx. envio: {format(new Date(t.next_send_at), "dd/MM HH:mm", { locale: ptBR })}
                        </span>
                      )}
                      {t.last_sent_at && (
                        <span className="flex items-center gap-1 text-emerald-300">
                          <CheckCircle2 className="w-3 h-3" />
                          Último envio {formatDistanceToNow(new Date(t.last_sent_at), { addSuffix: true, locale: ptBR })}
                        </span>
                      )}
                    </div>
                    {t.task_type === "mensagem" && t.message_body && (
                      <div className="mt-1 text-xs bg-muted/40 rounded p-2 border border-border/40 line-clamp-2">
                        {t.message_body}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (t.lead_id) setOpenLead({ source: "lead", id: t.lead_id });
                      else if (t.agency_lead_id) setOpenLead({ source: "agency_lead", id: t.agency_lead_id });
                    }}
                  >
                    Abrir lead
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <UnifiedLeadPanel
        source={openLead?.source ?? null}
        leadId={openLead?.id ?? null}
        open={!!openLead}
        onClose={() => setOpenLead(null)}
        onUpdated={load}
      />
    </div>
  );
}
