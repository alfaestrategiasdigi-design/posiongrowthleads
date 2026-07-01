import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useTenantApptConfig } from "@/hooks/useTenantApptConfig";

interface Appointment {
  id: string;
  client_name: string;
  client_phone: string;
  date_time: string;
  duration_minutes: number;
  appointment_type: string;
  procedure: string | null;
  status: string;
  channel: string | null;
  notes: string | null;
}

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  agendado:    { bg: "#3B82F622", fg: "#3B82F6", label: "Confirmado" },
  confirmado:  { bg: "#3B82F622", fg: "#3B82F6", label: "Confirmado" },
  compareceu:  { bg: "#22C55E22", fg: "#22C55E", label: "Compareceu" },
  no_show:     { bg: "#EF444422", fg: "#EF4444", label: "No-show" },
  reagendado:  { bg: "#EAB30822", fg: "#EAB308", label: "Reagendado" },
  cancelado:   { bg: "#94A3B822", fg: "#94A3B8", label: "Cancelado" },
};

const WEEKDAYS = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

function startOfMonth(d: Date) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function startOfWeek(d: Date) { const x = new Date(d); x.setDate(d.getDate() - d.getDay()); x.setHours(0,0,0,0); return x; }
function addDays(d: Date, n: number) { const x = new Date(d); x.setDate(d.getDate() + n); return x; }
function sameDay(a: Date, b: Date) { return a.toDateString() === b.toDateString(); }

