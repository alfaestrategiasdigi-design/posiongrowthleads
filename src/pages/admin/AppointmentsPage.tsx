import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Loader2, Download, CalendarDays, List, Sun, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import AppointmentModal from "@/components/admin/AppointmentModal";
import MonthCalendar from "@/components/admin/MonthCalendar";
import { APPOINTMENT_STATUS, APPOINTMENT_TYPES, type Appointment } from "@/types/appointment";

const AppointmentsPage = () => {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [defaultDate, setDefaultDate] = useState<Date | null>(null);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [filterStatus, setFilterStatus] = useState<string>("todos");
  const [filterQuery, setFilterQuery] = useState("");

  const loadAppointments = async () => {
    setLoading(true);
    // Agenda do Admin Master (POSION) — somente registros sem tenant.
    const { data, error } = await supabase
      .from("appointments")
      .select("*")
      .is("tenant_id", null)
      .order("date_time", { ascending: true });
    if (error) toast.error("Erro ao carregar agendamentos");
    else setAppointments((data || []) as Appointment[]);
    setLoading(false);
  };

  useEffect(() => { loadAppointments(); }, []);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("appointments-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, () => loadAppointments())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const openNew = (date?: Date) => {
    setEditing(null);
    setDefaultDate(date || null);
    setModalOpen(true);
  };

  const openEdit = (a: Appointment) => {
    setEditing(a);
    setDefaultDate(null);
    setModalOpen(true);
  };

  // ---- Today panel data
  const todayStart = useMemo(() => {
    const d = new Date(); d.setHours(0, 0, 0, 0); return d;
  }, []);
  const todayEnd = useMemo(() => {
    const d = new Date(); d.setHours(23, 59, 59, 999); return d;
  }, []);
  const todaysAppts = appointments.filter((a) => {
    const t = new Date(a.date_time).getTime();
    return t >= todayStart.getTime() && t <= todayEnd.getTime();
  });
  const countByStatus = (s: string) => todaysAppts.filter((a) => a.status === s).length;
  const nextAppt = appointments.find((a) => new Date(a.date_time).getTime() > Date.now() && a.status === "agendado");

  // ---- List filters
  const filteredList = appointments.filter((a) => {
    if (filterStatus !== "todos" && a.status !== filterStatus) return false;
    if (filterQuery && !a.client_name.toLowerCase().includes(filterQuery.toLowerCase())) return false;
    return true;
  });

  const exportCSV = () => {
    if (filteredList.length === 0) return;
    const headers = ["Data/Hora", "Cliente", "Telefone", "Tipo", "Procedimento", "Canal", "Status"];
    const rows = filteredList.map((a) => [
      new Date(a.date_time).toLocaleString("pt-BR"),
      a.client_name,
      a.client_phone,
      APPOINTMENT_TYPES[a.appointment_type as keyof typeof APPOINTMENT_TYPES] || a.appointment_type,
      a.procedure || "",
      a.channel || "",
      APPOINTMENT_STATUS[a.status as keyof typeof APPOINTMENT_STATUS]?.label || a.status,
    ].join(";"));
    const csv = [headers.join(";"), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `agendamentos-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  const quickUpdateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("appointments").update({ status }).eq("id", id);
    if (error) toast.error("Erro ao atualizar");
    else toast.success("Status atualizado");
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary/70 mb-1">POSION · Admin Master</div>
          <h1 className="text-2xl font-bold text-foreground">Agenda de Reuniões</h1>
          <p className="text-muted-foreground text-sm">Reuniões dos leads da agência POSION</p>
        </div>
        <Button onClick={() => openNew()} className="gap-2 bg-accent hover:bg-accent/90">
          <Plus className="w-4 h-4" /> Novo Agendamento
        </Button>
      </div>

      <Tabs defaultValue="calendar" className="w-full">
        <TabsList>
          <TabsTrigger value="calendar" className="gap-2"><CalendarDays className="w-4 h-4" /> Calendário</TabsTrigger>
          <TabsTrigger value="list" className="gap-2"><List className="w-4 h-4" /> Lista</TabsTrigger>
          <TabsTrigger value="today" className="gap-2"><Sun className="w-4 h-4" /> Hoje</TabsTrigger>
        </TabsList>

        {/* CALENDÁRIO */}
        <TabsContent value="calendar" className="mt-4">
          <MonthCalendar
            currentMonth={currentMonth}
            setCurrentMonth={setCurrentMonth}
            appointments={appointments}
            onSelectDate={(d) => openNew(d)}
            onSelectAppointment={(a) => openEdit(a)}
          />
          {/* Legenda */}
          <div className="flex flex-wrap gap-3 mt-4 text-xs">
            {Object.entries(APPOINTMENT_STATUS).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: v.hex }} />
                <span className="text-muted-foreground">{v.label}</span>
              </div>
            ))}
          </div>
        </TabsContent>

        {/* LISTA */}
        <TabsContent value="list" className="mt-4 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              placeholder="🔍 Buscar por nome..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="max-w-xs"
            />
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os status</SelectItem>
                {Object.entries(APPOINTMENT_STATUS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={exportCSV} className="gap-2 ml-auto">
              <Download className="w-4 h-4" /> CSV
            </Button>
          </div>

          <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b border-border/50">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">Data/Hora</th>
                  <th className="text-left px-4 py-3 font-medium">Cliente</th>
                  <th className="text-left px-4 py-3 font-medium">Tipo</th>
                  <th className="text-left px-4 py-3 font-medium">Procedimento</th>
                  <th className="text-left px-4 py-3 font-medium">Canal</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum agendamento encontrado</td></tr>
                ) : filteredList.map((a) => {
                  const st = APPOINTMENT_STATUS[a.status as keyof typeof APPOINTMENT_STATUS];
                  return (
                    <tr
                      key={a.id}
                      className="border-b border-border/30 hover:bg-muted/20 cursor-pointer"
                      onClick={() => openEdit(a)}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        {new Date(a.date_time).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-4 py-3 font-medium">{a.client_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{APPOINTMENT_TYPES[a.appointment_type as keyof typeof APPOINTMENT_TYPES] || a.appointment_type}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.procedure || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground">{a.channel || "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block text-xs px-2 py-1 rounded-md border ${st?.bg}`}>
                          {st?.label || a.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* HOJE */}
        <TabsContent value="today" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-card rounded-xl border border-border/50 p-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs"><CalendarDays className="w-4 h-4" /> Hoje</div>
              <div className="text-2xl font-bold mt-1">{todaysAppts.length}</div>
            </div>
            <div className="bg-card rounded-xl border border-border/50 p-4">
              <div className="flex items-center gap-2 text-yellow-400 text-xs"><Clock className="w-4 h-4" /> Agendados</div>
              <div className="text-2xl font-bold mt-1">{countByStatus("agendado")}</div>
            </div>
            <div className="bg-card rounded-xl border border-border/50 p-4">
              <div className="flex items-center gap-2 text-emerald-400 text-xs"><CheckCircle2 className="w-4 h-4" /> Realizados</div>
              <div className="text-2xl font-bold mt-1">{countByStatus("realizado")}</div>
            </div>
            <div className="bg-card rounded-xl border border-border/50 p-4">
              <div className="flex items-center gap-2 text-rose-400 text-xs"><XCircle className="w-4 h-4" /> No-show</div>
              <div className="text-2xl font-bold mt-1">{countByStatus("no_show")}</div>
            </div>
          </div>

          {nextAppt && (
            <div className="bg-gradient-to-r from-accent/10 to-accent/5 border border-accent/30 rounded-xl p-4">
              <div className="text-xs text-accent font-medium mb-1">PRÓXIMO AGENDAMENTO</div>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <div className="font-semibold text-lg">{nextAppt.client_name}</div>
                  <div className="text-sm text-muted-foreground">
                    {new Date(nextAppt.date_time).toLocaleString("pt-BR")} • {nextAppt.procedure || APPOINTMENT_TYPES[nextAppt.appointment_type as keyof typeof APPOINTMENT_TYPES]}
                  </div>
                </div>
                <Button size="sm" variant="outline" onClick={() => openEdit(nextAppt)}>Ver detalhes</Button>
              </div>
            </div>
          )}

          <div className="bg-card rounded-xl border border-border/50">
            <div className="p-4 border-b border-border/50 font-semibold">Cronologia do dia</div>
            {todaysAppts.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Sem agendamentos hoje</div>
            ) : (
              <div className="divide-y divide-border/30">
                {todaysAppts.map((a) => {
                  const st = APPOINTMENT_STATUS[a.status as keyof typeof APPOINTMENT_STATUS];
                  return (
                    <div key={a.id} className="p-4 flex items-center gap-4 flex-wrap">
                      <div className="text-lg font-bold text-accent w-16">
                        {new Date(a.date_time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="flex-1 min-w-[200px]">
                        <div className="font-medium">{a.client_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {a.procedure || APPOINTMENT_TYPES[a.appointment_type as keyof typeof APPOINTMENT_TYPES]} • {a.duration_minutes}min
                        </div>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-md border ${st?.bg}`}>{st?.label}</span>
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" onClick={() => quickUpdateStatus(a.id, "realizado")}>✅</Button>
                        <Button size="sm" variant="outline" onClick={() => quickUpdateStatus(a.id, "no_show")}>❌</Button>
                        <Button size="sm" variant="outline" onClick={() => openEdit(a)}>Editar</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <AppointmentModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSaved={loadAppointments}
        appointment={editing}
        defaultDate={defaultDate}
      />
    </div>
  );
};

export default AppointmentsPage;
