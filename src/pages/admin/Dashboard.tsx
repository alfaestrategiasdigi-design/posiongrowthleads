import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  TrendingUp, DollarSign, BarChart3, Zap, Trophy, Target,
} from "lucide-react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";

interface ClinicLead {
  id: string; tenant_id: string; stage: string | null; channel: string | null;
  sale_amount: number | null; negotiation_value: number | null;
  created_at: string;
}
interface Sale {
  id: string; tenant_id: string; amount: number | null;
  amount_paid: number | null; created_at: string; sale_date: string | null;
}
interface Tenant { id: string; name: string; }

const STAGES = [
  "Novo Lead", "Qualificado", "Avaliação Agendada",
  "Compareceu", "Negociação", "Fechado Ganho", "Fechado Perdido",
] as const;

const STAGE_COLORS: Record<string, string> = {
  "Novo Lead": "from-slate-500 to-slate-600",
  "Qualificado": "from-sky-500 to-sky-600",
  "Avaliação Agendada": "from-blue-500 to-blue-600",
  "Compareceu": "from-violet-500 to-violet-600",
  "Negociação": "from-purple-500 to-purple-600",
  "Fechado Ganho": "from-emerald-500 to-emerald-600",
  "Fechado Perdido": "from-rose-500 to-rose-600",
};

const DONUT_COLORS = ["#d4af37","#3b82f6","#8b5cf6","#10b981","#f59e0b","#ef4444","#64748b"];

const CHANNEL_LABEL: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", google: "Google",
  organic: "Orgânico", indicacao: "Indicação", site: "Site",
  whatsapp: "WhatsApp", outro: "Outro",
};