export default function TenantAgenda() {
  const { tenant } = useTenant();
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"mes" | "semana" | "dia">("mes");
  const [cursor, setCursor] = useState(new Date());
  const [open, setOpen] = useState(false);

  async function load() {
    if (!tenant) return;
    setLoading(true);
    const { data } = await supabase.from("appointments").select("*")
      .eq("tenant_id", tenant.id).order("date_time");
    setAppts((data || []) as Appointment[]);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id]);

  const byDay = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of appts) {
      const k = new Date(a.date_time).toDateString();
      const arr = m.get(k) || []; arr.push(a); m.set(k, arr);
    }
    return m;
  }, [appts]);

  function nav(delta: number) {
    const d = new Date(cursor);
    if (view === "mes") d.setMonth(d.getMonth() + delta);
    else if (view === "semana") d.setDate(d.getDate() + delta * 7);
    else d.setDate(d.getDate() + delta);
    setCursor(d);
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agenda</h1>
          <p className="text-muted-foreground">{tenant?.name} · {appts.length} agendamentos</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Novo Agendamento</Button></DialogTrigger>
          <NewAppointmentDialog tenantId={tenant?.id || ""} onCreated={() => { setOpen(false); load(); }} />
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-3 flex-wrap">
          <CardTitle className="text-base flex items-center gap-2"><CalIcon className="w-4 h-4 text-primary" />
            {cursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border overflow-hidden">
              {(["mes","semana","dia"] as const).map((v) => (
                <button key={v} onClick={() => setView(v)}
                  className={"px-3 py-1 text-xs capitalize " + (view === v ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted/50")}>
                  {v}
                </button>
              ))}
            </div>
            <Button size="icon" variant="outline" onClick={() => nav(-1)}><ChevronLeft className="w-4 h-4" /></Button>
            <Button size="sm" variant="outline" onClick={() => setCursor(new Date())}>Hoje</Button>
            <Button size="icon" variant="outline" onClick={() => nav(1)}><ChevronRight className="w-4 h-4" /></Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : view === "mes" ? (
            <MonthView cursor={cursor} byDay={byDay} />
          ) : view === "semana" ? (
            <WeekView cursor={cursor} byDay={byDay} />
          ) : (
            <DayView day={cursor} items={byDay.get(cursor.toDateString()) || []} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ApptChip({ a }: { a: Appointment }) {
  const s = STATUS_COLORS[a.status] || STATUS_COLORS.agendado;
  const time = new Date(a.date_time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="text-[10px] rounded px-1.5 py-0.5 truncate" style={{ background: s.bg, color: s.fg, borderLeft: `2px solid ${s.fg}` }} title={`${time} · ${a.client_name} · ${s.label}`}>
      <span className="font-semibold">{time}</span> {a.client_name}
    </div>
  );
}

function MonthView({ cursor, byDay }: { cursor: Date; byDay: Map<string, Appointment[]> }) {
  const first = startOfMonth(cursor);
  const start = startOfWeek(first);
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const today = new Date();
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAYS.map((w) => <div key={w} className="text-[11px] font-semibold text-muted-foreground text-center py-1">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d, i) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const items = byDay.get(d.toDateString()) || [];
          return (
            <div key={i} className={"min-h-[92px] rounded-md p-1.5 border " + (inMonth ? "bg-card border-border" : "bg-muted/20 border-transparent opacity-50")}>
              <div className={"text-[11px] font-semibold mb-1 " + (sameDay(d, today) ? "text-primary" : "text-foreground")}>{d.getDate()}</div>
              <div className="space-y-0.5">
                {items.slice(0, 3).map((a) => <ApptChip key={a.id} a={a} />)}
                {items.length > 3 && <div className="text-[10px] text-muted-foreground">+{items.length - 3} mais</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ cursor, byDay }: { cursor: Date; byDay: Map<string, Appointment[]> }) {
  const start = startOfWeek(cursor);
  return (
    <div className="grid grid-cols-7 gap-2">
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
        const items = byDay.get(d.toDateString()) || [];
        return (
          <div key={d.toISOString()} className="border border-border rounded-md p-2 min-h-[300px]">
            <div className="text-xs font-semibold mb-2">{WEEKDAYS[d.getDay()]} {d.getDate()}</div>
            <div className="space-y-1">{items.map((a) => <ApptChip key={a.id} a={a} />)}</div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({ day, items }: { day: Date; items: Appointment[] }) {
  return (
    <div>
      <div className="text-sm font-semibold mb-3">{day.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhum agendamento.</p>}
        {items.map((a) => {
          const s = STATUS_COLORS[a.status] || STATUS_COLORS.agendado;
          const t = new Date(a.date_time);
          return (
            <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
              <div className="text-sm font-mono w-14">{t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
              <div className="flex-1">
                <div className="font-medium text-sm">{a.client_name}</div>
                <div className="text-xs text-muted-foreground">{a.appointment_type} · {a.duration_minutes}min</div>
              </div>
              <span className="text-xs px-2 py-1 rounded" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewAppointmentDialog({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const { config } = useTenantApptConfig(tenantId);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    client_name: "", client_phone: "", appointment_type: "",
    date: today, time: "14:00", duration: 60, responsible: "",
    status: "agendado", notes: "",
  });
  const [customType, setCustomType] = useState(false);
  const [customResp, setCustomResp] = useState(false);
  const [customDuration, setCustomDuration] = useState(false);
  const [saving, setSaving] = useState(false);

  // Sync defaults when config arrives
  useEffect(() => {
    if (!config) return;
    setF((prev) => ({
      ...prev,
      appointment_type: prev.appointment_type || config.appointment_types[0] || "",
      responsible: prev.responsible || config.team_members[0]?.name || "",
      duration: prev.duration || config.default_duration_minutes || 60,
    }));
  }, [config]);

  async function submit() {
    if (!tenantId || !f.client_name) { toast.error("Paciente é obrigatório"); return; }
    setSaving(true);
    const dt = new Date(`${f.date}T${f.time}:00`).toISOString();
    const { error } = await supabase.from("appointments").insert({
      tenant_id: tenantId, client_name: f.client_name, client_phone: f.client_phone || "",
      date_time: dt, duration_minutes: Number(f.duration),
      appointment_type: f.appointment_type, procedure: f.responsible,
      status: f.status, notes: f.notes || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Agendamento criado"); onCreated();
  }

  const types = config?.appointment_types || [];
  const team = config?.team_members || [];

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Novo Agendamento</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Paciente *</Label><Input value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} /></div>
        <div className="col-span-2"><Label>Telefone</Label><Input value={f.client_phone} onChange={(e) => setF({ ...f, client_phone: e.target.value })} placeholder="(11) 99999-9999" /></div>
        <div>
          <Label>Tipo</Label>
          {customType || types.length === 0 ? (
            <div className="flex gap-1">
              <Input value={f.appointment_type} onChange={(e) => setF({ ...f, appointment_type: e.target.value })} placeholder="Ex: Avaliação" />
              {types.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setCustomType(false)}>↺</Button>}
            </div>
          ) : (
            <div className="flex gap-1">
              <Select value={f.appointment_type} onValueChange={(v) => setF({ ...f, appointment_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomType(true)} title="Digitar manualmente">✎</Button>
            </div>
          )}
        </div>
        <div>
          <Label>Responsável</Label>
          {customResp || team.length === 0 ? (
            <div className="flex gap-1">
              <Input value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} placeholder="Nome do responsável" />
              {team.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setCustomResp(false)}>↺</Button>}
            </div>
          ) : (
            <div className="flex gap-1">
              <Select value={f.responsible} onValueChange={(v) => setF({ ...f, responsible: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{team.map((r) => <SelectItem key={r.name} value={r.name}>{r.name}{r.role ? ` — ${r.role}` : ""}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomResp(true)} title="Digitar manualmente">✎</Button>
            </div>
          )}
        </div>
        <div><Label>Data</Label><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
        <div><Label>Horário</Label><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></div>
        <div>
          <Label>Duração (min)</Label>
          {customDuration ? (
            <div className="flex gap-1">
              <Input type="number" min={5} value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) || 0 })} />
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomDuration(false)}>↺</Button>
            </div>
          ) : (
            <div className="flex gap-1">
              <Select value={String(f.duration)} onValueChange={(v) => setF({ ...f, duration: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{[15,30,45,60,90,120,180].map((d) => <SelectItem key={d} value={String(d)}>{d} min</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomDuration(true)} title="Digitar manualmente">✎</Button>
            </div>
          )}
        </div>
        <div>
          <Label>Status</Label>
          <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="agendado">Confirmado</SelectItem>
              <SelectItem value="compareceu">Compareceu</SelectItem>
              <SelectItem value="no_show">No-show</SelectItem>
              <SelectItem value="reagendado">Reagendado</SelectItem>
              <SelectItem value="cancelado">Cancelado</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2"><Label>Observação</Label><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      </div>
      <DialogFooter><Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}</Button></DialogFooter>
    </DialogContent>
  );
}
