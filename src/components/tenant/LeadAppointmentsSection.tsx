import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Calendar, Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
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

const STATUS_OPTIONS = [
  { value: "agendado",   label: "Confirmado", color: "text-blue-400" },
  { value: "compareceu", label: "Compareceu", color: "text-emerald-400" },
  { value: "no_show",    label: "No-show",    color: "text-rose-400" },
  { value: "reagendado", label: "Reagendado", color: "text-yellow-400" },
  { value: "cancelado",  label: "Cancelado",  color: "text-slate-400" },
];
const STATUS_MAP = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s]));

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
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const cols = "id, date_time, duration_minutes, appointment_type, procedure, status, client_name, client_phone, lead_id";
    // 1) direct link by lead_id
    const byLead = supabase
      .from("appointments")
      .select(cols)
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId);
    // 2) fallback: match by normalized phone (last 11 digits) for legacy rows
    const digits = (leadPhone || "").replace(/\D/g, "");
    const normalized = digits.slice(-11);
    const byPhone = normalized.length >= 8
      ? supabase
          .from("appointments")
          .select(cols)
          .eq("tenant_id", tenantId)
          .is("lead_id", null)
          .ilike("client_phone", `%${normalized}%`)
      : Promise.resolve({ data: [] as any[] });

    const [{ data: a }, { data: b }] = await Promise.all([byLead, byPhone as any]);
    const map = new Map<string, Row>();
    [...(a || []), ...(b || [])].forEach((r: any) => map.set(r.id, r as Row));
    const merged = Array.from(map.values()).sort(
      (x, y) => new Date(y.date_time).getTime() - new Date(x.date_time).getTime()
    );
    setRows(merged);
    setLoading(false);
  }, [tenantId, leadId, leadPhone]);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (row: Row, newStatus: string) => {
    if (newStatus === row.status) return;
    setUpdatingId(row.id);
    // Optimistic update
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: newStatus } : r)));
    const { error } = await supabase.from("appointments").update({ status: newStatus }).eq("id", row.id);
    setUpdatingId(null);
    if (error) {
      // Rollback
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, status: row.status } : r)));
      toast.error(`Falha ao atualizar: ${error.message}`);
      return;
    }
    toast.success(`Status: ${STATUS_MAP[newStatus]?.label ?? newStatus}`);
  };

  const doDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    const { error } = await supabase.from("appointments").delete().eq("id", pendingDelete.id);
    setDeleting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Agendamento excluído");
    setRows((prev) => prev.filter((r) => r.id !== pendingDelete.id));
    setPendingDelete(null);
  };

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
            const s = STATUS_MAP[r.status] || STATUS_MAP.agendado;
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
                <Select value={r.status} onValueChange={(v) => updateStatus(r, v)} disabled={updatingId === r.id}>
                  <SelectTrigger className={`h-7 w-[130px] text-[11px] font-semibold ${s.color}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className={`text-xs ${o.color}`}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {updatingId === r.id && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingId(r.id); setOpen(true); }} title="Editar">
                  <Pencil className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => setPendingDelete(r)} title="Excluir">
                  <Trash2 className="w-3 h-3" />
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

      <AlertDialog open={!!pendingDelete} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && (
                <>
                  Esta ação removerá permanentemente o agendamento de{" "}
                  <span className="font-medium">{pendingDelete.appointment_type || "Consulta"}</span> em{" "}
                  <span className="font-medium">
                    {new Date(pendingDelete.date_time).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={doDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
