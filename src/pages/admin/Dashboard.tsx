import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  TrendingUp, Wallet, Users, Repeat, Trophy, Target, ArrowUpRight, Sparkles,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  Tooltip, Legend, XAxis, YAxis, CartesianGrid, Area, AreaChart,
} from "recharts";
import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";

interface Contract {
  id: string;
  tenant_id: string;
  plan_name: string | null;
  monthly_fee: number;
  setup_fee: number;
  start_date: string;
  end_date: string | null;
  status: "active" | "paused" | "churned";
}
interface Tenant { id: string; name: string; }

const STATUS_COLORS = ["hsl(45 75% 70%)", "hsl(215 25% 55%)", "hsl(0 70% 60%)"];

const Dashboard = () => {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7" | "30" | "90" | "all">("30");

  useEffect(() => {
    (async () => {
      const [c, t] = await Promise.all([
        (supabase.from("posion_contracts" as any) as any)
          .select("id,tenant_id,plan_name,monthly_fee,setup_fee,start_date,end_date,status")
          .limit(10000),
        supabase.from("tenants").select("id,name"),
      ]);
      setContracts(((c.data ?? []) as any) as Contract[]);
      setTenants((t.data ?? []) as any);
      setLoading(false);
    })();
  }, []);

  const periodDays = period === "all" ? 9999 : Number(period);
  const cutoff = new Date(Date.now() - periodDays * 86400000);

  const stats = useMemo(() => {
    const active = contracts.filter(c => c.status === "active");
    const mrr = active.reduce((sum, c) => sum + Number(c.monthly_fee || 0), 0);
    const arr = mrr * 12;

    const newInPeriod = contracts.filter(c => new Date(c.start_date) >= cutoff);
    const churnedInPeriod = contracts.filter(
      c => c.status === "churned" && c.end_date && new Date(c.end_date) >= cutoff
    );

    const setupRevenue = newInPeriod.reduce((s, c) => s + Number(c.setup_fee || 0), 0);
    const recurringRevenue = active.reduce(
      (s, c) => s + Number(c.monthly_fee || 0) * Math.min(
        periodDays / 30,
        Math.max(0, (Date.now() - new Date(c.start_date).getTime()) / (30 * 86400000))
      ), 0
    );
    const totalRevenue = setupRevenue + recurringRevenue;

    const denom = active.length + churnedInPeriod.length;
    const churnRate = denom > 0 ? (churnedInPeriod.length / denom) * 100 : 0;
    const avgTicket = active.length ? mrr / active.length : 0;

    return {
      mrr, arr, totalRevenue, newCount: newInPeriod.length,
      churned: churnedInPeriod.length, churnRate, avgTicket,
      activeCount: active.length,
    };
  }, [contracts, cutoff, periodDays]);

  // MRR evolution — last 6 months
  const mrrTrend = useMemo(() => {
    const months: { label: string; mrr: number; novos: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const ref = new Date();
      ref.setDate(1);
      ref.setMonth(ref.getMonth() - i);
      const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
      const mrr = contracts
        .filter(c => {
          const start = new Date(c.start_date);
          const stop = c.end_date ? new Date(c.end_date) : null;
          return start <= end && (!stop || stop > end);
        })
        .reduce((s, c) => s + Number(c.monthly_fee || 0), 0);
      const novos = contracts.filter(c => {
        const s = new Date(c.start_date);
        return s.getMonth() === ref.getMonth() && s.getFullYear() === ref.getFullYear();
      }).length;
      months.push({
        label: ref.toLocaleString("pt-BR", { month: "short" }).replace(".", ""),
        mrr, novos,
      });
    }
    return months;
  }, [contracts]);

  // Plan mix
  const planMix = useMemo(() => {
    const map: Record<string, number> = {};
    contracts.filter(c => c.status === "active").forEach(c => {
      const key = c.plan_name || "Sem plano";
      map[key] = (map[key] || 0) + Number(c.monthly_fee || 0);
    });
    return Object.entries(map).map(([name, value]) => ({ name, value }));
  }, [contracts]);

  const statusMix = useMemo(() => {
    const counts = { active: 0, paused: 0, churned: 0 };
    contracts.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
    return [
      { name: "Ativos", value: counts.active },
      { name: "Pausados", value: counts.paused },
      { name: "Churn", value: counts.churned },
    ].filter(d => d.value > 0);
  }, [contracts]);

  // Top clinics by what Posion bills them (active + monthly_fee)
  const topClinics = useMemo(() => {
    return contracts
      .filter(c => c.status === "active")
      .map(c => {
        const tenant = tenants.find(t => t.id === c.tenant_id);
        const monthsActive = Math.max(
          1,
          (Date.now() - new Date(c.start_date).getTime()) / (30 * 86400000)
        );
        const ltv = Number(c.monthly_fee || 0) * monthsActive + Number(c.setup_fee || 0);
        return {
          id: c.id,
          name: tenant?.name ?? "—",
          plan: c.plan_name ?? "—",
          monthly: Number(c.monthly_fee || 0),
          start: c.start_date,
          ltv,
        };
      })
      .sort((a, b) => b.ltv - a.ltv)
      .slice(0, 10);
  }, [contracts, tenants]);

  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-accent/90 border border-accent/30 bg-accent/5 px-2.5 py-1 rounded-full">
              <Sparkles className="w-3 h-3" /> Master
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">
            Receita Posion
          </h1>
          <p className="text-muted-foreground text-sm">
            Mensalidade e novos contratos das clínicas clientes
          </p>
        </div>
        <div className="flex gap-1 bg-card/70 backdrop-blur border border-border rounded-full p-1">
          {[{v:"7",l:"7d"},{v:"30",l:"30d"},{v:"90",l:"90d"},{v:"all",l:"Tudo"}].map(o => (
            <button key={o.v} onClick={() => setPeriod(o.v as any)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition ${period===o.v ? "gradient-accent text-[hsl(232_65%_5%)]" : "text-muted-foreground hover:text-foreground"}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs flutuantes */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <KpiTile icon={Wallet} label="MRR" value={stats.mrr} prefix="R$ " accent="emerald"
          sub={`${stats.activeCount} contratos ativos`} />
        <KpiTile icon={TrendingUp} label="ARR projetado" value={stats.arr} prefix="R$ " accent="gold"
          sub="MRR × 12" />
        <KpiTile icon={Users} label="Novas clínicas" value={stats.newCount} accent="sky"
          sub={`no período (${period === "all" ? "total" : period + "d"})`} />
        <KpiTile icon={Repeat} label="Churn" value={stats.churnRate} suffix="%" decimals={1} accent="rose"
          sub={`${stats.churned} contratos encerrados`} />
      </div>

      {/* Tendência MRR + Mix de planos */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card-elevated p-6 group hover:border-accent/40 transition">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Tendência</p>
              <h3 className="font-display text-lg text-foreground normal-case tracking-normal">
                MRR · últimos 6 meses
              </h3>
            </div>
            <Trophy className="w-5 h-5 text-accent/70 group-hover:text-accent transition" />
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={mrrTrend} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="mrrFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(45 75% 70%)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(45 75% 70%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(224 30% 18%)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="hsl(215 20% 65%)" fontSize={12} tickLine={false} />
                <YAxis stroke="hsl(215 20% 65%)" fontSize={12} tickLine={false} axisLine={false}
                  tickFormatter={v => `R$${(v/1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }}
                  formatter={(v: number) => [`R$ ${fmt(v)}`, "MRR"]}
                />
                <Area type="monotone" dataKey="mrr" stroke="hsl(42 65% 58%)" strokeWidth={2.5}
                  fill="url(#mrrFill)" dot={{ fill: "hsl(45 75% 70%)", r: 4 }} activeDot={{ r: 6 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-elevated p-6 group hover:border-accent/40 transition">
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Composição</p>
          <h3 className="font-display text-lg text-foreground normal-case tracking-normal mb-3">
            Por plano (MRR)
          </h3>
          {planMix.length === 0 ? (
            <EmptyHint text="Sem contratos ativos" />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }}
                    formatter={(v: number) => `R$ ${fmt(v)}`} />
                  <Pie data={planMix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95}
                    paddingAngle={2} stroke="hsl(226 53% 9%)">
                    {planMix.map((_, i) => (
                      <Cell key={i} fill={["hsl(45 75% 70%)","hsl(42 65% 58%)","hsl(38 55% 45%)","hsl(34 50% 35%)","hsl(30 40% 28%)"][i % 5]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11, color: "hsl(215 20% 65%)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Novas vs Status */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card-elevated p-6 group hover:border-accent/40 transition">
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Aquisição</p>
          <h3 className="font-display text-lg text-foreground normal-case tracking-normal mb-3">
            Novas clínicas / mês
          </h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mrrTrend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid stroke="hsl(224 30% 18%)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" stroke="hsl(215 20% 65%)" fontSize={12} tickLine={false} />
                <YAxis stroke="hsl(215 20% 65%)" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                <Bar dataKey="novos" radius={[8, 8, 0, 0]} fill="hsl(42 65% 58%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-elevated p-6 group hover:border-accent/40 transition">
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Saúde</p>
          <h3 className="font-display text-lg text-foreground normal-case tracking-normal mb-3">
            Status da carteira
          </h3>
          {statusMix.length === 0 ? (
            <EmptyHint text="Sem contratos cadastrados" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                  <Pie data={statusMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}
                    paddingAngle={2} stroke="hsl(226 53% 9%)">
                    {statusMix.map((_, i) => <Cell key={i} fill={STATUS_COLORS[i]} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 12, color: "hsl(215 20% 65%)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Top 10 clínicas (por LTV pago à Posion) */}
      <div className="card-elevated p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Carteira</p>
            <h3 className="font-display text-lg text-foreground normal-case tracking-normal">
              Top 10 clínicas — receita pra Posion
            </h3>
          </div>
          <Target className="w-5 h-5 text-accent" />
        </div>
        {topClinics.length === 0 ? (
          <EmptyHint text="Nenhum contrato ativo. Cadastre contratos para popular o dashboard." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border/60">
                <tr className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Clínica</th>
                  <th className="px-4 py-3 text-left">Plano</th>
                  <th className="px-4 py-3 text-right">Mensal</th>
                  <th className="px-4 py-3 text-right">LTV acumulado</th>
                  <th className="px-4 py-3 text-right">Início</th>
                </tr>
              </thead>
              <tbody>
                {topClinics.map((c, idx) => (
                  <tr key={c.id}
                    className={`border-b border-border/30 hover:bg-accent/5 transition ${idx % 2 === 0 ? "bg-muted/10" : ""}`}>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{c.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{c.plan}</td>
                    <td className="px-4 py-3 text-right tabular-nums">R$ {fmt(c.monthly)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-accent tabular-nums">R$ {fmt(c.ltv)}</td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground tabular-nums">
                      {new Date(c.start).toLocaleDateString("pt-BR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyHint = ({ text }: { text: string }) => (
  <div className="h-64 flex items-center justify-center text-sm text-muted-foreground/80 italic">{text}</div>
);

const ACCENTS: Record<string, { ring: string; text: string; bg: string; glow: string }> = {
  gold:   { ring: "ring-accent/25",        text: "text-accent",         bg: "bg-accent/10",         glow: "hover:shadow-[0_20px_45px_-20px_hsl(42_65%_58%/0.6)]" },
  emerald:{ ring: "ring-emerald-500/25",   text: "text-emerald-400",    bg: "bg-emerald-500/10",    glow: "hover:shadow-[0_20px_45px_-20px_hsl(142_71%_45%/0.5)]" },
  sky:    { ring: "ring-sky-500/25",       text: "text-sky-400",        bg: "bg-sky-500/10",        glow: "hover:shadow-[0_20px_45px_-20px_hsl(199_89%_48%/0.5)]" },
  rose:   { ring: "ring-rose-500/25",      text: "text-rose-400",       bg: "bg-rose-500/10",       glow: "hover:shadow-[0_20px_45px_-20px_hsl(347_77%_55%/0.5)]" },
};

const KpiTile = ({
  icon: Icon, label, value, prefix = "", suffix = "", decimals = 0, sub, accent = "gold",
}: any) => {
  const { ref, inView } = useInView<HTMLDivElement>();
  const animated = useCountUp(value, inView, 1400);
  const a = ACCENTS[accent] ?? ACCENTS.gold;
  const shown =
    decimals > 0 ? animated.toFixed(decimals) : Math.round(animated).toLocaleString("pt-BR");

  return (
    <div
      ref={ref}
      className={`group relative bg-card/80 backdrop-blur border border-border/50 rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 ${a.glow}`}
    >
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
      <div className="relative flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl ${a.bg} ring-1 ${a.ring} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${a.text}`} strokeWidth={1.8} />
        </div>
        <ArrowUpRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-accent group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition" />
      </div>
      <p className="relative text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1">{label}</p>
      <p className="relative font-display text-3xl text-foreground tabular-nums">
        {prefix}{shown}{suffix}
      </p>
      {sub && <p className="relative text-[11px] text-muted-foreground/80 mt-2">{sub}</p>}
    </div>
  );
};

export default Dashboard;
