import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Wallet, Users, TrendingUp, AlertTriangle, DollarSign, Target,
  CalendarClock, AlertCircle, Building2, Plus, Receipt, FileText,
  CheckCircle2, XCircle, Loader2, Crown,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  Tooltip, XAxis, YAxis, CartesianGrid, Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import SalesPanel from "@/components/admin/dashboard/SalesPanel";
import type { SaasContract } from "@/components/admin/dashboard/SaasContractDialog";

type Tenant = { id: string; name: string; slug: string };
type Conn = { tenant_id: string | null; instance_name: string | null; status: string | null; updated_at: string | null };

const PLAN_COLORS: Record<string, string> = {
  starter: "hsl(265 85% 68%)",
  pro: "hsl(220 90% 62%)",
  scale: "hsl(142 71% 50%)",
};

const fmt = (n: number) => `R$ ${n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

const KPICard = ({ icon: Icon, label, value, hint, accent = "indigo" }: { icon: any; label: string; value: string; hint?: string; accent?: string }) => {
  const accents: Record<string, string> = {
    indigo: "from-indigo-500/20 to-indigo-500/0 text-indigo-300 border-indigo-500/30",
    violet: "from-violet-500/20 to-violet-500/0 text-violet-300 border-violet-500/30",
    emerald: "from-emerald-500/20 to-emerald-500/0 text-emerald-300 border-emerald-500/30",
    rose: "from-rose-500/20 to-rose-500/0 text-rose-300 border-rose-500/30",
    amber: "from-amber-500/20 to-amber-500/0 text-amber-300 border-amber-500/30",
    sky: "from-sky-500/20 to-sky-500/0 text-sky-300 border-sky-500/30",
  };
  return (
    <div className={`relative overflow-hidden rounded-xl border bg-gradient-to-br ${accents[accent]} p-4 transition-all hover:scale-[1.02] hover:shadow-lg`}>
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider opacity-70">{label}</div>
          <div className="mt-1 text-2xl font-bold text-white">{value}</div>
          {hint && <div className="mt-0.5 text-[11px] opacity-60">{hint}</div>}
        </div>
        <div className="rounded-lg bg-white/5 p-2"><Icon className="h-4 w-4" /></div>
      </div>
    </div>
  );
};

type WonLead = { tenant_id: string | null; valor_proposta: number | null; fechado_em: string | null };

const Dashboard = () => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [contracts, setContracts] = useState<SaasContract[]>([]);
  const [conns, setConns] = useState<Conn[]>([]);
  const [wonLeads, setWonLeads] = useState<WonLead[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [t, c, w, l] = await Promise.all([
      supabase.from("tenants").select("id,name,slug").order("name"),
      supabase.from("saas_contracts").select("*").order("created_at", { ascending: false }),
      supabase.from("zapi_connections").select("tenant_id,instance_name,status,updated_at"),
      supabase.from("leads").select("tenant_id,valor_proposta,fechado_em").eq("status", "ganho").limit(5000),
    ]);
    setTenants((t.data || []) as Tenant[]);
    setContracts((c.data || []) as SaasContract[]);
    setConns((w.data || []) as Conn[]);
    setWonLeads((l.data || []) as WonLead[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);


  // ---- KPIs ----
  const active = useMemo(() => contracts.filter(c => c.status === "active" || c.status === "trial"), [contracts]);
  const mrr = useMemo(() => active.reduce((s, c) => s + Number(c.mrr || 0), 0), [active]);
  const arr = mrr * 12;
  const ticket = active.length ? mrr / active.length : 0;
  const now = new Date();
  const upcoming = useMemo(() => contracts.filter(c => c.renews_at && c.status !== "canceled" && (() => { const d = new Date(c.renews_at!); const diff = daysBetween(now, d); return diff >= 0 && diff <= 7; })()), [contracts]);
  const overdue = useMemo(() => contracts.filter(c => c.status === "past_due" || (c.renews_at && new Date(c.renews_at) < now && c.status !== "canceled" && c.status !== "active")), [contracts]);
  const overdueAmount = overdue.reduce((s, c) => s + Number(c.mrr || 0), 0);
  const canceled30 = useMemo(() => contracts.filter(c => c.canceled_at && daysBetween(new Date(c.canceled_at), now) <= 30).length, [contracts]);
  const churn = active.length ? (canceled30 / (active.length + canceled30)) * 100 : 0;

  // ---- GMV: volume fechado pelas clínicas (valor_proposta dos leads ganho) ----
  const gmvByTenant = useMemo(() => {
    const m = new Map<string, { total: number; count: number; month: number }>();
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1);
    for (const l of wonLeads) {
      if (!l.tenant_id) continue;
      const v = Number(l.valor_proposta || 0);
      const cur = m.get(l.tenant_id) || { total: 0, count: 0, month: 0 };
      cur.total += v; cur.count += 1;
      if (l.fechado_em && new Date(l.fechado_em) >= mStart) cur.month += v;
      m.set(l.tenant_id, cur);
    }
    return m;
  }, [wonLeads]);
  const gmvTotal = useMemo(() => Array.from(gmvByTenant.values()).reduce((s, v) => s + v.total, 0), [gmvByTenant]);
  const gmvMonth = useMemo(() => Array.from(gmvByTenant.values()).reduce((s, v) => s + v.month, 0), [gmvByTenant]);
  const gmvCount = useMemo(() => Array.from(gmvByTenant.values()).reduce((s, v) => s + v.count, 0), [gmvByTenant]);


  // ---- MRR histórico (12 meses, calculado por started_at/canceled_at) ----
  const mrrHistory = useMemo(() => {
    const months: { label: string; mrr: number; starter: number; pro: number; scale: number }[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      let total = 0, starter = 0, pro = 0, scale = 0;
      for (const c of contracts) {
        if (!c.started_at) continue;
        const s = new Date(c.started_at);
        const cancel = c.canceled_at ? new Date(c.canceled_at) : null;
        if (s <= end && (!cancel || cancel >= d)) {
          const v = Number(c.mrr || 0);
          total += v;
          if (c.plan === "starter") starter += v;
          else if (c.plan === "pro") pro += v;
          else if (c.plan === "scale") scale += v;
        }
      }
      months.push({ label: d.toLocaleDateString("pt-BR", { month: "short" }), mrr: total, starter, pro, scale });
    }
    return months;
  }, [contracts]);

  // ---- Distribuição por plano ----
  const planDist = useMemo(() => {
    const map: Record<string, number> = { starter: 0, pro: 0, scale: 0 };
    for (const c of active) map[c.plan] = (map[c.plan] || 0) + 1;
    return Object.entries(map).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [active]);

  // ---- Mapas auxiliares ----
  const contractByTenant = useMemo(() => {
    const m = new Map<string, SaasContract>();
    for (const c of contracts) if (!m.has(c.tenant_id)) m.set(c.tenant_id, c);
    return m;
  }, [contracts]);
  const connByTenant = useMemo(() => {
    const m = new Map<string, Conn>();
    for (const c of conns) if (c.tenant_id) m.set(c.tenant_id, c);
    return m;
  }, [conns]);

  const connectedTenants = tenants.filter(t => (connByTenant.get(t.id)?.status || "").toLowerCase().includes("connect")).length;

  // ---- Alertas ----
  const alerts = useMemo(() => {
    const list: { level: "red" | "yellow" | "green"; text: string }[] = [];
    for (const t of tenants) {
      const conn = connByTenant.get(t.id);
      const contract = contractByTenant.get(t.id);
      if (!conn || !conn.instance_name) list.push({ level: "red", text: `${t.name} — sem instância WhatsApp configurada` });
      else if (!(conn.status || "").toLowerCase().includes("connect")) list.push({ level: "yellow", text: `${t.name} — WhatsApp ${conn.status || "desconectado"}` });
      if (contract?.renews_at) {
        const diff = daysBetween(now, new Date(contract.renews_at));
        if (diff >= 0 && diff <= 5 && contract.status !== "canceled") list.push({ level: "yellow", text: `${t.name} — assinatura vence em ${diff} dia${diff === 1 ? "" : "s"}` });
      }
      if (conn && (conn.status || "").toLowerCase().includes("connect") && contract?.status === "active") {
        list.push({ level: "green", text: `${t.name} — ativo e conectado` });
      }
    }
    return list.sort((a, b) => ({ red: 0, yellow: 1, green: 2 }[a.level] - { red: 0, yellow: 1, green: 2 }[b.level]));
  }, [tenants, connByTenant, contractByTenant]);

  const statusBadge = (status?: string) => {
    const s = (status || "").toLowerCase();
    if (s === "active") return <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">✅ Ativo</Badge>;
    if (s === "trial") return <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30">⚠️ Trial</Badge>;
    if (s === "past_due") return <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30">🔴 Atrasado</Badge>;
    if (s === "canceled") return <Badge className="bg-zinc-500/20 text-zinc-300 border-zinc-500/30">❌ Inativo</Badge>;
    return <Badge variant="outline">Sem contrato</Badge>;
  };

  if (loading) {
    return <div className="flex h-64 items-center justify-center text-zinc-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando painel POSION…</div>;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-indigo-300/80">
            <Crown className="h-3.5 w-3.5" /> ADMIN MASTER · POSION
          </div>
          <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">Painel da operação POSION</h1>
          <p className="text-sm text-zinc-400">Visão da POSION como empresa vendendo planos para clínicas.</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" className="bg-indigo-600 hover:bg-indigo-500"><Plus className="mr-1 h-4 w-4" /> Nova clínica</Button>
          <Button size="sm" variant="outline" className="border-white/10"><Receipt className="mr-1 h-4 w-4" /> Gerar cobrança</Button>
          <Button size="sm" variant="outline" className="border-white/10"><FileText className="mr-1 h-4 w-4" /> Contratos</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KPICard icon={Wallet} label="MRR" value={fmt(mrr)} hint="soma dos planos ativos" accent="indigo" />
        <KPICard icon={TrendingUp} label="ARR" value={fmt(arr)} hint="MRR × 12" accent="violet" />
        <KPICard icon={Users} label="Clientes ativos" value={`${active.length}`} hint={`${tenants.length} tenants no total`} accent="sky" />
        <KPICard icon={AlertTriangle} label="Churn 30d" value={`${churn.toFixed(1)}%`} hint={`${canceled30} cancelamento(s)`} accent="rose" />
        <KPICard icon={DollarSign} label="Receita do mês" value={fmt(mrr)} hint="mês corrente" accent="emerald" />
        <KPICard icon={Target} label="Ticket médio" value={fmt(ticket)} hint="por cliente ativo" accent="indigo" />
        <KPICard icon={CalendarClock} label="Venc. próximos" value={`${upcoming.length}`} hint="próx. 7 dias" accent="amber" />
        <KPICard icon={AlertCircle} label="Inadimplência" value={fmt(overdueAmount)} hint={`${overdue.length} em atraso`} accent="rose" />
      </div>

      {/* POSION (assessoria) vs Clínicas (volume fechado) */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-br from-indigo-500/10 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-indigo-300/80">Receita POSION · Assessoria/Plano</div>
            <Crown className="h-4 w-4 text-indigo-300" />
          </div>
          <div className="mt-2 text-3xl font-bold text-white">{fmt(mrr)} <span className="text-sm font-normal text-zinc-400">/mês</span></div>
          <div className="mt-1 text-xs text-zinc-400">o que as clínicas pagam pelo POSION — entra no MRR/ARR</div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 text-indigo-200">MRR {fmt(mrr)}</span>
            <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-violet-200">ARR {fmt(arr)}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-zinc-300">Ticket {fmt(ticket)}</span>
          </div>
        </div>

        <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-transparent p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-emerald-300/80">Volume fechado pelas clínicas · GMV</div>
            <DollarSign className="h-4 w-4 text-emerald-300" />
          </div>
          <div className="mt-2 text-3xl font-bold text-white">{fmt(gmvTotal)}</div>
          <div className="mt-1 text-xs text-zinc-400">soma de "valor da proposta" dos leads <b className="text-emerald-300">ganho</b> — é o que vai para Pixel/CAPI (ex.: R$ 28.000 do Alessandro)</div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">Mês {fmt(gmvMonth)}</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-zinc-300">{gmvCount} vendas</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-zinc-300">Ticket médio {fmt(gmvCount ? gmvTotal / gmvCount : 0)}</span>
          </div>
        </div>
      </div>

      {/* Charts */}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-xl border border-white/10 bg-[#111118] p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Crescimento do MRR</h3>
            <span className="text-xs text-zinc-500">últimos 12 meses</span>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={mrrHistory}>
              <defs>
                <linearGradient id="mrrG" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(142 71% 50%)" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="hsl(142 71% 50%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#222" />
              <XAxis dataKey="label" stroke="#666" fontSize={11} />
              <YAxis stroke="#666" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
              <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #222", borderRadius: 8 }} formatter={(v: number) => fmt(v)} />
              <Area type="monotone" dataKey="mrr" stroke="hsl(142 71% 50%)" fill="url(#mrrG)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111118] p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Clientes por plano</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={planDist} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {planDist.map((p, i) => <Cell key={i} fill={PLAN_COLORS[p.name] || "#666"} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #222", borderRadius: 8 }} />
              <Legend formatter={(v) => <span className="text-xs text-zinc-300 capitalize">{v}</span>} />
            </PieChart>
          </ResponsiveContainer>
          <div className="text-center text-xs text-zinc-500">Total: {active.length} clientes</div>
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-[#111118] p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">Receita por plano (mensal)</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={mrrHistory}>
            <CartesianGrid strokeDasharray="3 3" stroke="#222" />
            <XAxis dataKey="label" stroke="#666" fontSize={11} />
            <YAxis stroke="#666" fontSize={11} tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`} />
            <Tooltip contentStyle={{ background: "#0a0a0f", border: "1px solid #222", borderRadius: 8 }} formatter={(v: number) => fmt(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="starter" stackId="a" fill={PLAN_COLORS.starter} />
            <Bar dataKey="pro" stackId="a" fill={PLAN_COLORS.pro} />
            <Bar dataKey="scale" stackId="a" fill={PLAN_COLORS.scale} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tenants table */}
      <div className="rounded-xl border border-white/10 bg-[#111118]">
        <div className="flex items-center justify-between border-b border-white/10 p-4">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2"><Building2 className="h-4 w-4 text-indigo-400" /> Clientes do POSION</h3>
          <div className="text-xs text-zinc-400">MRR <span className="text-emerald-400 font-semibold">{fmt(mrr)}</span> · {active.length} ativos · {connectedTenants} conectados</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-xs uppercase text-zinc-400">
              <tr>
                <th className="px-4 py-2 text-left">Clínica</th>
                <th className="px-4 py-2 text-left">Plano</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Mensalidade</th>
                <th className="px-4 py-2 text-right">Volume fechado</th>
                <th className="px-4 py-2 text-left">Próx. venc.</th>
                <th className="px-4 py-2 text-left">WhatsApp</th>

              </tr>
            </thead>
            <tbody>
              {tenants.map(t => {
                const c = contractByTenant.get(t.id);
                const conn = connByTenant.get(t.id);
                const connected = (conn?.status || "").toLowerCase().includes("connect");
                const days = c?.renews_at ? daysBetween(now, new Date(c.renews_at)) : null;
                return (
                  <tr key={t.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white">{t.name}</td>
                    <td className="px-4 py-3 capitalize text-zinc-300">{c?.plan || "—"}</td>
                    <td className="px-4 py-3">{statusBadge(c?.status)}</td>
                    <td className="px-4 py-3 text-right text-zinc-200">{c ? fmt(Number(c.mrr)) : "—"}</td>
                    <td className="px-4 py-3 text-zinc-300">
                      {days === null ? "—" : days < 0 ? <span className="text-rose-400">Vencido</span> : `${days} dias`}
                    </td>
                    <td className="px-4 py-3">
                      {connected ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> OK</span> : <span className="text-zinc-500 flex items-center gap-1"><XCircle className="h-3.5 w-3.5" /> Off</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alerts + WhatsApp status */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-[#111118] p-4">
          <h3 className="mb-3 text-sm font-semibold text-white flex items-center gap-2"><AlertCircle className="h-4 w-4 text-amber-400" /> Alertas automáticos</h3>
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {alerts.length === 0 && <div className="text-xs text-zinc-500">Nenhum alerta no momento.</div>}
            {alerts.map((a, i) => {
              const color = a.level === "red" ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : a.level === "yellow" ? "border-amber-500/40 bg-amber-500/10 text-amber-200" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
              const dot = a.level === "red" ? "bg-rose-400 animate-pulse" : a.level === "yellow" ? "bg-amber-400" : "bg-emerald-400";
              return (
                <div key={i} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${color}`}>
                  <span className={`h-2 w-2 rounded-full ${dot}`} />
                  {a.text}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#111118] p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Status WhatsApp dos tenants</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500 uppercase">
                <tr><th className="px-2 py-1 text-left">Tenant</th><th className="px-2 py-1 text-left">Instância</th><th className="px-2 py-1 text-left">Status</th><th className="px-2 py-1 text-left">Atualizado</th></tr>
              </thead>
              <tbody>
                {tenants.map(t => {
                  const conn = connByTenant.get(t.id);
                  const connected = (conn?.status || "").toLowerCase().includes("connect");
                  return (
                    <tr key={t.id} className="border-t border-white/5">
                      <td className="px-2 py-2 text-zinc-200">{t.name}</td>
                      <td className="px-2 py-2 text-zinc-400">{conn?.instance_name || <span className="italic text-zinc-600">Não configurado</span>}</td>
                      <td className="px-2 py-2">
                        {!conn ? <span className="text-rose-400">❌ Descon.</span> : connected ? <span className="text-emerald-400">✅ Conectado</span> : <span className="text-amber-400">🔄 {conn.status || "—"}</span>}
                      </td>
                      <td className="px-2 py-2 text-zinc-500">{conn?.updated_at ? new Date(conn.updated_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Sales / Contracts management */}
      <SalesPanel contracts={contracts} tenants={tenants as any} sales={[] as any} isAdmin={true} onContractsChanged={load} />
    </div>
  );
};

export default Dashboard;
