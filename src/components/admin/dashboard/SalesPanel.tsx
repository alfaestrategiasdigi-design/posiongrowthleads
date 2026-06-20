import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2, DollarSign, TrendingUp, Users2, AlertTriangle, CheckCircle2, Clock } from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area,
} from "recharts";
import SaasContractDialog, { SaasContract } from "./SaasContractDialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Sale = {
  id: string;
  tenant_id: string;
  amount: number;
  amount_paid: number;
  amount_pending: number;
  payment_status: string;
  sale_date: string;
  seller_name: string | null;
  procedure_category: string | null;
  international: boolean;
};

type Tenant = { id: string; name: string };

type Props = {
  tenants: Tenant[];
  sales: Sale[];
  contracts: SaasContract[];
  isAdmin: boolean;
  onContractsChanged: () => void;
};

const fmt = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const COLORS = ["hsl(245 78% 62%)", "hsl(265 85% 68%)", "hsl(199 89% 60%)", "hsl(142 71% 55%)", "hsl(280 65% 65%)", "hsl(215 25% 55%)"];

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:   { label: "Ativo",       cls: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" },
  trial:    { label: "Trial",       cls: "bg-sky-500/15 text-sky-300 border-sky-500/40" },
  past_due: { label: "Inadimplente",cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  canceled: { label: "Cancelado",   cls: "bg-rose-500/15 text-rose-300 border-rose-500/40" },
};

export default function SalesPanel({ tenants, sales, contracts, isAdmin, onContractsChanged }: Props) {
  const tenantName = (id: string) => tenants.find((t) => t.id === id)?.name ?? "—";

  // ---------- Operação dos clientes ----------
  const op = useMemo(() => {
    const total = sales.reduce((a, s) => a + Number(s.amount || 0), 0);
    const paid = sales.reduce((a, s) => a + Number(s.amount_paid || 0), 0);
    const pending = sales.reduce((a, s) => a + Number(s.amount_pending || 0), 0);
    const cnt = sales.length;
    const ticket = cnt > 0 ? total / cnt : 0;
    const intl = sales.filter((s) => s.international).length;
    return { total, paid, pending, cnt, ticket, intl };
  }, [sales]);

  const byTenantSales = useMemo(() => {
    const map = new Map<string, { id: string; name: string; revenue: number; count: number; paid: number; pending: number }>();
    for (const t of tenants) map.set(t.id, { id: t.id, name: t.name, revenue: 0, count: 0, paid: 0, pending: 0 });
    for (const s of sales) {
      const c = map.get(s.tenant_id); if (!c) continue;
      c.revenue += Number(s.amount || 0);
      c.paid += Number(s.amount_paid || 0);
      c.pending += Number(s.amount_pending || 0);
      c.count += 1;
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }, [tenants, sales]);

  const bySeller = useMemo(() => {
    const map = new Map<string, { name: string; revenue: number; count: number }>();
    for (const s of sales) {
      const k = s.seller_name || "Sem vendedor";
      const c = map.get(k) || { name: k, revenue: 0, count: 0 };
      c.revenue += Number(s.amount || 0); c.count += 1;
      map.set(k, c);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  }, [sales]);

  const byCategory = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sales) {
      const k = s.procedure_category || "Sem categoria";
      map[k] = (map[k] || 0) + Number(s.amount || 0);
    }
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [sales]);

  const dailyRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    for (const s of sales) {
      const d = s.sale_date;
      map[d] = (map[d] || 0) + Number(s.amount || 0);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date: date.slice(5), value }));
  }, [sales]);

  // ---------- SaaS & contratos ----------
  const saas = useMemo(() => {
    const active = contracts.filter((c) => c.status === "active");
    const trial = contracts.filter((c) => c.status === "trial");
    const pastDue = contracts.filter((c) => c.status === "past_due");
    const canceled = contracts.filter((c) => c.status === "canceled");
    const mrr = active.reduce((a, c) => a + Number(c.mrr || 0), 0);
    const arpa = active.length > 0 ? mrr / active.length : 0;
    return { active, trial, pastDue, canceled, mrr, arr: mrr * 12, arpa };
  }, [contracts]);

  const mrrByPlan = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of contracts) {
      if (c.status !== "active") continue;
      map[c.plan] = (map[c.plan] || 0) + Number(c.mrr || 0);
    }
    return Object.entries(map).map(([plan, mrr]) => ({ plan, mrr })).sort((a, b) => b.mrr - a.mrr);
  }, [contracts]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partial<SaasContract> | null>(null);

  const remove = async (id: string) => {
    if (!confirm("Excluir este contrato?")) return;
    const { error } = await supabase.from("saas_contracts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Contrato excluído");
    onContractsChanged();
  };

  return (
    <div className="card-elevated p-6">
      <Tabs defaultValue="operacao">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Vendas</p>
            <h3 className="font-display text-lg text-foreground normal-case tracking-normal">Painel de vendas do admin master</h3>
          </div>
          <TabsList>
            <TabsTrigger value="operacao">Operação dos clientes</TabsTrigger>
            <TabsTrigger value="saas">SaaS & contratos</TabsTrigger>
          </TabsList>
        </div>

        {/* ============ OPERAÇÃO ============ */}
        <TabsContent value="operacao" className="space-y-5 mt-0">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <MiniKpi icon={DollarSign} label="Receita" value={fmt(op.total)} accent="emerald" />
            <MiniKpi icon={CheckCircle2} label="Recebido" value={fmt(op.paid)} accent="emerald" />
            <MiniKpi icon={Clock} label="A receber" value={fmt(op.pending)} accent="violet" />
            <MiniKpi icon={Users2} label="Vendas" value={String(op.cnt)} accent="sky" />
            <MiniKpi icon={TrendingUp} label="Ticket médio" value={fmt(op.ticket)} accent="indigo" />
          </div>

          {/* Ranking de clientes */}
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Ranking de clientes</p>
            <div className="space-y-1.5">
              {byTenantSales.map((t) => {
                const pct = op.total > 0 ? (t.revenue / op.total) * 100 : 0;
                return (
                  <div key={t.id} className="rounded-lg border border-border bg-card/40 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-sm text-foreground truncate">{t.name}</span>
                      <div className="flex items-center gap-3 text-xs tabular-nums">
                        <span className="text-muted-foreground">{t.count} vendas</span>
                        <span className="text-emerald-400 font-semibold">{fmt(t.revenue)}</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-card/60 rounded-full overflow-hidden flex">
                      <div className="h-full bg-emerald-500/80" style={{ width: `${t.revenue > 0 ? (t.paid / t.revenue) * 100 : 0}%` }} />
                      <div className="h-full bg-violet-500/70" style={{ width: `${t.revenue > 0 ? (t.pending / t.revenue) * 100 : 0}%` }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{pct.toFixed(1)}% da receita · {fmt(t.paid)} pago · {fmt(t.pending)} pendente</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Top vendedores */}
            <div className="rounded-xl border border-border bg-card/40 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Top vendedores</p>
              {bySeller.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem vendas no período</p>
              ) : (
                <div className="space-y-2">
                  {bySeller.map((s, i) => (
                    <div key={s.name} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-5 h-5 rounded-full bg-accent/15 text-accent text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                        <span className="text-sm truncate">{s.name}</span>
                      </div>
                      <div className="text-xs tabular-nums flex gap-3">
                        <span className="text-muted-foreground">{s.count}</span>
                        <span className="text-emerald-400 font-semibold">{fmt(s.revenue)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Mix por categoria */}
            <div className="rounded-xl border border-border bg-card/40 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Mix por categoria</p>
              {byCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem dados</p>
              ) : (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} formatter={(v: any) => fmt(Number(v))} />
                      <Pie data={byCategory} dataKey="value" nameKey="name" innerRadius={40} outerRadius={80} paddingAngle={2} stroke="hsl(226 53% 9%)">
                        {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Legend wrapperStyle={{ fontSize: 10, color: "hsl(215 20% 65%)" }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Tendência diária */}
          {dailyRevenue.length > 0 && (
            <div className="rounded-xl border border-border bg-card/40 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Receita por dia</p>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dailyRevenue}>
                    <defs>
                      <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(142 71% 55%)" stopOpacity={0.5} />
                        <stop offset="100%" stopColor="hsl(142 71% 55%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="hsl(224 30% 18%)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} />
                    <YAxis stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} formatter={(v: any) => fmt(Number(v))} />
                    <Area type="monotone" dataKey="value" stroke="hsl(142 71% 55%)" strokeWidth={2.5} fill="url(#revFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ============ SAAS ============ */}
        <TabsContent value="saas" className="space-y-5 mt-0">
          {!isAdmin ? (
            <p className="text-sm text-muted-foreground">Apenas administradores podem ver os contratos SaaS.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <MiniKpi icon={DollarSign} label="MRR" value={fmt(saas.mrr)} accent="emerald" />
                <MiniKpi icon={TrendingUp} label="ARR" value={fmt(saas.arr)} accent="emerald" />
                <MiniKpi icon={Users2} label="Ativos" value={String(saas.active.length)} accent="sky" />
                <MiniKpi icon={Clock} label="Trial" value={String(saas.trial.length)} accent="sky" />
                <MiniKpi icon={AlertTriangle} label="Inadimplentes" value={String(saas.pastDue.length)} accent="rose" />
                <MiniKpi icon={DollarSign} label="ARPA" value={fmt(saas.arpa)} accent="indigo" />
              </div>

              <div className="flex justify-end">
                <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true); }}>
                  <Plus className="w-4 h-4 mr-1" /> Novo contrato
                </Button>
              </div>

              {/* Tabela */}
              <div className="rounded-xl border border-border bg-card/40 overflow-hidden">
                {contracts.length === 0 ? (
                  <div className="p-8 text-center text-sm text-muted-foreground">
                    Nenhum contrato cadastrado. Clique em "Novo contrato" para começar.
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-card/60 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2">Cliente</th>
                        <th className="text-left px-3 py-2">Plano</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-right px-3 py-2">MRR</th>
                        <th className="text-left px-3 py-2">Ciclo</th>
                        <th className="text-left px-3 py-2">Renova</th>
                        <th className="text-right px-3 py-2">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contracts.map((c) => {
                        const b = STATUS_BADGE[c.status] ?? STATUS_BADGE.active;
                        return (
                          <tr key={c.id} className="border-t border-border/40 hover:bg-card/30">
                            <td className="px-3 py-2">{tenantName(c.tenant_id)}</td>
                            <td className="px-3 py-2 capitalize">{c.plan}</td>
                            <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full border ${b.cls}`}>{b.label}</span></td>
                            <td className="px-3 py-2 text-right tabular-nums text-emerald-400 font-semibold">{fmt(Number(c.mrr))}</td>
                            <td className="px-3 py-2 text-xs">{c.billing_cycle === "yearly" ? "Anual" : "Mensal"}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">{c.renews_at ?? "—"}</td>
                            <td className="px-3 py-2 text-right">
                              <button onClick={() => { setEditing(c); setDialogOpen(true); }} className="text-muted-foreground hover:text-accent p-1"><Pencil className="w-3.5 h-3.5" /></button>
                              <button onClick={() => c.id && remove(c.id)} className="text-muted-foreground hover:text-rose-400 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>

              {/* MRR por plano */}
              {mrrByPlan.length > 0 && (
                <div className="rounded-xl border border-border bg-card/40 p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3">MRR por plano</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={mrrByPlan} layout="vertical" margin={{ left: 20 }}>
                        <CartesianGrid stroke="hsl(224 30% 18%)" strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" stroke="hsl(215 20% 65%)" fontSize={11} />
                        <YAxis dataKey="plan" type="category" stroke="hsl(215 20% 65%)" fontSize={11} width={80} />
                        <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} formatter={(v: any) => fmt(Number(v))} />
                        <Bar dataKey="mrr" fill="hsl(142 71% 55%)" radius={[0, 6, 6, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              <SaasContractDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                tenants={tenants}
                initial={editing}
                onSaved={onContractsChanged}
              />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MiniKpi({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent: "emerald" | "sky" | "indigo" | "violet" | "rose" }) {
  const palette: Record<string, string> = {
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    sky: "text-sky-400 bg-sky-500/10 border-sky-500/20",
    indigo: "text-primary bg-primary/10 border-primary/20",
    violet: "text-violet-300 bg-violet-500/10 border-violet-500/20",
    rose: "text-rose-400 bg-rose-500/10 border-rose-500/20",
  };
  return (
    <div className="rounded-xl border border-border bg-card/40 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-6 h-6 rounded-md border flex items-center justify-center ${palette[accent]}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <div className="text-lg font-bold text-foreground tabular-nums truncate">{value}</div>
    </div>
  );
}
