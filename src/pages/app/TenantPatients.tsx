import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, UserCircle2, Plus } from "lucide-react";
import { toast } from "sonner";
import { BRL, type SaleRow } from "@/lib/clinic-kpis";
import ClientPanel from "@/components/clients/ClientPanel";

interface Patient {
  id: string; name: string; whatsapp: string | null; email: string | null;
  origem: string | null; primeiro_contato: string | null; observacoes: string | null;
}

const ORIGEM = ["Instagram","Tráfego Pago","Indicação","TikTok","Google","Outro"];

export default function TenantPatients() {
  const { tenant } = useTenant();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [panelId, setPanelId] = useState<string | null>(null);

  async function load() {
    if (!tenant) return;
    setLoading(true);
    const [{ data: pts }, { data: sls }] = await Promise.all([
      supabase.from("patients").select("*").eq("tenant_id", tenant.id).order("name"),
      supabase.from("sales").select("*").eq("tenant_id", tenant.id),
    ]);
    setPatients((pts || []) as Patient[]);
    setSales((sls || []) as SaleRow[]);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id]);

  const stats = useMemo(() => {
    const map = new Map<string, { total: number; count: number; last: string | null }>();
    for (const s of sales) {
      const k = s.patient_name.toLowerCase();
      const a = map.get(k) || { total: 0, count: 0, last: null };
      a.total += Number(s.amount); a.count += 1;
      if (!a.last || s.sale_date > a.last) a.last = s.sale_date;
      map.set(k, a);
    }
    return map;
  }, [sales]);

  // Merge: patients table + names appearing only in sales
  const rows = useMemo(() => {
    const byName = new Map<string, Patient>();
    patients.forEach((p) => byName.set(p.name.toLowerCase(), p));
    for (const s of sales) {
      const k = s.patient_name.toLowerCase();
      if (!byName.has(k)) byName.set(k, {
        id: "sale:" + k, name: s.patient_name, whatsapp: null, email: null,
        origem: s.channel || null, primeiro_contato: s.first_contact_date, observacoes: null,
      });
    }
    return Array.from(byName.values())
      .filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => (stats.get(b.name.toLowerCase())?.total || 0) - (stats.get(a.name.toLowerCase())?.total || 0));
  }, [patients, sales, q, stats]);

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pacientes</h1>
          <p className="text-muted-foreground">{rows.length} pacientes</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar paciente..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Novo Paciente</Button></DialogTrigger>
            <NewPatientDialog tenantId={tenant?.id || ""} onCreated={() => { setOpen(false); load(); }} />
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Lista de Pacientes</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead>1º Contato</TableHead>
                  <TableHead>Última Venda</TableHead>
                  <TableHead className="text-right">Vendas</TableHead>
                  <TableHead className="text-right">Total Gasto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((p) => {
                  const st = stats.get(p.name.toLowerCase()) || { total: 0, count: 0, last: null };
                  const isRealPatient = !p.id.startsWith("sale:");
                  return (
                    <TableRow
                      key={p.id}
                      className={isRealPatient ? "cursor-pointer hover:bg-muted/40" : ""}
                      onClick={isRealPatient ? () => setPanelId(p.id) : undefined}
                    >
                      <TableCell className="font-medium flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center"><UserCircle2 className="w-4 h-4 text-primary" /></div>
                        <span>{p.name}</span>
                        {st.count > 1 && <Badge variant="outline" className="ml-1">recorrente</Badge>}
                      </TableCell>
                      <TableCell className="text-sm">{p.whatsapp || "—"}</TableCell>
                      <TableCell className="text-sm">{p.origem || "—"}</TableCell>
                      <TableCell className="text-sm">{p.primeiro_contato ? new Date(p.primeiro_contato + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                      <TableCell className="text-sm">{st.last ? new Date(st.last + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</TableCell>
                      <TableCell className="text-right">{st.count}</TableCell>
                      <TableCell className="text-right font-semibold">{BRL(st.total)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <ClientPanel kind="patient" id={panelId} open={!!panelId} onClose={() => setPanelId(null)} />
    </div>
  );
}

function NewPatientDialog({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const [f, setF] = useState({
    name: "", whatsapp: "", email: "", primeiro_contato: new Date().toISOString().slice(0, 10),
    origem: "Instagram", observacoes: "",
  });
  const [saving, setSaving] = useState(false);
  async function submit() {
    if (!tenantId || !f.name) { toast.error("Nome é obrigatório"); return; }
    setSaving(true);
    const { error } = await supabase.from("patients").insert({
      tenant_id: tenantId, name: f.name, whatsapp: f.whatsapp || null, email: f.email || null,
      primeiro_contato: f.primeiro_contato || null, origem: f.origem, observacoes: f.observacoes || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Paciente criado"); onCreated();
  }
  return (
    <DialogContent className="max-w-md">
      <DialogHeader><DialogTitle>Novo Paciente</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Nome completo *</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Telefone</Label><Input value={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.value })} /></div>
          <div><Label>E-mail</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>1º contato</Label><Input type="date" value={f.primeiro_contato} onChange={(e) => setF({ ...f, primeiro_contato: e.target.value })} /></div>
          <div>
            <Label>Como nos conheceu</Label>
            <Select value={f.origem} onValueChange={(v) => setF({ ...f, origem: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ORIGEM.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div><Label>Observação clínica</Label><Textarea value={f.observacoes} onChange={(e) => setF({ ...f, observacoes: e.target.value })} rows={3} /></div>
      </div>
      <DialogFooter><Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}</Button></DialogFooter>
    </DialogContent>
  );
}
