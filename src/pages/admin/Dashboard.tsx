import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PIPELINE_STAGES, ORIGEM_LABELS } from "@/types/admin";
import type { Lead } from "@/types/admin";
import {
  Eye, Users, Filter, Target, Calendar, FileText, Trophy, DollarSign, TrendingUp,
} from "lucide-react";

interface PageView { id: string; created_at: string; utm_source: string | null; }

const Dashboard = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pageViews, setPageViews] = useState<PageView[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7" | "30" | "all">("30");

  useEffect(() => {
    const load = async () => {
      const [{ data: l }, { data: pv }] = await Promise.all([
        supabase.from("leads").select("*").order("created_at", { ascending: false }),
        supabase.from("page_views").select("id, created_at, utm_source").order("created_at", { ascending: false }).limit(5000),
      ]);
      setLeads((l ?? []) as any);
      setPageViews((pv ?? []) as any);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    if (period === "all") return { leads, pageViews };
    const days = Number(period);
    const cutoff = new Date(Date.now() - days * 86400000);
    return {
      leads: leads.filter((l) => new Date(l.created_at) >= cutoff),
      pageViews: pageViews.filter((p) => new Date(p.created_at) >= cutoff),
    };
  }, [leads, pageViews, period]);

  // Funil
  const totalPageviews = filtered.pageViews.length;
  const totalLeads     = filtered.leads.length;
  const mqls = filtered.leads.filter((l) => l.mql || ["mql","sql","reuniao_agendada","reuniao_realizada","proposta","negociacao","ganho"].includes(l.status)).length;
  const sqls = filtered.leads.filter((l) => l.sql_qualified || ["sql","reuniao_agendada","reuniao_realizada","proposta","negociacao","ganho"].includes(l.status)).length;
  const reunioes = filtered.leads.filter((l) => l.reuniao_realizada_em || ["reuniao_realizada","proposta","negociacao","ganho"].includes(l.status)).length;
  const propostas = filtered.leads.filter((l) => l.proposta_enviada_em || ["proposta","negociacao","ganho"].includes(l.status)).length;
  const ganhos = filtered.leads.filter((l) => l.status === "ganho").length;
  const perdidos = filtered.leads.filter((l) => l.status === "perdido").length;

  const receitaFechada = filtered.leads
    .filter((l) => l.status === "ganho")
    .reduce((s, l) => s + (Number(l.valor_proposta) || 0), 0);
  const pipelineAberto = filtered.leads
    .filter((l) => !["ganho","perdido","novo","desqualificado"].includes(l.status))
    .reduce((s, l) => s + (Number(l.valor_proposta) || 0), 0);
  const ticketMedio = ganhos > 0 ? receitaFechada / ganhos : 0;

  const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : "0");

  const funnel = [
    { label: "Pageviews",         icon: Eye,         value: totalPageviews,   pctOfPrev: 100,                                     pctOfTop: 100,                                     color: "from-slate-500 to-slate-600" },
    { label: "Leads",             icon: Users,       value: totalLeads,       pctOfPrev: Number(pct(totalLeads, totalPageviews)), pctOfTop: Number(pct(totalLeads, totalPageviews)), color: "from-sky-500 to-sky-600" },
    { label: "MQL",               icon: Filter,      value: mqls,             pctOfPrev: Number(pct(mqls, totalLeads)),           pctOfTop: Number(pct(mqls, totalPageviews)),       color: "from-blue-500 to-blue-600" },
    { label: "SQL",               icon: Target,      value: sqls,             pctOfPrev: Number(pct(sqls, mqls)),                 pctOfTop: Number(pct(sqls, totalPageviews)),       color: "from-indigo-500 to-indigo-600" },
    { label: "Reuniões",          icon: Calendar,    value: reunioes,         pctOfPrev: Number(pct(reunioes, sqls)),             pctOfTop: Number(pct(reunioes, totalPageviews)),   color: "from-violet-500 to-violet-600" },
    { label: "Propostas",         icon: FileText,    value: propostas,        pctOfPrev: Number(pct(propostas, reunioes)),        pctOfTop: Number(pct(propostas, totalPageviews)),  color: "from-purple-500 to-purple-600" },
    { label: "Fechados Ganhos",   icon: Trophy,      value: ganhos,           pctOfPrev: Number(pct(ganhos, propostas)),          pctOfTop: Number(pct(ganhos, totalPageviews)),     color: "from-emerald-500 to-emerald-600" },
  ];

  // Origem
  const porOrigem = filtered.leads.reduce<Record<string, number>>((acc, l) => {
    const o = l.origem ?? "site";
    acc[o] = (acc[o] || 0) + 1; return acc;
  }, {});

  if (loading) {
    return <div className="flex items-center justify-center h-full"><div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard Comercial</h1>
          <p className="text-muted-foreground text-sm">Funil completo e métricas de pipeline B2B</p>
        </div>
        <div className="flex gap-1 bg-card border border-border rounded-lg p-1">
          {[{v:"7",l:"7 dias"},{v:"30",l:"30 dias"},{v:"all",l:"Tudo"}].map(o => (
            <button key={o.v} onClick={() => setPeriod(o.v as any)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${period===o.v ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs financeiros */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KpiCard icon={DollarSign} label="Receita Fechada" value={`R$ ${receitaFechada.toLocaleString("pt-BR")}`} color="text-emerald-400" bg="bg-emerald-400/10" />
        <KpiCard icon={TrendingUp} label="Pipeline Aberto" value={`R$ ${pipelineAberto.toLocaleString("pt-BR")}`} color="text-accent" bg="bg-accent/10" />
        <KpiCard icon={Trophy}     label="Ticket Médio"    value={`R$ ${ticketMedio.toLocaleString("pt-BR", {maximumFractionDigits: 0})}`} color="text-amber-400" bg="bg-amber-400/10" />
        <KpiCard icon={Target}     label="Win Rate"        value={`${pct(ganhos, ganhos + perdidos)}%`} sub={`${ganhos} ganhos / ${perdidos} perdidos`} color="text-violet-400" bg="bg-violet-400/10" />
      </div>

      {/* Funil de conversão */}
      <div className="bg-card border border-border/50 rounded-xl p-6">
        <h3 className="font-semibold text-foreground mb-1">Funil de Conversão</h3>
        <p className="text-xs text-muted-foreground mb-5">Da visita ao fechamento — % na direita é conversão da etapa anterior</p>
        <div className="space-y-2">
          {funnel.map((step, idx) => {
            const widthPct = totalPageviews > 0 ? Math.max(10, (step.value / totalPageviews) * 100) : (step.value > 0 ? 50 : 10);
            return (
              <div key={step.label} className="flex items-center gap-3">
                <div className="w-32 flex items-center gap-2 text-sm">
                  <step.icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-foreground font-medium">{step.label}</span>
                </div>
                <div className="flex-1 relative h-10 bg-muted/30 rounded-lg overflow-hidden">
                  <div className={`absolute inset-y-0 left-0 bg-gradient-to-r ${step.color} rounded-lg transition-all duration-700 flex items-center px-3`}
                       style={{ width: `${widthPct}%` }}>
                    <span className="text-white font-bold text-sm tabular-nums">{step.value.toLocaleString("pt-BR")}</span>
                  </div>
                </div>
                <div className="w-24 text-right">
                  {idx > 0 && (
                    <span className={`text-xs font-semibold tabular-nums ${step.pctOfPrev >= 30 ? "text-emerald-400" : step.pctOfPrev >= 10 ? "text-amber-400" : "text-rose-400"}`}>
                      {step.pctOfPrev}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Distribuição do Pipeline + Origem */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border/50 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-4">Distribuição do Pipeline</h3>
          <div className="space-y-2">
            {PIPELINE_STAGES.map((s) => {
              const count = filtered.leads.filter((l) => l.status === s.id).length;
              const total = filtered.leads.length || 1;
              const w = (count / total) * 100;
              return (
                <div key={s.id} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-32 truncate">{s.title}</span>
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div className={`h-full bg-gradient-to-r ${s.color}`} style={{ width: `${w}%` }} />
                  </div>
                  <span className="text-xs font-bold text-foreground w-8 text-right tabular-nums">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-card border border-border/50 rounded-xl p-6">
          <h3 className="font-semibold text-foreground mb-4">Origem dos Leads</h3>
          {Object.keys(porOrigem).length === 0 ? (
            <p className="text-muted-foreground text-sm">Nenhum lead no período</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(porOrigem).sort((a,b)=>b[1]-a[1]).map(([origem, count]) => {
                const info = ORIGEM_LABELS[origem] ?? ORIGEM_LABELS.outro;
                const w = (count / filtered.leads.length) * 100;
                return (
                  <div key={origem} className="flex items-center justify-between gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${info.color}`}>{info.label}</span>
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-accent/60" style={{ width: `${w}%` }} />
                    </div>
                    <span className="text-sm font-bold text-foreground w-12 text-right tabular-nums">
                      {count} <span className="text-xs text-muted-foreground">({w.toFixed(0)}%)</span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const KpiCard = ({ icon: Icon, label, value, sub, color, bg }: any) => (
  <div className="bg-card rounded-xl border border-border/50 p-5">
    <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center mb-3`}>
      <Icon className={`w-5 h-5 ${color}`} />
    </div>
    <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
    <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    {sub && <p className="text-[10px] text-muted-foreground/70 mt-1">{sub}</p>}
  </div>
);

export default Dashboard;
