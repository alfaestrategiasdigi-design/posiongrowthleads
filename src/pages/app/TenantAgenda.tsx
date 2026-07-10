import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalIcon, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import AppointmentDialog from "@/components/tenant/AppointmentDialog";
import LeadDetailModal from "@/components/admin/LeadDetailModal";
import type { Lead } from "@/types/admin";
import { toast } from "sonner";

interface Appointment {
  id: string;
  lead_id: string | null;
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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [loadingLead, setLoadingLead] = useState(false);

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

  const openCreate = () => { setEditingId(null); setDialogOpen(true); };
  const openAppointment = async (a: Appointment) => {
    if (!a.lead_id) {
      setEditingId(a.id);
      setDialogOpen(true);
      return;
    }
    setLoadingLead(true);
    const { data, error } = await supabase.from("leads").select("*").eq("id", a.lead_id).maybeSingle();
    setLoadingLead(false);
    if (error || !data) {
      toast.error("Lead vinculado não encontrado — abrindo edição do agendamento");
      setEditingId(a.id);
      setDialogOpen(true);
      return;
    }
    setSelectedLead(data as Lead);
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Agenda</h1>
          <p className="text-muted-foreground">{tenant?.name} · {appts.length} agendamentos</p>
        </div>
        <Button className="gap-2" onClick={openCreate}><Plus className="w-4 h-4" /> Novo Agendamento</Button>
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
            <MonthView cursor={cursor} byDay={byDay} onEdit={openEdit} />
          ) : view === "semana" ? (
            <WeekView cursor={cursor} byDay={byDay} onEdit={openEdit} />
          ) : (
            <DayView day={cursor} items={byDay.get(cursor.toDateString()) || []} onEdit={openEdit} />
          )}
        </CardContent>
      </Card>

      {tenant && (
        <AppointmentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          tenantId={tenant.id}
          appointmentId={editingId}
          onSaved={load}
          onDeleted={load}
        />
      )}
    </div>
  );
}

function ApptChip({ a, onEdit }: { a: Appointment; onEdit: (id: string) => void }) {
  const s = STATUS_COLORS[a.status] || STATUS_COLORS.agendado;
  const time = new Date(a.date_time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onEdit(a.id); }}
      className="w-full text-left text-[10px] rounded px-1.5 py-0.5 truncate hover:brightness-125 transition"
      style={{ background: s.bg, color: s.fg, borderLeft: `2px solid ${s.fg}` }}
      title={`${time} · ${a.client_name} · ${s.label} — clique para editar`}
    >
      <span className="font-semibold">{time}</span> {a.client_name}
    </button>
  );
}

function MonthView({ cursor, byDay, onEdit }: { cursor: Date; byDay: Map<string, Appointment[]>; onEdit: (id: string) => void }) {
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
                {items.slice(0, 3).map((a) => <ApptChip key={a.id} a={a} onEdit={onEdit} />)}
                {items.length > 3 && <div className="text-[10px] text-muted-foreground">+{items.length - 3} mais</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ cursor, byDay, onEdit }: { cursor: Date; byDay: Map<string, Appointment[]>; onEdit: (id: string) => void }) {
  const start = startOfWeek(cursor);
  return (
    <div className="grid grid-cols-7 gap-2">
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((d) => {
        const items = byDay.get(d.toDateString()) || [];
        return (
          <div key={d.toISOString()} className="border border-border rounded-md p-2 min-h-[300px]">
            <div className="text-xs font-semibold mb-2">{WEEKDAYS[d.getDay()]} {d.getDate()}</div>
            <div className="space-y-1">{items.map((a) => <ApptChip key={a.id} a={a} onEdit={onEdit} />)}</div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({ day, items, onEdit }: { day: Date; items: Appointment[]; onEdit: (id: string) => void }) {
  return (
    <div>
      <div className="text-sm font-semibold mb-3">{day.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}</div>
      <div className="space-y-2">
        {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhum agendamento.</p>}
        {items.map((a) => {
          const s = STATUS_COLORS[a.status] || STATUS_COLORS.agendado;
          const t = new Date(a.date_time);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onEdit(a.id)}
              className="w-full text-left flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/40 transition"
            >
              <div className="text-sm font-mono w-14">{t.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
              <div className="flex-1">
                <div className="font-medium text-sm">{a.client_name}</div>
                <div className="text-xs text-muted-foreground">{a.appointment_type} · {a.duration_minutes}min{a.procedure ? ` · ${a.procedure}` : ""}</div>
              </div>
              <span className="text-xs px-2 py-1 rounded" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
