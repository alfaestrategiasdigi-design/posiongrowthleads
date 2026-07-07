import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import AppointmentDialog from "@/components/tenant/AppointmentDialog";

interface Row {
  id: string;
  date_time: string;
  duration_minutes: number;
  appointment_type: string;
  procedure: string | null;
  status: string;
  client_name: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  agendado:   { label: "Confirmado", color: "text-blue-400" },
  compareceu: { label: "Compareceu", color: "text-emerald-400" },
  no_show:    { label: "No-show",    color: "text-rose-400" },
  reagendado: { label: "Reagendado", color: "text-yellow-400" },
  cancelado:  { label: "Cancelado",  color: "text-slate-400" },
};

interface Props {
  tenantId: string;
  leadId: string;
  leadName: string;
  leadPhone?: string | null;
}

export default function LeadAppointmentsSection({ tenantId, leadId, leadName, leadPhone }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("appointments")
      .select("id, date_time, duration_minutes, appointment_type, procedure, status, client_name")
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .order("date_time", { ascending: false });
    setRows((data || []) as Row[]);
    setLoading(false);
  }, [tenantId, leadId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="rounded-lg border border-border/60 bg-card/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          <h4 className="text-sm font-semibold">Agendamentos deste lead</h4>
          <span className="text-xs text-muted-foreground">({rows.length})</span>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 h-7" onClick={() => { setEditingId(null); setOpen(true); }}>
          <Plus className="w-3.5 h-3.5" /> Agendar
        </Button>
      </div>

      {loading ? (
        <div className="py-6 flex justify-center"><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /></div>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">Nenhum agendamento vinculado. Use "Agendar" para criar um.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => {
            const s = STATUS_LABEL[r.status] || STATUS_LABEL.agendado;
            const dt = new Date(r.date_time);
            return (
              <div key={r.id} className="flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-xs">
                <div className="font-mono text-muted-foreground min-w-[92px]">
                  {dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} {dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                </div>
                <div className="flex-1 truncate">
                  <span className="font-medium">{r.appointment_type || "Consulta"}</span>
                  {r.procedure && <span className="text-muted-foreground"> · {r.procedure}</span>}
                </div>
                <span className={`text-[10px] font-semibold ${s.color}`}>{s.label}</span>
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingId(r.id); setOpen(true); }}>
                  <Pencil className="w-3 h-3" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <AppointmentDialog
        open={open}
        onOpenChange={setOpen}
        tenantId={tenantId}
        appointmentId={editingId}
        prefillLead={editingId ? null : { id: leadId, name: leadName, phone: leadPhone }}
        onSaved={load}
        onDeleted={load}
      />
    </div>
  );
}
