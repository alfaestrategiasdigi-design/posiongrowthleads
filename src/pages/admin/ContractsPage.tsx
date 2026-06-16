import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, FileText, DollarSign, TrendingUp, Building2 } from "lucide-react";
import { toast } from "sonner";

type Tenant = { id: string; name: string };
type Contract = {
  id: string;
  tenant_id: string;
  plan_name: string | null;
  monthly_fee: number;
  setup_fee: number;
  start_date: string;
  end_date: string | null;
  status: string;
  notes: string | null;
};

const emptyForm = {
  tenant_id: "",
  plan_name: "Pro",
  monthly_fee: 0,
  setup_fee: 0,
  start_date: new Date().toISOString().slice(0, 10),
  end_date: "",
  status: "active",
  notes: "",
};

const statusColor: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  churned: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  trial: "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

export default function ContractsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    const [t, c] = await Promise.all([
      supabase.from("tenants").select("id,name").order("name"),
      supabase.from("posion_contracts").select("*").order("created_at", { ascending: false }),
    ]);
    if (t.data) setTenants(t.data as Tenant[]);
    if (c.data) setContracts(c.data as Contract[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, tenant_id: tenants[0]?.id ?? "" });
    setOpen(true);
  };

  const openEdit = (c: Contract) => {
    setEditing(c);
    setForm({
      tenant_id: c.tenant_id,
      plan_name: c.plan_name ?? "",
      monthly_fee: Number(c.monthly_fee),
      setup_fee: Number(c.setup_fee),
      start_date: c.start_date,
      end_date: c.end_date ?? "",
      status: c.status,
      notes: c.notes ?? "",
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.tenant_id) return toast.error("Selecione uma clínica");
    const payload = {
      tenant_id: form.tenant_id,
      plan_name: form.plan_name || null,
      monthly_fee: Number(form.monthly_fee) || 0,
      setup_fee: Number(form.setup_fee) || 0,
      start_date: form.start_date,
      end_date: form.end_date || null,
      status: form.status,
      notes: form.notes || null,
    };
    const res = editing
      ? await supabase.from("posion_contracts").update(payload).eq("id", editing.id)
      : await supabase.from("posion_contracts").insert(payload);
    if (res.error) return toast.error(res.error.message);
    toast.success(editing ? "Contrato atualizado" : "Contrato criado");
    setOpen(false);
    load();
  };

  const remove = async (c: Contract) => {
    if (!confirm("Excluir este contrato?")) return;
    const { error } = await supabase.from("posion_contracts").delete().eq("id", c.id);
    if (error) return toast.error(error.message);
    toast.success("Contrato excluído");
    load();
  };

  const tenantName = (id: string) => tenants.find(t => t.id === id)?.name ?? "—";
  const activeContracts = contracts.filter(c => c.status === "active");
  const mrr = activeContracts.reduce((s, c) => s + Number(c.monthly_fee), 0);
  const arr = mrr * 12;
  const setupTotal = contracts.reduce((s, c) => s + Number(c.setup_fee), 0);
  const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <FileText className="w-6 h-6 text-accent" /> Contratos Posion
          </h1>
          <p className="text-sm text-muted-foreground">Gerencie contratos das clínicas clientes (MRR / ARR).</p>
        </div>
        <Button onClick={openCreate} className="bg-accent text-accent-foreground hover:bg-accent/90">
          <Plus className="w-4 h-4 mr-2" /> Novo contrato
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "MRR", value: fmt(mrr), icon: DollarSign },
          { label: "ARR", value: fmt(arr), icon: TrendingUp },
          { label: "Contratos ativos", value: activeContracts.length, icon: Building2 },
          { label: "Setup acumulado", value: fmt(setupTotal), icon: FileText },
        ].map((k, i) => (
          <Card key={i} className="p-5 bg-card/60 border-border/50 hover:border-accent/40 transition-colors">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-muted-foreground">{k.label}</span>
              <k.icon className="w-4 h-4 text-accent" />
            </div>
            <div className="mt-2 text-2xl font-bold text-foreground">{k.value}</div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden border-border/50">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-3">Clínica</th>
                <th className="text-left p-3">Plano</th>
                <th className="text-right p-3">Mensal</th>
                <th className="text-right p-3">Setup</th>
                <th className="text-left p-3">Início</th>
                <th className="text-left p-3">Status</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Carregando...</td></tr>
              ) : contracts.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Nenhum contrato. Crie o primeiro acima.</td></tr>
              ) : contracts.map(c => (
                <tr key={c.id} className="border-t border-border/40 hover:bg-muted/20">
                  <td className="p-3 font-medium text-foreground">{tenantName(c.tenant_id)}</td>
                  <td className="p-3 text-muted-foreground">{c.plan_name ?? "—"}</td>
                  <td className="p-3 text-right">{fmt(Number(c.monthly_fee))}</td>
                  <td className="p-3 text-right">{fmt(Number(c.setup_fee))}</td>
                  <td className="p-3 text-muted-foreground">{new Date(c.start_date).toLocaleDateString("pt-BR")}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={statusColor[c.status] ?? ""}>{c.status}</Badge>
                  </td>
                  <td className="p-3 text-right whitespace-nowrap">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(c)}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={() => remove(c)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar contrato" : "Novo contrato"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Clínica</Label>
              <Select value={form.tenant_id} onValueChange={v => setForm({ ...form, tenant_id: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Plano</Label>
                <Input value={form.plan_name} onChange={e => setForm({ ...form, plan_name: e.target.value })} placeholder="Pro, Starter..." />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={v => setForm({ ...form, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="trial">Trial</SelectItem>
                    <SelectItem value="paused">Pausado</SelectItem>
                    <SelectItem value="churned">Cancelado</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Mensalidade (R$)</Label>
                <Input type="number" value={form.monthly_fee} onChange={e => setForm({ ...form, monthly_fee: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Setup (R$)</Label>
                <Input type="number" value={form.setup_fee} onChange={e => setForm({ ...form, setup_fee: Number(e.target.value) })} />
              </div>
              <div>
                <Label>Início</Label>
                <Input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
              </div>
              <div>
                <Label>Fim (opcional)</Label>
                <Input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Notas</Label>
              <Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save} className="bg-accent text-accent-foreground hover:bg-accent/90">
              {editing ? "Salvar" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