const Dashboard = () => {
  const [leads, setLeads] = useState<ClinicLead[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7" | "30" | "90" | "all">("30");

  useEffect(() => {
    (async () => {
      const [l, s, t] = await Promise.all([
        supabase.from("clinic_leads").select("id,tenant_id,stage,channel,sale_amount,negotiation_value,created_at").limit(10000),
        supabase.from("sales").select("id,tenant_id,amount,amount_paid,created_at,sale_date").limit(10000),
        supabase.from("tenants").select("id,name"),
      ]);
      setLeads((l.data ?? []) as any);
      setSales((s.data ?? []) as any);
      setTenants((t.data ?? []) as any);
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    if (period === "all") return { leads, sales };
    const cutoff = new Date(Date.now() - Number(period) * 86400000);
    return {
      leads: leads.filter(l => new Date(l.created_at) >= cutoff),
      sales: sales.filter(s => new Date(s.sale_date ?? s.created_at) >= cutoff),
    };
  }, [leads, sales, period]);

  // KPIs
  const totalRevenue = filtered.sales.reduce((sum, s) => sum + Number(s.amount || 0), 0);
  const totalPaid    = filtered.sales.reduce((sum, s) => sum + Number(s.amount_paid || 0), 0);
  const pipeline     = filtered.leads
    .filter(l => !["Fechado Ganho","Fechado Perdido"].includes(l.stage ?? ""))
    .reduce((sum, l) => sum + Number(l.negotiation_value || 0), 0);
  const closedWins   = filtered.leads.filter(l => l.stage === "Fechado Ganho").length;
  const closedLost   = filtered.leads.filter(l => l.stage === "Fechado Perdido").length;
  const winRate      = closedWins + closedLost > 0 ? (closedWins / (closedWins + closedLost)) * 100 : 0;
  const ticketMedio  = closedWins > 0 ? totalRevenue / closedWins : 0;
  const conversion   = filtered.leads.length > 0 ? (closedWins / filtered.leads.length) * 100 : 0;

  // Funil cumulativo
  const funnelOrder = ["Novo Lead","Qualificado","Avaliação Agendada","Compareceu","Negociação","Fechado Ganho"];
  const funnel = funnelOrder.map((stage, idx) => {
    const reachableIdx = funnelOrder.slice(idx);
    const count = filtered.leads.filter(l => reachableIdx.includes(l.stage ?? "")).length;
    return { stage, count };
  });
  const topCount = funnel[0]?.count || 1;

  // Donut: distribuição por stage
  const donutData = STAGES.map(stage => ({
    name: stage,
    value: filtered.leads.filter(l => l.stage === stage).length,
  })).filter(d => d.value > 0);

  // Bar: canal
  const channelMap: Record<string, number> = {};
  filtered.leads.forEach(l => {
    const c = l.channel || "outro";
    channelMap[c] = (channelMap[c] || 0) + 1;
  });
  const channelData = Object.entries(channelMap)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ channel: CHANNEL_LABEL[k] ?? k, count: v }));

  // Top tenants
  const tenantStats = tenants.map(t => {
    const ts = filtered.sales.filter(s => s.tenant_id === t.id);
    const revenue = ts.reduce((s, x) => s + Number(x.amount || 0), 0);
    return { ...t, revenue, count: ts.length, ticket: ts.length ? revenue / ts.length : 0 };
  }).filter(t => t.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 10);

  if (loading) {
    return <div className="flex items-center justify-center h-full p-12">
      <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
    </div>;
  }

  const fmt = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Posion Master Dashboard</h1>
          <p className="text-muted-foreground text-sm">Visão consolidada de todas as clínicas</p>
        </div>
        <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
          {[{v:"7",l:"7d"},{v:"30",l:"30d"},{v:"90",l:"90d"},{v:"all",l:"Tudo"}].map(o => (
            <button key={o.v} onClick={() => setPeriod(o.v as any)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${period===o.v ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard title="Receita Fechada" value={`R$ ${fmt(totalRevenue)}`} sub={`R$ ${fmt(totalPaid)} recebido`} icon={TrendingUp} color="text-emerald-400" bg="bg-emerald-400/10" />
        <KPICard title="Pipeline Aberto" value={`R$ ${fmt(pipeline)}`} sub={`${filtered.leads.length} leads no funil`} icon={DollarSign} color="text-sky-400" bg="bg-sky-400/10" />
        <KPICard title="Ticket Médio" value={`R$ ${fmt(ticketMedio)}`} sub={`${closedWins} vendas fechadas`} icon={BarChart3} color="text-violet-400" bg="bg-violet-400/10" />
        <KPICard title="Win Rate" value={`${winRate.toFixed(1)}%`} sub={`Conversão geral ${conversion.toFixed(1)}%`} icon={Zap} color="text-amber-400" bg="bg-amber-400/10" />
      </div>

      {/* Funil */}
      <div className="bg-card border border-border/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold text-foreground">Funil de Conversão</h3>
            <p className="text-xs text-muted-foreground">% acumulado a partir do topo</p>
          </div>
          <Trophy className="w-5 h-5 text-amber-400" />
        </div>
        <div className="space-y-2">
          {funnel.map((step, idx) => {
            const pctTop = topCount > 0 ? (step.count / topCount) * 100 : 0;
            const width = Math.max(10, pctTop);
            return (
              <div key={step.stage} className="flex items-center gap-3">
                <div className="w-40 text-sm text-foreground font-medium">{step.stage}</div>
                <div className="flex-1 relative h-10 bg-muted/30 rounded-lg overflow-hidden">
                  <div className={`absolute inset-y-0 left-0 bg-gradient-to-r ${STAGE_COLORS[step.stage]} rounded-lg transition-all duration-700 flex items-center px-3`}
                       style={{ width: `${width}%` }}>
                    <span className="text-white font-bold text-sm tabular-nums">{step.count.toLocaleString("pt-BR")}</span>
                  </div>
                </div>
                <div className="w-20 text-right text-xs font-semibold tabular-nums text-muted-foreground">
                  {idx === 0 ? "100%" : `${pctTop.toFixed(1)}%`}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Donut + Barras */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border/50 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-4">Distribuição do Pipeline</h3>
          {donutData.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sem dados no período</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey="value">
                  {donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ background: "#0f0f1e", border: "1px solid #2a2a3a", borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-border/50 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-4">Origem dos Leads</h3>
          {channelData.length === 0 ? (
            <p className="text-muted-foreground text-sm">Sem dados no período</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={channelData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a3a" />
                <XAxis dataKey="channel" stroke="#94a3b8" fontSize={12} />
                <YAxis stroke="#94a3b8" fontSize={12} />
                <Tooltip contentStyle={{ background: "#0f0f1e", border: "1px solid #2a2a3a", borderRadius: 8 }} />
                <Bar dataKey="count" fill="#d4af37" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top tenants */}
      <div className="bg-card border border-border/50 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold text-foreground">Top 10 Clínicas</h3>
            <p className="text-xs text-muted-foreground">Por receita total no período</p>
          </div>
          <Target className="w-5 h-5 text-accent" />
        </div>
        {tenantStats.length === 0 ? (
          <p className="text-muted-foreground text-sm">Nenhuma venda registrada no período</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-xs text-muted-foreground uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Clínica</th>
                  <th className="px-4 py-3 text-right">Receita</th>
                  <th className="px-4 py-3 text-right">Vendas</th>
                  <th className="px-4 py-3 text-right">Ticket Médio</th>
                </tr>
              </thead>
              <tbody>
                {tenantStats.map((t, idx) => (
                  <tr key={t.id} className={`border-b border-border/30 ${idx % 2 === 0 ? "bg-muted/10" : ""}`}>
                    <td className="px-4 py-3 text-muted-foreground tabular-nums">{idx + 1}</td>
                    <td className="px-4 py-3 font-medium text-foreground">{t.name}</td>
                    <td className="px-4 py-3 text-right font-semibold text-emerald-400 tabular-nums">R$ {fmt(t.revenue)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{t.count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">R$ {fmt(t.ticket)}</td>
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

const KPICard = ({ title, value, sub, icon: Icon, color, bg }: any) => (
  <div className="bg-card rounded-xl border border-border/50 p-5 hover:border-accent/40 transition">
    <div className="flex items-start justify-between mb-3">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
    </div>
    <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
    <p className="text-xs text-muted-foreground mt-0.5">{title}</p>
    {sub && <p className="text-[10px] text-muted-foreground/70 mt-1">{sub}</p>}
  </div>
);

export default Dashboard;
