import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { FileText, Plus, Loader2, Stethoscope } from "lucide-react";
import { toast } from "sonner";

interface Patient { id: string; name: string; whatsapp: string | null }
interface Record {
  id: string; record_type: string; chief_complaint: string | null; treatment_plan: string | null;
  professional_name: string | null; created_at: string; patient_id: string | null;
  allergies: string | null; medications: string | null; medical_history: string | null;
  aesthetic_history: string | null; diagnosis: string | null; notes: string | null;
}

const TYPES = [
  { v: "anamnese", l: "Anamnese inicial" },
  { v: "evolucao", l: "Evolução" },
  { v: "retorno", l: "Retorno" },
  { v: "foto", l: "Registro fotográfico" },
];

export default function TenantProntuario() {
  const { tenant } = useTenant();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [records, setRecords] = useState<Record[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({ record_type: "anamnese" });

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    const [{ data: p }, { data: r }] = await Promise.all([
      supabase.from("patients").select("id, name, whatsapp").eq("tenant_id", tenant.id).order("name"),
      supabase.from("medical_records").select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(100),
    ]);
    setPatients((p || []) as Patient[]);
    setRecords((r || []) as Record[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tenant]);

  const save = async () => {
    if (!tenant || !form.patient_id) { toast.error("Selecione um paciente"); return; }
    setSaving(true);
    const { error } = await supabase.from("medical_records").insert({ tenant_id: tenant.id, ...form });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Prontuário registrado");
    setOpen(false); setForm({ record_type: "anamnese" }); load();
  };

  const patientName = (id: string | null) => patients.find((p) => p.id === id)?.name || "—";

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prontuário eletrônico</h1>
          <p className="text-muted-foreground">Anamnese, evolução e plano de tratamento — {tenant?.name}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Novo registro</Button></DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Novo registro clínico</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Paciente</Label>
                  <Select value={form.patient_id || ""} onValueChange={(v) => setForm({ ...form, patient_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{patients.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <Select value={form.record_type} onValueChange={(v) => setForm({ ...form, record_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1"><Label>Profissional</Label><Input value={form.professional_name || ""} onChange={(e) => setForm({ ...form, professional_name: e.target.value })} /></div>
              <div className="space-y-1"><Label>Queixa principal</Label><Textarea rows={2} value={form.chief_complaint || ""} onChange={(e) => setForm({ ...form, chief_complaint: e.target.value })} /></div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Alergias</Label><Textarea rows={2} value={form.allergies || ""} onChange={(e) => setForm({ ...form, allergies: e.target.value })} /></div>
                <div className="space-y-1"><Label>Medicamentos em uso</Label><Textarea rows={2} value={form.medications || ""} onChange={(e) => setForm({ ...form, medications: e.target.value })} /></div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Histórico médico</Label><Textarea rows={2} value={form.medical_history || ""} onChange={(e) => setForm({ ...form, medical_history: e.target.value })} /></div>
                <div className="space-y-1"><Label>Histórico estético</Label><Textarea rows={2} value={form.aesthetic_history || ""} onChange={(e) => setForm({ ...form, aesthetic_history: e.target.value })} /></div>
              </div>
              <div className="space-y-1"><Label>Diagnóstico / impressão clínica</Label><Textarea rows={2} value={form.diagnosis || ""} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} /></div>
              <div className="space-y-1"><Label>Plano de tratamento</Label><Textarea rows={3} value={form.treatment_plan || ""} onChange={(e) => setForm({ ...form, treatment_plan: e.target.value })} /></div>
              <div className="space-y-1"><Label>Observações</Label><Textarea rows={2} value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
            </div>
            <DialogFooter>
              <Button onClick={save} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Stethoscope className="w-4 h-4 text-primary" /> Registros recentes</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {loading ? <Loader2 className="w-5 h-5 animate-spin text-primary" /> :
           records.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">Nenhum prontuário registrado ainda.</p> :
           records.map((r) => (
            <div key={r.id} className="border rounded-lg p-4 bg-card hover:border-primary/40 transition">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" />
                  <span className="font-medium">{patientName(r.patient_id)}</span>
                  <Badge variant="outline">{TYPES.find((t) => t.v === r.record_type)?.l || r.record_type}</Badge>
                </div>
                <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("pt-BR")}</span>
              </div>
              {r.chief_complaint && <p className="text-sm"><span className="text-muted-foreground">Queixa: </span>{r.chief_complaint}</p>}
              {r.treatment_plan && <p className="text-sm mt-1"><span className="text-muted-foreground">Plano: </span>{r.treatment_plan}</p>}
              {r.professional_name && <p className="text-xs text-muted-foreground mt-2">Profissional: {r.professional_name}</p>}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
