import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { maskPhone, unmask } from "@/lib/masks";
import {
  APPOINTMENT_TYPES, APPOINTMENT_STATUS, DURATIONS, CHANNELS, REMINDER_OPTIONS,
  type Appointment,
} from "@/types/appointment";
import LeadContextCard from "@/components/leads/panel/LeadContextCard";
import UnifiedLeadPanel from "@/components/leads/UnifiedLeadPanel";

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  appointment?: Appointment | null;
  defaultDate?: Date | null;
}

const emptyForm = (defaultDate?: Date | null) => {
  const d = defaultDate ?? new Date();
  // round to next half hour
  const m = d.getMinutes();
  d.setMinutes(m < 30 ? 30 : 0);
  if (m >= 30) d.setHours(d.getHours() + 1);
  d.setSeconds(0); d.setMilliseconds(0);
  const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return {
    lead_id: null as string | null,
    agency_lead_id: null as string | null,
    client_name: "",
    client_phone: "",
    date_time: iso,
    duration_minutes: 30,
    appointment_type: "avaliacao",
    procedure: "",
    responsible_user_id: null as string | null,
    channel: "Instagram",
    status: "agendado",
    notes: "",
    send_reminder: true,
    reminder_hours_before: 24,
  };
};

const AppointmentModal = ({ open, onClose, onSaved, appointment, defaultDate }: Props) => {
  const [form, setForm] = useState(emptyForm(defaultDate));
  const [saving, setSaving] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [leadQuery, setLeadQuery] = useState("");
  const [showLeadPanel, setShowLeadPanel] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (appointment) {
      const localIso = new Date(
        new Date(appointment.date_time).getTime() - new Date().getTimezoneOffset() * 60000
      ).toISOString().slice(0, 16);
      setForm({
        lead_id: appointment.lead_id,
        agency_lead_id: (appointment as any).agency_lead_id ?? null,
        client_name: appointment.client_name,
        client_phone: maskPhone(appointment.client_phone),
        date_time: localIso,
        duration_minutes: appointment.duration_minutes,
        appointment_type: appointment.appointment_type,
        procedure: appointment.procedure || "",
        responsible_user_id: appointment.responsible_user_id,
        channel: appointment.channel || "Instagram",
        status: appointment.status,
        notes: appointment.notes || "",
        send_reminder: appointment.send_reminder,
        reminder_hours_before: appointment.reminder_hours_before,
      });
    } else {
      setForm(emptyForm(defaultDate));
    }
  }, [open, appointment, defaultDate]);

  useEffect(() => {
    if (!open) return;
    (async () => {
      // Combina leads da agência (agency_leads) + contatos de conversas WhatsApp (Admin Master)
      const [{ data: agency }, { data: convs }] = await Promise.all([
        supabase
          .from("agency_leads")
          .select("id, nome_clinica, responsavel, whatsapp")
          .order("created_at", { ascending: false })
          .limit(200),
        supabase
          .from("conversations")
          .select("id, nome_contato, telefone, lead_id")
          .is("tenant_id", null)
          .order("ultima_interacao", { ascending: false })
          .limit(200),
      ]);

      const items: any[] = (agency || []).map((l) => ({
        source: "agency" as const,
        id: l.id,
        nome_clinica: l.nome_clinica,
        responsavel: l.responsavel,
        whatsapp: l.whatsapp,
      }));

      const seenPhones = new Set(
        items.map((i) => (i.whatsapp || "").replace(/\D/g, "")).filter(Boolean),
      );
      for (const c of convs || []) {
        const digits = (c.telefone || "").replace(/\D/g, "");
        if (!digits || seenPhones.has(digits)) continue;
        seenPhones.add(digits);
        items.push({
          source: "whatsapp" as const,
          id: c.id,
          nome_clinica: "WhatsApp",
          responsavel: c.nome_contato || c.telefone,
          whatsapp: c.telefone,
        });
      }
      setLeads(items);
    })();
  }, [open]);

  const filteredLeads = leads.filter((l) => {
    if (!leadQuery) return true;
    const q = leadQuery.toLowerCase();
    return (
      l.nome_clinica?.toLowerCase().includes(q) ||
      l.responsavel?.toLowerCase().includes(q) ||
      (l.whatsapp || "").toLowerCase().includes(q)
    );
  });

  const pickLead = (lead: any) => {
    setForm((f) => ({
      ...f,
      lead_id: null,
      agency_lead_id: lead.source === "agency" ? lead.id : null,
      client_name: lead.responsavel || lead.nome_clinica || "",
      client_phone: maskPhone(lead.whatsapp || ""),
    }));
    setLeadQuery("");
  };

  const handleSave = async () => {
    // VALIDATION: Require lead linkage (admin mode requires agency_lead_id)
    if (!form.agency_lead_id) {
      toast.error("⚠️ Vincule um lead antes de criar o agendamento");
      return;
    }

    if (!form.client_name.trim() || !form.client_phone.trim() || !form.date_time) {
      toast.error("Preencha cliente, telefone e data/hora");
      return;
    }
    setSaving(true);
    const payload = {
      lead_id: form.lead_id,
      agency_lead_id: form.agency_lead_id, // REQUIRED for admin flow
      tenant_id: null, // Agenda do Admin Master (POSION) — nunca associada a tenant
      client_name: form.client_name.trim(),
      client_phone: unmask(form.client_phone),
      date_time: new Date(form.date_time).toISOString(),
      duration_minutes: form.duration_minutes,
      appointment_type: form.appointment_type,
      procedure: form.procedure || null,
      responsible_user_id: form.responsible_user_id,
      channel: form.channel,
      status: form.status,
      notes: form.notes || null,
      send_reminder: form.send_reminder,
      reminder_hours_before: form.reminder_hours_before,
    };

    const { error } = appointment
      ? await supabase.from("appointments").update(payload).eq("id", appointment.id)
      : await supabase.from("appointments").insert(payload);

    setSaving(false);
    if (error) {
      toast.error("Erro ao salvar: " + error.message);
      return;
    }
    toast.success(appointment ? "Agendamento atualizado" : "Agendamento criado");
    onSaved();
    onClose();
  };

  const handleDelete = async () => {
    if (!appointment) return;
    if (!confirm("Excluir este agendamento?")) return;
    const { error } = await supabase.from("appointments").delete().eq("id", appointment.id);
    if (error) { toast.error("Erro ao excluir"); return; }
    toast.success("Agendamento excluído");
    onSaved();
    onClose();
  };

  // Disable save button if no lead is linked
  const canSave = !!form.agency_lead_id && form.client_name.trim() && form.client_phone.trim() && form.date_time;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{appointment ? "Editar Agendamento" : "Novo Agendamento"}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-2">
          {form.agency_lead_id && (
            <div className="md:col-span-2">
              <LeadContextCard
                source="agency_lead"
                leadId={form.agency_lead_id}
                onOpenPanel={() => setShowLeadPanel(true)}
              />
            </div>
          )}

          <div className="md:col-span-2">
            <Label>Cliente * {!form.agency_lead_id && <span className="text-destructive">(Vincule um lead)</span>}</Label>
            <Input
              placeholder="Nome do cliente"
              value={form.client_name}
              onChange={(e) => setForm({ ...form, client_name: e.target.value })}
            />
            <div className="mt-2 relative">
              <Input
                placeholder="🔍 Buscar lead POSION ou contato do WhatsApp…"
                value={leadQuery}
                onChange={(e) => setLeadQuery(e.target.value)}
                className="text-xs"
              />
              {leadQuery && filteredLeads.length > 0 && (
                <div className="absolute z-10 w-full mt-1 bg-popover border border-border rounded-md shadow-lg max-h-56 overflow-y-auto">
                  {filteredLeads.slice(0, 12).map((l) => (
                    <button
                      key={`${l.source}-${l.id}`}
                      type="button"
                      onClick={() => pickLead(l)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted flex justify-between items-center gap-2"
                    >
                      <span className="min-w-0 truncate">
                        <span className={`inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded mr-2 ${l.source === "whatsapp" ? "bg-green-500/15 text-green-400" : "bg-primary/15"}`}>
                          {l.source === "whatsapp" ? "WhatsApp" : "POSION"}
                        </span>
                        {l.responsavel || l.nome_clinica}
                        {l.source === "agency" && l.nome_clinica && (
                          <span className="text-muted-foreground"> · {l.nome_clinica}</span>
                        )}
                      </span>
                      <span className="text-muted-foreground shrink-0">{l.whatsapp}</span>
                    </button>
                  ))}
                </div>
              )}
              {form.agency_lead_id && (
                <button
                  type="button"
                  className="text-[10px] text-muted-foreground hover:text-destructive mt-1"
                  onClick={() => setForm((f) => ({ ...f, agency_lead_id: null }))}
                >
                  Desvincular lead
                </button>
              )}
            </div>
          </div>

          <div>
            <Label>WhatsApp *</Label>
            <Input
              placeholder="(00) 00000-0000"
              value={form.client_phone}
              onChange={(e) => setForm({ ...form, client_phone: maskPhone(e.target.value) })}
            />
          </div>

          <div>
            <Label>Data e hora *</Label>
            <Input
              type="datetime-local"
              value={form.date_time}
              onChange={(e) => setForm({ ...form, date_time: e.target.value })}
            />
          </div>

          <div>
            <Label>Duração</Label>
            <Select
              value={String(form.duration_minutes)}
              onValueChange={(v) => setForm({ ...form, duration_minutes: Number(v) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {DURATIONS.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d < 60 ? `${d} min` : d === 60 ? "1 hora" : `${Math.floor(d / 60)}h${d % 60 ? d % 60 + "min" : ""}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Tipo</Label>
            <Select
              value={form.appointment_type}
              onValueChange={(v) => setForm({ ...form, appointment_type: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(APPOINTMENT_TYPES).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) => setForm({ ...form, status: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(APPOINTMENT_STATUS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2">
            <Label>Procedimento</Label>
            <Input
              placeholder="Ex: Harmonização facial, Botox..."
              value={form.procedure}
              onChange={(e) => setForm({ ...form, procedure: e.target.value })}
            />
          </div>

          <div>
            <Label>Canal de origem</Label>
            <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Lembrete WhatsApp</Label>
            <Select
              value={String(form.reminder_hours_before)}
              onValueChange={(v) => setForm({ ...form, reminder_hours_before: Number(v), send_reminder: Number(v) > 0 })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {REMINDER_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="md:col-span-2">
            <Label>Observações internas</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {form.reminder_hours_before > 0 && (
            <div className="md:col-span-2 flex items-center gap-3 p-3 rounded-lg bg-accent/5 border border-accent/20">
              <Switch
                checked={form.send_reminder}
                onCheckedChange={(v) => setForm({ ...form, send_reminder: v })}
              />
              <span className="text-sm">
                Enviar lembrete automático via WhatsApp {REMINDER_OPTIONS.find(o => o.value === form.reminder_hours_before)?.label.toLowerCase()}
              </span>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {appointment && (
            <Button variant="destructive" onClick={handleDelete} className="mr-auto gap-2">
              <Trash2 className="w-4 h-4" /> Excluir
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button 
            onClick={handleSave} 
            disabled={saving || !canSave}
            className="gap-2 bg-accent hover:bg-accent/90"
            title={!canSave ? "Vincule um lead para continuar" : ""}
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {appointment ? "Salvar alterações" : "Criar agendamento"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <UnifiedLeadPanel
        source="agency_lead"
        leadId={form.agency_lead_id}
        open={showLeadPanel && !!form.agency_lead_id}
        onClose={() => setShowLeadPanel(false)}
      />
    </Dialog>
  );
};

export default AppointmentModal;
