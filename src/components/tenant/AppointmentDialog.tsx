import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Trash2, Search, Link2, X } from "lucide-react";
import { toast } from "sonner";
import { useTenantApptConfig } from "@/hooks/useTenantApptConfig";

export interface AppointmentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId: string;
  /** If present, dialog opens in edit mode */
  appointmentId?: string | null;
  /** Optional lead prefill (from lead panel) */
  prefillLead?: { id: string; name: string; phone?: string | null } | null;
  onSaved?: () => void;
  onDeleted?: () => void;
}

interface LeadHit {
  id: string;
  nome_completo: string;
  whatsapp: string | null;
}

const STATUS_OPTIONS = [
  { value: "agendado", label: "Confirmado" },
  { value: "compareceu", label: "Compareceu" },
  { value: "no_show", label: "No-show" },
  { value: "reagendado", label: "Reagendado" },
  { value: "cancelado", label: "Cancelado" },
];

export default function AppointmentDialog({
  open, onOpenChange, tenantId, appointmentId, prefillLead, onSaved, onDeleted,
}: AppointmentDialogProps) {
  const { config } = useTenantApptConfig(tenantId);
  const isEdit = !!appointmentId;

  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({
    lead_id: null as string | null,
    lead_label: "" as string,
    client_name: "", client_phone: "",
    appointment_type: "", procedure: "",
    date: today, time: "14:00", duration: 60,
    status: "agendado", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [loading, setLoading] = useState(false);

  // Lead search
  const [leadQuery, setLeadQuery] = useState("");
  const [leadHits, setLeadHits] = useState<LeadHit[]>([]);
  const [searchingLead, setSearchingLead] = useState(false);

  // Load appointment when editing
  useEffect(() => {
    if (!open) return;
    if (!isEdit) {
      // Reset for create mode
      setF({
        lead_id: prefillLead?.id ?? null,
        lead_label: prefillLead?.name ?? "",
        client_name: prefillLead?.name ?? "",
        client_phone: prefillLead?.phone ?? "",
        appointment_type: config?.appointment_types[0] || "",
        procedure: config?.team_members[0]?.name || "",
        date: today, time: "14:00",
        duration: config?.default_duration_minutes || 60,
        status: "agendado", notes: "",
      });
      return;
    }
    setLoading(true);
    supabase.from("appointments").select("*").eq("id", appointmentId!).maybeSingle()
      .then(async ({ data }) => {
        if (!data) { setLoading(false); return; }
        const dt = new Date(data.date_time);
        let leadLabel = "";
        if (data.lead_id) {
          const { data: ld } = await supabase.from("leads").select("nome_completo").eq("id", data.lead_id).maybeSingle();
          leadLabel = ld?.nome_completo || "";
        }
        setF({
          lead_id: data.lead_id ?? null,
          lead_label: leadLabel,
          client_name: data.client_name || "",
          client_phone: data.client_phone || "",
          appointment_type: data.appointment_type || "",
          procedure: data.procedure || "",
          date: dt.toISOString().slice(0, 10),
          time: dt.toTimeString().slice(0, 5),
          duration: data.duration_minutes || 60,
          status: data.status || "agendado",
          notes: data.notes || "",
        });
        setLoading(false);
      });
  }, [open, appointmentId, isEdit, prefillLead?.id, config?.default_duration_minutes]);

  // Debounced lead search
  useEffect(() => {
    if (!leadQuery || leadQuery.length < 2) { setLeadHits([]); return; }
    const t = setTimeout(async () => {
      setSearchingLead(true);
      const digits = leadQuery.replace(/\D/g, "");
      let q = supabase.from("leads").select("id, nome_completo, whatsapp").eq("tenant_id", tenantId).limit(8);
      q = digits.length >= 3
        ? q.or(`nome_completo.ilike.%${leadQuery}%,whatsapp.ilike.%${digits}%`)
        : q.ilike("nome_completo", `%${leadQuery}%`);
      const { data } = await q;
      setLeadHits((data || []) as LeadHit[]);
      setSearchingLead(false);
    }, 250);
    return () => clearTimeout(t);
  }, [leadQuery, tenantId]);

  // Auto-suggest: match by phone typed in "Telefone" field when no lead is linked
  const [phoneMatch, setPhoneMatch] = useState<LeadHit | null>(null);
  useEffect(() => {
    if (f.lead_id) { setPhoneMatch(null); return; }
    const digits = (f.client_phone || "").replace(/\D/g, "");
    if (digits.length < 8) { setPhoneMatch(null); return; }
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("leads")
        .select("id, nome_completo, whatsapp")
        .eq("tenant_id", tenantId)
        .ilike("whatsapp", `%${digits.slice(-8)}%`)
        .limit(1);
      setPhoneMatch((data && data[0]) ? (data[0] as LeadHit) : null);
    }, 350);
    return () => clearTimeout(t);
  }, [f.client_phone, f.lead_id, tenantId]);

  const types = config?.appointment_types || [];
  const team = config?.team_members || [];

  const pickLead = (l: LeadHit) => {
    setF((p) => ({
      ...p,
      lead_id: l.id,
      lead_label: l.nome_completo,
      client_name: p.client_name || l.nome_completo,
      client_phone: p.client_phone || l.whatsapp || "",
    }));
    setLeadQuery("");
    setLeadHits([]);
  };
  const clearLead = () => setF((p) => ({ ...p, lead_id: null, lead_label: "" }));

  async function submit() {
    if (!tenantId || !f.client_name.trim()) { toast.error("Paciente é obrigatório"); return; }
    setSaving(true);
    const dt = new Date(`${f.date}T${f.time}:00`).toISOString();
    const payload = {
      tenant_id: tenantId,
      lead_id: f.lead_id,
      client_name: f.client_name.trim(),
      client_phone: f.client_phone || "",
      date_time: dt,
      duration_minutes: Number(f.duration) || 60,
      appointment_type: f.appointment_type || "consulta",
      procedure: f.procedure || null,
      status: f.status,
      notes: f.notes || null,
    };
    const { error } = isEdit
      ? await supabase.from("appointments").update(payload).eq("id", appointmentId!)
      : await supabase.from("appointments").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);

    // Compõe campos do lead com a data da reunião agendada
    if (f.lead_id && payload.status !== "cancelado") {
      const { data: ld } = await supabase
        .from("leads")
        .select("status, reuniao_agendada_em")
        .eq("id", f.lead_id)
        .maybeSingle();
      const patch: Record<string, any> = { reuniao_agendada_em: dt };
      const st = ld?.status;
      if (payload.status === "compareceu") {
        patch.reuniao_realizada_em = dt;
        if (st === "lead" || st === "qualificado" || st === "reuniao_agendada") patch.status = "compareceu";
      } else if (st === "lead" || st === "qualificado") {
        patch.status = "reuniao_agendada";
      }
      await supabase.from("leads").update(patch as any).eq("id", f.lead_id);
    }

    toast.success(isEdit ? "Agendamento atualizado" : "Agendamento criado");
    onSaved?.();
    onOpenChange(false);
  }

  async function doDelete() {
    if (!appointmentId) return;
    setDeleting(true);
    const { error } = await supabase.from("appointments").delete().eq("id", appointmentId);
    setDeleting(false);
    setConfirmDelete(false);
    if (error) return toast.error(error.message);
    toast.success("Agendamento excluído");
    onDeleted?.();
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isEdit ? "Editar agendamento" : "Novo agendamento"}</DialogTitle>
            <DialogDescription className="text-xs">
              Vincule o agendamento a um lead para manter o histórico do paciente unificado.
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {/* Lead link */}
              <div className="col-span-2">
                <Label className="flex items-center gap-1.5"><Link2 className="w-3.5 h-3.5" /> Lead vinculado</Label>
                {f.lead_id ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2">
                    <div className="text-sm truncate">{f.lead_label || "Lead"}</div>
                    <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={clearLead}>
                      <X className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                      <Input
                        className="pl-7"
                        placeholder="Buscar lead por nome ou telefone…"
                        value={leadQuery}
                        onChange={(e) => setLeadQuery(e.target.value)}
                      />
                    </div>
                    {leadHits.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-lg max-h-56 overflow-auto">
                        {leadHits.map((l) => (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => pickLead(l)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex flex-col"
                          >
                            <span className="truncate">{l.nome_completo}</span>
                            {l.whatsapp && <span className="text-[11px] text-muted-foreground">{l.whatsapp}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                    {searchingLead && (
                      <div className="absolute right-2 top-1/2 -translate-y-1/2"><Loader2 className="w-3.5 h-3.5 animate-spin" /></div>
                    )}
                  </div>
                )}
              </div>

              <div className="col-span-2"><Label>Paciente *</Label>
                <Input value={f.client_name} onChange={(e) => setF({ ...f, client_name: e.target.value })} />
              </div>
              <div className="col-span-2"><Label>Telefone</Label>
                <Input value={f.client_phone} onChange={(e) => setF({ ...f, client_phone: e.target.value })} placeholder="(11) 99999-9999" />
                {phoneMatch && !f.lead_id && (
                  <button
                    type="button"
                    onClick={() => pickLead(phoneMatch)}
                    className="mt-1 text-[11px] text-primary hover:underline flex items-center gap-1"
                  >
                    <Link2 className="w-3 h-3" /> Vincular a lead existente: {phoneMatch.nome_completo}
                  </button>
                )}
              </div>

              <div>
                <Label>Tipo</Label>
                {types.length > 0 ? (
                  <Select value={f.appointment_type} onValueChange={(v) => setF({ ...f, appointment_type: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={f.appointment_type} onChange={(e) => setF({ ...f, appointment_type: e.target.value })} placeholder="Ex: Avaliação" />
                )}
              </div>
              <div>
                <Label>Responsável</Label>
                {team.length > 0 ? (
                  <Select value={f.procedure} onValueChange={(v) => setF({ ...f, procedure: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{team.map((r) => <SelectItem key={r.name} value={r.name}>{r.name}{r.role ? ` — ${r.role}` : ""}</SelectItem>)}</SelectContent>
                  </Select>
                ) : (
                  <Input value={f.procedure} onChange={(e) => setF({ ...f, procedure: e.target.value })} placeholder="Nome do responsável" />
                )}
              </div>

              <div><Label>Data</Label><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></div>
              <div><Label>Horário</Label><Input type="time" value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></div>

              <div>
                <Label>Duração (min)</Label>
                <Select value={String(f.duration)} onValueChange={(v) => setF({ ...f, duration: Number(v) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[15,30,45,60,90,120,180].map((d) => <SelectItem key={d} value={String(d)}>{d} min</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2"><Label>Observação</Label>
                <Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              </div>
            </div>
          )}

          <DialogFooter className="flex-row items-center justify-between sm:justify-between gap-2">
            <div>
              {isEdit && (
                <Button variant="ghost" size="sm" className="text-destructive gap-2" onClick={() => setConfirmDelete(true)}>
                  <Trash2 className="w-4 h-4" /> Excluir
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button onClick={submit} disabled={saving || loading}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEdit ? "Salvar alterações" : "Criar")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir agendamento?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação não pode ser desfeita. O agendamento será removido permanentemente da agenda.
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
    </>
  );
}
