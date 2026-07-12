import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Plus, Loader2, FileText, DollarSign, TrendingUp, Trash2 } from "lucide-react";
import { format } from "date-fns";

interface AgencyContract {
  id: string;
  tenant_id: string | null;
  agency_lead_id: string | null;
  cliente_nome: string;
  valor_total: number;
  valor_comissao: number;
  duracao_meses: number | null;
  data_assinatura: string;
  status: "ativo" | "pausado" | "encerrado" | "cancelado";
  observacoes: string | null;
  created_at: string;
}
interface AgencyLeadOption {
  id: string;
  nome_clinica: string | null;
  responsavel: string | null;
  stage: string;
  valor_proposta: number | null;
}
interface SaasContract {
  id: string;
  tenant_id: string | null;
  plan: string;
  mrr: number;
  status: string;
  started_at: string;
}

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);

export default function AgencyContractsPage() {
  const [agency, setAgency] = useState<AgencyContract[]>([]);
  const [saas, setSaas] = useState<SaasContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState<AgencyContract | "new" | null>(null);

  const load = async () => {
    setLoading(true);
    const [a, s] = await Promise.all([
      supabase.from("agency_contracts").select("*").order("data_assinatura", { ascending: false }),
      supabase.from("saas_contracts").select("*").order("started_at", { ascending: false }),
    ]);
    setAgency((a.data || []) as AgencyContract[]);
    setSaas((s.data || []) as SaasContract[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);


  const kpis = useMemo(() => {
    const ativos = agency.filter((c) => c.status === "ativo");
    const agencyTotal = ativos.reduce((s, c) => s + Number(c.valor_total || 0), 0);
    const mrr = saas.filter((s) => s.status === "active").reduce((s, c) => s + Number(c.mrr || 0), 0);
    return { agencyTotal, mrr, count: ativos.length, saasCount: saas.filter((s) => s.status === "active").length };
  }, [agency, saas]);

  const remove = async (id: string) => {
    if (!confirm("Excluir contrato?")) return;
    const { error } = await supabase.from("agency_contracts").delete().eq("id", id);
    if (error) toast.error(error.message); else { toast.success("Removido"); load(); }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary/70 mb-1">POSION Agência</div>
          <h1 className="text-3xl font-bold">Contratos</h1>
          <p className="text-sm text-muted-foreground mt-1">Contratos de serviço + assinaturas SaaS.</p>
        </div>
        <Button onClick={() => setDialog("new")} className="gap-2"><Plus className="w-4 h-4" />Novo Contrato</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI icon={FileText} label="Contratos ativos" value={String(kpis.count)} />
        <KPI icon={DollarSign} label="Receita agência (ativa)" value={fmt(kpis.agencyTotal)} />
        <KPI icon={TrendingUp} label="MRR SaaS" value={fmt(kpis.mrr)} />
        <KPI icon={FileText} label="Assinaturas SaaS" value={String(kpis.saasCount)} />
      </div>

      <Tabs defaultValue="agency">
        <TabsList>
          <TabsTrigger value="agency">Agência ({agency.length})</TabsTrigger>
          <TabsTrigger value="saas">SaaS ({saas.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="agency" className="mt-4">
          {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : (
            <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="p-3">Cliente</th>
                    <th className="p-3">Valor</th>
                    <th className="p-3">Comissão</th>
                    <th className="p-3">Duração</th>
                    <th className="p-3">Assinatura</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {agency.length === 0 && (
                    <tr><td colSpan={7} className="p-6 text-center text-muted-foreground text-sm">Nenhum contrato ainda.</td></tr>
                  )}
                  {agency.map((c) => (
                    <tr key={c.id} className="border-t border-border/40 hover:bg-muted/20 cursor-pointer" onClick={() => setDialog(c)}>
                      <td className="p-3 font-medium">{c.cliente_nome}</td>
                      <td className="p-3">{fmt(c.valor_total)}</td>
                      <td className="p-3">{fmt(c.valor_comissao)}</td>
                      <td className="p-3">{c.duracao_meses || 12}m</td>
                      <td className="p-3">{format(new Date(c.data_assinatura), "dd/MM/yyyy")}</td>
                      <td className="p-3"><Badge variant={c.status === "ativo" ? "default" : "outline"}>{c.status}</Badge></td>
                      <td className="p-3">
                        <button onClick={(e) => { e.stopPropagation(); remove(c.id); }} className="p-1 hover:bg-destructive/20 rounded">
                          <Trash2 className="w-3.5 h-3.5 text-destructive" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </TabsContent>
        <TabsContent value="saas" className="mt-4">
          <div className="rounded-xl border border-border/60 bg-card/40 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/40">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="p-3">Plano</th>
                  <th className="p-3">MRR</th>
                  <th className="p-3">Início</th>
                  <th className="p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {saas.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground text-sm">Nenhuma assinatura.</td></tr>}
                {saas.map((c) => (
                  <tr key={c.id} className="border-t border-border/40">
                    <td className="p-3 font-medium">{c.plan}</td>
                    <td className="p-3">{fmt(c.mrr)}</td>
                    <td className="p-3">{format(new Date(c.started_at), "dd/MM/yyyy")}</td>
                    <td className="p-3"><Badge variant={c.status === "active" ? "default" : "outline"}>{c.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>

      <ContractDialog contract={dialog} onOpenChange={(o) => !o && setDialog(null)} onSaved={() => { setDialog(null); load(); }} />
    </div>
  );
}

function KPI({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}

function ContractDialog({ contract, onOpenChange, onSaved }: { contract: AgencyContract | "new" | null; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  const open = !!contract;
  const isNew = contract === "new";
  const c = isNew ? null : (contract as AgencyContract | null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    cliente_nome: "", valor_total: 0, valor_comissao: 0, duracao_meses: 12,
    data_assinatura: new Date().toISOString().slice(0, 10),
    status: "ativo" as AgencyContract["status"], observacoes: "",
  });

  useEffect(() => {
    if (c) setForm({
      cliente_nome: c.cliente_nome,
      valor_total: Number(c.valor_total),
      valor_comissao: Number(c.valor_comissao),
      duracao_meses: c.duracao_meses || 12,
      data_assinatura: c.data_assinatura,
      status: c.status,
      observacoes: c.observacoes || "",
    });
    else setForm({ cliente_nome: "", valor_total: 0, valor_comissao: 0, duracao_meses: 12, data_assinatura: new Date().toISOString().slice(0, 10), status: "ativo", observacoes: "" });
  }, [contract]);

  const save = async () => {
    if (!form.cliente_nome.trim()) { toast.error("Cliente obrigatório"); return; }
    setSaving(true);
    // agency_contracts pertencem à POSION (admin master) — NUNCA vinculados a tenant.
    const payload = { ...form, tenant_id: null as string | null };
    const { error } = c
      ? await supabase.from("agency_contracts").update(payload).eq("id", c.id)
      : await supabase.from("agency_contracts").insert(payload);
    setSaving(false);
    if (error) toast.error(error.message);
    else { toast.success("Salvo"); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{c ? "Editar Contrato" : "Novo Contrato"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Cliente *</Label><Input value={form.cliente_nome} onChange={(e) => setForm({ ...form, cliente_nome: e.target.value })} /></div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label>Valor total (R$)</Label><Input type="number" value={form.valor_total} onChange={(e) => setForm({ ...form, valor_total: Number(e.target.value) })} /></div>
            <div><Label>Comissão (R$)</Label><Input type="number" value={form.valor_comissao} onChange={(e) => setForm({ ...form, valor_comissao: Number(e.target.value) })} /></div>
            <div><Label>Duração (meses)</Label><Input type="number" value={form.duracao_meses} onChange={(e) => setForm({ ...form, duracao_meses: Number(e.target.value) })} /></div>
            <div><Label>Data assinatura</Label><Input type="date" value={form.data_assinatura} onChange={(e) => setForm({ ...form, data_assinatura: e.target.value })} /></div>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="pausado">Pausado</SelectItem>
                <SelectItem value="encerrado">Encerrado</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Observações</Label><Textarea rows={3} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
