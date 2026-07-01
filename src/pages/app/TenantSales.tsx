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
import { Loader2, Search, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BRL, type SaleRow } from "@/lib/clinic-kpis";
import { useTenantApptConfig } from "@/hooks/useTenantApptConfig";

const PRODUCTS = [
  "GOLD + Remodelação","GOLD + Harmonize","GOLD + LINNEA SAFE","Avaliação Gold","Consulta Nutro",
  "Vitaminas + Hormônio","Bioestimulador","Implante Hormonal","Toxina Botulínica","Contour Emagrecimento",
  "Ampola Tirezepatida","Peptídeos",
];
const CHANNELS = ["Instagram Orgânico","Tráfego Pago","Paciente","Indicação","TikTok","Clínica São Caetano"];
const PAYMENTS = ["PIX","Crédito","PIX + Crédito","PayPal","Boleto","Dinheiro","Outros"];

export default function TenantSales() {
  const { tenant } = useTenant();
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);

  async function load() {
    if (!tenant) return;
    setLoading(true);
    const { data } = await supabase.from("sales").select("*").eq("tenant_id", tenant.id).order("sale_date", { ascending: false });
    setSales((data || []) as SaleRow[]); setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id]);

  async function remove(id: string) {
    if (!confirm("Excluir esta venda?")) return;
    const { error } = await supabase.from("sales").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Venda excluída"); load(); }
  }

  const filtered = useMemo(() => {
    const s = q.toLowerCase();
    return sales.filter((r) => !s ||
      r.patient_name.toLowerCase().includes(s) ||
      (r.product || "").toLowerCase().includes(s) ||
      (r.seller_name || "").toLowerCase().includes(s) ||
      (r.channel || "").toLowerCase().includes(s)
    );
  }, [sales, q]);

  const total = filtered.reduce((sum, r) => sum + Number(r.amount), 0);
  const avg = filtered.length ? total / filtered.length : 0;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Fechamentos</h1>
          <p className="text-muted-foreground">{filtered.length} vendas · {BRL(total)} · ticket médio {BRL(avg)}</p>
        </div>
        <div className="flex gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input placeholder="Buscar paciente, produto..." value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Registrar Fechamento</Button></DialogTrigger>
            <NewSaleDialog tenantId={tenant?.id || ""} onCreated={() => { setOpen(false); load(); }} />
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Lista de Fechamentos</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Pagto</TableHead>
                  <TableHead>Compareceu</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap text-sm">{new Date(s.sale_date + "T00:00:00").toLocaleDateString("pt-BR")}</TableCell>
                    <TableCell className="font-medium">{s.patient_name}</TableCell>
                    <TableCell className="text-sm">{s.product}</TableCell>
                    <TableCell className="text-sm">{s.seller_name}</TableCell>
                    <TableCell className="text-sm">{s.channel}</TableCell>
                    <TableCell className="text-sm">{s.payment_method}</TableCell>
                    <TableCell>
                      {s.attended === "SIM" && <Badge className="bg-emerald-500/15 text-emerald-400">SIM</Badge>}
                      {s.attended === "NÃO" && <Badge className="bg-rose-500/15 text-rose-400">NÃO</Badge>}
                      {s.attended === "FUTURA" && <Badge className="bg-sky-500/15 text-sky-400">FUTURA</Badge>}
                      {(!s.attended || s.attended === "-") && <span className="text-muted-foreground text-sm">—</span>}
                    </TableCell>
                    <TableCell className="text-right font-semibold">{BRL(Number(s.amount))}</TableCell>
                    <TableCell className="text-right">
                      <Button size="icon" variant="ghost" onClick={() => remove(s.id)}><Trash2 className="w-4 h-4 text-rose-400" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length > 0 && (
                  <TableRow className="bg-muted/30 font-semibold">
                    <TableCell colSpan={7} className="text-right">Total · {filtered.length} vendas · Ticket médio {BRL(avg)}</TableCell>
                    <TableCell className="text-right">{BRL(total)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewSaleDialog({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const { config } = useTenantApptConfig(tenantId);
  const [f, setF] = useState({
    patient_name: "", seller_name: "", sale_date: new Date().toISOString().slice(0, 10),
    product: "", amount: "", payment_method: "PIX", installments: 1, channel: "Instagram Orgânico",
    attended: "SIM", first_contact_date: "", international: false, arrival_date: "", notes: "",
  });
  const [customProduct, setCustomProduct] = useState(false);
  const [customSeller, setCustomSeller] = useState(false);
  const [saving, setSaving] = useState(false);

  const sellers = (config?.team_members || []).map((m) => m.name).filter(Boolean);

  useEffect(() => {
    if (sellers.length && !f.seller_name) setF((p) => ({ ...p, seller_name: sellers[0] }));
    // eslint-disable-next-line
  }, [config]);

  async function submit() {
    if (!tenantId) return;
    if (!f.patient_name || !f.product || !f.amount) { toast.error("Cliente, produto e valor são obrigatórios"); return; }
    setSaving(true);
    const isCredit = f.payment_method === "Crédito" || f.payment_method === "PIX + Crédito";
    const notes = [
      f.notes,
      isCredit && f.installments > 1 ? `Parcelas: ${f.installments}x` : null,
      f.international && f.arrival_date ? `Chegada: ${f.arrival_date}` : null,
    ].filter(Boolean).join(" · ");
    const { error } = await supabase.from("sales").insert({
      tenant_id: tenantId, patient_name: f.patient_name, seller_name: f.seller_name,
      sale_date: f.sale_date, product: f.product, amount: Number(f.amount),
      payment_method: f.payment_method, channel: f.channel, attended: f.attended,
      first_contact_date: f.first_contact_date || null, international: f.international,
      notes: notes || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Fechamento registrado"); onCreated();
  }

  const showInstallments = f.payment_method === "Crédito" || f.payment_method === "PIX + Crédito";

  return (
    <DialogContent className="max-w-xl">
      <DialogHeader><DialogTitle>Registrar Fechamento</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Cliente *</Label><Input value={f.patient_name} onChange={(e) => setF({ ...f, patient_name: e.target.value })} /></div>
        <div>
          <Label>Vendedor</Label>
          {customSeller || sellers.length === 0 ? (
            <div className="flex gap-1">
              <Input value={f.seller_name} onChange={(e) => setF({ ...f, seller_name: e.target.value })} placeholder="Nome do vendedor" />
              {sellers.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setCustomSeller(false)}>↺</Button>}
            </div>
          ) : (
            <div className="flex gap-1">
              <Select value={f.seller_name} onValueChange={(v) => setF({ ...f, seller_name: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{sellers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomSeller(true)} title="Digitar">✎</Button>
            </div>
          )}
        </div>
        <div><Label>Data</Label><Input type="date" value={f.sale_date} onChange={(e) => setF({ ...f, sale_date: e.target.value })} /></div>
        <div className="col-span-2">
          <Label>Procedimento *</Label>
          {customProduct ? (
            <div className="flex gap-1">
              <Input value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} placeholder="Digite o procedimento" />
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomProduct(false)}>↺</Button>
            </div>
          ) : (
            <div className="flex gap-1">
              <Select value={f.product} onValueChange={(v) => setF({ ...f, product: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{PRODUCTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
              <Button type="button" variant="outline" size="sm" onClick={() => setCustomProduct(true)} title="Texto livre">✎</Button>
            </div>
          )}
        </div>
        <div><Label>Valor *</Label><Input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div>
          <Label>Pagamento</Label>
          <Select value={f.payment_method} onValueChange={(v) => setF({ ...f, payment_method: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PAYMENTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {showInstallments && (
          <div>
            <Label>Parcelas</Label>
            <Select value={String(f.installments)} onValueChange={(v) => setF({ ...f, installments: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <SelectItem key={n} value={String(n)}>{n}x</SelectItem>)}</SelectContent>
            </Select>
          </div>
        )}
        <div>
          <Label>Canal</Label>
          <Select value={f.channel} onValueChange={(v) => setF({ ...f, channel: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Compareceu?</Label>
          <Select value={f.attended} onValueChange={(v) => setF({ ...f, attended: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="SIM">Sim</SelectItem>
              <SelectItem value="NÃO">Não</SelectItem>
              <SelectItem value="FUTURA">Futura</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div><Label>1º Contato</Label><Input type="date" value={f.first_contact_date} onChange={(e) => setF({ ...f, first_contact_date: e.target.value })} /></div>
        <div className="col-span-2 flex items-center gap-2">
          <input id="intl" type="checkbox" checked={f.international} onChange={(e) => setF({ ...f, international: e.target.checked })} />
          <Label htmlFor="intl" className="cursor-pointer">Paciente internacional</Label>
        </div>
        {f.international && (
          <div className="col-span-2"><Label>Data prevista de chegada</Label><Input type="date" value={f.arrival_date} onChange={(e) => setF({ ...f, arrival_date: e.target.value })} /></div>
        )}
        <div className="col-span-2"><Label>Observação</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={2} /></div>
      </div>
      <DialogFooter><Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}</Button></DialogFooter>
    </DialogContent>
  );
}
