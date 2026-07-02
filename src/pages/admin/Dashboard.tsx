import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { DateRangePicker, makeRange, type DateRangeValue } from "@/components/shared/DateRangePicker";
import {
  Building2, DollarSign, TrendingUp, GitBranch, FileText, Users, Trophy, Sparkles, ArrowUpRight,
  Loader2, Target, Zap,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar, Legend, FunnelChart, Funnel, LabelList,
} from "recharts";
import { format, eachDayOfInterval, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

const fmt = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);

const STAGE_COLORS: Record<string, string> = {
  lead: "#64748b", qualificado: "#06b6d4", reuniao: "#6366f1",
  proposta: "#8b5cf6", negociacao: "#f59e0b", ganho: "#10b981", perdido: "#f43f5e",
};
const STAGE_LABELS: Record<string, string> = {
  lead: "Lead", qualificado: "Qualificado", reuniao: "Reunião",
  proposta: "Proposta", negociacao: "Negociação", ganho: "Ganho", perdido: "Perdido",
};

interface AgencyLead { id: string; stage: string; valor_proposta: number | null; created_at: string; nome_clinica: string; plano_interesse: string | null }
interface AgencyContract { id: string; tenant_id: string | null; cliente_nome: string; valor_total: number; data_assinatura: string; status: string }
interface SaasContract { id: string; tenant_id: string | null; mrr: number; status: string; started_at: string }
interface Tenant { id: string; name: string; status: string; created_at: string }

export default function Dashboard() {
  const [range, setRange] = useState<DateRangeValue>(() => makeRange(30));
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<AgencyLead[]>([]);
  const [agencyContracts, setAgencyContracts] = useState<AgencyContract[]>([]);
  const [saasContracts, setSaasContracts] = useState<SaasContract[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantGmv, setTenantGmv] = useState<{ tenant_id: string; total: number }[]>([]);
  const [clinicLeadStages, setClinicLeadStages] = useState<{ stage: string; count: number }[]>([]);
  const [roiSeries, setRoiSeries] = useState<{ month: string; invest: number; receita: number; lucro: number }[]>([]);
  const [tenantsPerf, setTenantsPerf] = useState<{ tenant_id: string; name: string; leads: number; ganhos: number; gmv: number; invest: number; roas: number }[]>([]);
  const [tenantSearch, setTenantSearch] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      const fromDate = range.from.toISOString().slice(0, 10);
      const toDate = range.to.toISOString().slice(0, 10);
      const [l, ac, sc, t, sales, clinic, spend] = await Promise.all([
        supabase.from("agency_leads").select("id,stage,valor_proposta,created_at,nome_clinica,plano_interesse"),
        supabase.from("agency_contracts").select("id,tenant_id,cliente_nome,valor_total,data_assinatura,status"),
        supabase.from("saas_contracts").select("id,tenant_id,mrr,status,started_at"),
        supabase.from("tenants").select("id,name,status,created_at"),
        supabase.from("sales").select("tenant_id,amount,sale_date").gte("sale_date", fromDate).lte("sale_date", toDate),
        supabase.from("clinic_leads").select("tenant_id,stage,created_at").gte("created_at", range.from.toISOString()).lte("created_at", range.to.toISOString()),
        supabase.from("campaign_spend").select("tenant_id,amount_spent,period_start").gte("period_start", fromDate).lte("period_start", toDate),
      ]);
      setLeads((l.data || []) as AgencyLead[]);
      setAgencyContracts((ac.data || []) as AgencyContract[]);
      setSaasContracts((sc.data || []) as SaasContract[]);
      setTenants((t.data || []) as Tenant[]);

      const byTenant = new Map<string, number>();
      (sales.data || []).forEach((s: any) => {
        if (!s.tenant_id) return;
        byTenant.set(s.tenant_id, (byTenant.get(s.tenant_id) || 0) + Number(s.amount || 0));
      });
      setTenantGmv(Array.from(byTenant.entries()).map(([tenant_id, total]) => ({ tenant_id, total })));

      // Global funnel: agregação por stage entre todos os tenants
      const stageAgg = new Map<string, number>();
      (clinic.data || []).forEach((r: any) => {
        stageAgg.set(r.stage, (stageAgg.get(r.stage) || 0) + 1);
      });
      const FUNNEL_ORDER = ["lead", "qualificado", "consulta_agendada", "compareceu", "negociacao", "ganho", "perdido", "no_show"];
      setClinicLeadStages(FUNNEL_ORDER.map((s) => ({ stage: s, count: stageAgg.get(s) || 0 })));

      // ROI vs Investimento por mês
      const monthMap = new Map<string, { invest: number; receita: number }>();
      (spend.data || []).forEach((r: any) => {
        const k = format(startOfMonth(new Date(r.period_start)), "yyyy-MM");
        const cur = monthMap.get(k) || { invest: 0, receita: 0 };
        cur.invest += Number(r.amount_spent || 0);
        monthMap.set(k, cur);
      });
      (sales.data || []).forEach((r: any) => {
        const k = format(startOfMonth(new Date(r.sale_date)), "yyyy-MM");
        const cur = monthMap.get(k) || { invest: 0, receita: 0 };
        cur.receita += Number(r.amount || 0);
        monthMap.set(k, cur);
      });
      setRoiSeries(
        Array.from(monthMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => ({
            month: format(new Date(k + "-01"), "MMM/yy", { locale: ptBR }),
            invest: v.invest,
            receita: v.receita,
            lucro: Math.max(v.receita - v.invest, 0),
          }))
      );

      // Performance consolidada por tenant
      const leadsByT = new Map<string, { total: number; ganhos: number }>();
      (clinic.data || []).forEach((r: any) => {
        if (!r.tenant_id) return;
        const cur = leadsByT.get(r.tenant_id) || { total: 0, ganhos: 0 };
        cur.total += 1;
        if (r.stage === "ganho") cur.ganhos += 1;
        leadsByT.set(r.tenant_id, cur);
      });
      const spendByT = new Map<string, number>();
      (spend.data || []).forEach((r: any) => {
        if (!r.tenant_id) return;
        spendByT.set(r.tenant_id, (spendByT.get(r.tenant_id) || 0) + Number(r.amount_spent || 0));
      });
      const tenantsList = (t.data || []) as Tenant[];
      const perf = tenantsList.map((tn) => {
        const gmv = byTenant.get(tn.id) || 0;
        const invest = spendByT.get(tn.id) || 0;
        const ld = leadsByT.get(tn.id) || { total: 0, ganhos: 0 };
        return {
          tenant_id: tn.id,
          name: tn.name,
          leads: ld.total,
          ganhos: ld.ganhos,
          gmv,
          invest,
          roas: invest > 0 ? gmv / invest : 0,
        };
      }).sort((a, b) => b.gmv - a.gmv);
      setTenantsPerf(perf);

      setLoading(false);
    })();
  }, [range]);

  const inRange = (iso: string) => {
    const d = new Date(iso);
    return d >= range.from && d <= range.to;
  };

  // ============= AGÊNCIA =============
  const agency = useMemo(() => {
    const leadsPeriodo = leads.filter((l) => inRange(l.created_at));
    const ganhosAll = leads.filter((l) => l.stage === "ganho");
    const ganhosPeriodo = ganhosAll.filter((l) => inRange((l as any).ganho_at || l.created_at));
    const emNegociacao = leads.filter((l) => ["proposta", "negociacao"].includes(l.stage));
    const contratosPeriodo = agencyContracts.filter((c) => inRange(c.data_assinatura));

    // Receita = contratos assinados no período + leads em GANHO no período (fallback quando ainda não há contrato)
    const receitaContratos = contratosPeriodo.reduce((s, c) => s + Number(c.valor_total || 0), 0);
    const receitaGanhos = ganhosPeriodo.reduce((s, l) => s + Number(l.valor_proposta || 0), 0);
    const receitaAgencia = receitaContratos + receitaGanhos;

    const mrr = saasContracts.filter((s) => s.status === "active").reduce((s, c) => s + Number(c.mrr || 0), 0);

    const stageCount: Record<string, number> = {};
    leads.forEach((l) => { stageCount[l.stage] = (stageCount[l.stage] || 0) + 1; });
    const stageData = Object.entries(stageCount).map(([stage, count]) => ({
      stage: STAGE_LABELS[stage] || stage, count, fill: STAGE_COLORS[stage] || "#888",
    }));

    const convRate = leadsPeriodo.length > 0 ? (ganhosPeriodo.length / leadsPeriodo.length) * 100 : 0;
    const pipelineValue = emNegociacao.reduce((s, l) => s + (l.valor_proposta || 0), 0);
    const totalFechamentos = contratosPeriodo.length + ganhosPeriodo.length;
    const ticketMedio = totalFechamentos > 0 ? receitaAgencia / totalFechamentos : 0;

    return {
      leadsPeriodo: leadsPeriodo.length,
      ganhos: ganhosPeriodo.length,
      emNegociacao: emNegociacao.length,
      pipelineValue,
      receitaAgencia,
      mrr,
      convRate,
      ticketMedio,
      stageData,
      contratosPeriodo,
      totalCombinado: receitaAgencia + mrr,
    };
  }, [leads, agencyContracts, saasContracts, range]);

  // Timeline de receita (agência + saas) por dia
  const timelineData = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    return days.map((d) => {
      const dayKey = format(d, "yyyy-MM-dd");
      const receitaContratos = agencyContracts
        .filter((c) => c.data_assinatura === dayKey)
        .reduce((s, c) => s + Number(c.valor_total || 0), 0);
      const receitaGanhos = leads
        .filter((l) => l.stage === "ganho" && format(new Date((l as any).ganho_at || l.created_at), "yyyy-MM-dd") === dayKey)
        .reduce((s, l) => s + Number(l.valor_proposta || 0), 0);
      const label = format(d, days.length > 45 ? "dd/MM" : "dd/MM", { locale: ptBR });
      return { day: label, receita: receitaContratos + receitaGanhos };
    });
  }, [agencyContracts, leads, range]);

  // Top clínicas por GMV
  const topTenants = useMemo(() => {
    return tenantGmv
      .map((g) => ({ ...g, name: tenants.find((t) => t.id === g.tenant_id)?.name || "?" }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
  }, [tenantGmv, tenants]);

  const activeTenants = tenants.filter((t) => t.status === "active").length;
  const totalGmvTenants = tenantGmv.reduce((s, g) => s + g.total, 0);

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary/70 mb-1">POSION · Admin Master</div>
          <h1 className="text-3xl font-bold">Dashboard da Agência</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Vendas, contratos e operação consolidada · <span className="text-primary">{range.label}</span>
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* HERO — Total combinado */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary/70 mb-2">Receita total combinada</div>
              <div className="text-4xl font-bold">{fmt(agency.totalCombinado)}</div>
              <div className="text-sm text-muted-foreground mt-1">
                Agência {fmt(agency.receitaAgencia)} + SaaS MRR {fmt(agency.mrr)}/mês
              </div>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center">
              <DollarSign className="w-7 h-7 text-primary" />
            </div>
          </div>
          <div className="h-32 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timelineData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => fmt(v)}
                />
                <Line type="monotone" dataKey="receita" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-3">
          <MetricCard icon={GitBranch} label="Leads (período)" value={String(agency.leadsPeriodo)} accent="cyan" href="/admin/pipeline" />
          <MetricCard icon={Trophy} label="Ganhos (período)" value={String(agency.ganhos)} accent="emerald" href="/admin/pipeline" />
          <MetricCard icon={Target} label="Conversão" value={`${agency.convRate.toFixed(1)}%`} accent="violet" />
        </div>
      </div>

      {/* AGÊNCIA */}
      <section>
        <SectionTitle icon={GitBranch} title="Pipeline & Agência" subtitle="Funil de vendas POSION → clínicas" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KPI icon={DollarSign} label="Em negociação" value={fmt(agency.pipelineValue)} sub={`${agency.emNegociacao} leads`} />
          <KPI icon={FileText} label="Contratos assinados" value={String(agency.contratosPeriodo.length)} sub={fmt(agency.receitaAgencia)} />
          <KPI icon={TrendingUp} label="Ticket médio" value={fmt(agency.ticketMedio)} />
          <KPI icon={Sparkles} label="MRR SaaS ativo" value={fmt(agency.mrr)} sub={`${saasContracts.filter((s) => s.status === "active").length} assinaturas`} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2 rounded-xl border border-border/60 bg-card/40 p-4">
            <h3 className="text-sm font-semibold mb-3">Distribuição do funil</h3>
            <div className="space-y-2">
              {agency.stageData.map((s) => {
                const total = agency.stageData.reduce((sum, x) => sum + x.count, 0);
                const pct = total > 0 ? (s.count / total) * 100 : 0;
                return (
                  <div key={s.stage} className="flex items-center gap-3">
                    <span className="text-xs w-24 text-muted-foreground">{s.stage}</span>
                    <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: s.fill }} />
                    </div>
                    <span className="text-xs font-bold w-10 text-right">{s.count}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-4">
            <h3 className="text-sm font-semibold mb-3">Últimos ganhos</h3>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {leads.filter((l) => l.stage === "ganho").slice(0, 6).map((l) => (
                <div key={l.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{l.nome_clinica}</div>
                    <div className="text-[10px] text-muted-foreground">{format(new Date(l.created_at), "dd/MM/yy")}</div>
                  </div>
                  <span className="text-emerald-500 font-semibold text-xs">{fmt(l.valor_proposta || 0)}</span>
                </div>
              ))}
              {leads.filter((l) => l.stage === "ganho").length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">Nenhum lead ganho ainda.</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* OPERAÇÃO TENANTS */}
      <section>
        <SectionTitle icon={Building2} title="Operação dos Clientes" subtitle="Consolidado das clínicas — apenas leitura" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <KPI icon={Building2} label="Clínicas ativas" value={String(activeTenants)} sub={`${tenants.length} totais`} />
          <KPI icon={Users} label="GMV clínicas" value={fmt(totalGmvTenants)} sub="Vendas no período" />
          <KPI icon={FileText} label="Contratos SaaS ativos" value={String(saasContracts.filter((s) => s.status === "active").length)} />
          <KPI icon={Zap} label="Recuperação média" value={agency.convRate >= 20 ? "🔥 Alta" : "Normal"} />
        </div>

        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          <h3 className="text-sm font-semibold mb-3">Top 5 clínicas por resultado</h3>
          {topTenants.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">Sem vendas no período.</p>
          ) : (
            <div className="space-y-2">
              {topTenants.map((t, i) => (
                <div key={t.tenant_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30">
                  <span className="w-6 h-6 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <span className="flex-1 truncate text-sm">{t.name}</span>
                  <span className="text-primary font-semibold">{fmt(t.total)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="pt-3 mt-3 border-t border-border/40">
            <Link to="/admin/tenants" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              Ver todas as clínicas <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </section>

      {/* FUNIL DE CONVERSÃO GLOBAL */}
      <section>
        <SectionTitle icon={Target} title="Funil de conversão global" subtitle="clinic_leads agregados de todos os tenants no período" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border/60 bg-card/40 p-4">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart>
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any, _n: any, p: any) => [`${v} leads`, FUNNEL_LABELS[p.payload.stage] || p.payload.stage]}
                  />
                  <Funnel
                    dataKey="count"
                    data={clinicLeadStages.map((s, i) => ({
                      ...s,
                      name: FUNNEL_LABELS[s.stage] || s.stage,
                      fill: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
                    }))}
                    isAnimationActive
                  >
                    <LabelList position="right" dataKey="name" stroke="none" fill="hsl(var(--foreground))" fontSize={11} />
                    <LabelList position="center" dataKey="count" stroke="none" fill="#fff" fontSize={12} fontWeight={700} />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-4">
            <h3 className="text-sm font-semibold mb-3">Taxas de conversão entre etapas</h3>
            <div className="overflow-hidden rounded-lg border border-border/40">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="text-left px-3 py-2">Etapa</th><th className="text-right px-3 py-2">Leads</th><th className="text-right px-3 py-2">Conv. vs anterior</th></tr>
                </thead>
                <tbody>
                  {clinicLeadStages.map((s, i) => {
                    const prev = i > 0 ? clinicLeadStages[i - 1].count : 0;
                    const conv = prev > 0 ? (s.count / prev) * 100 : 0;
                    return (
                      <tr key={s.stage} className="odd:bg-transparent even:bg-muted/20 border-t border-border/30">
                        <td className="px-3 py-2 text-foreground">{FUNNEL_LABELS[s.stage] || s.stage}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.count}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-primary">{i === 0 ? "—" : `${conv.toFixed(1)}%`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </section>

      {/* ROI vs INVESTIMENTO GLOBAL */}
      <section>
        <SectionTitle icon={TrendingUp} title="ROI vs investimento global" subtitle="campaign_spend × sales agregados por mês" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 h-80">
          {roiSeries.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Sem dados no período.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roiSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => fmt(v)}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="invest" stackId="a" name="Investimento" fill="#f43f5e" radius={[0, 0, 0, 0]} />
                <Bar dataKey="lucro" stackId="a" name="Lucro (Rec-Inv)" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="receita" name="Receita total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* TABELA ZEBRA — PERFORMANCE POR CLIENTE */}
      <section>
        <SectionTitle icon={Building2} title="Performance consolidada por cliente" subtitle="Busca global · ordenado por GMV" />
        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar clínica…"
                value={tenantSearch}
                onChange={(e) => setTenantSearch(e.target.value)}
                className="pl-8 h-9 bg-background/50"
                aria-label="Buscar cliente"
              />
            </div>
            <span className="text-xs text-muted-foreground">{tenantsPerf.filter((r) => r.name.toLowerCase().includes(tenantSearch.toLowerCase())).length} resultados</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/40">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Cliente</th>
                  <th className="text-right px-3 py-2">Leads</th>
                  <th className="text-right px-3 py-2">Ganhos</th>
                  <th className="text-right px-3 py-2">Investimento</th>
                  <th className="text-right px-3 py-2">GMV</th>
                  <th className="text-right px-3 py-2">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {tenantsPerf
                  .filter((r) => r.name.toLowerCase().includes(tenantSearch.toLowerCase()))
                  .map((r) => (
                    <tr key={r.tenant_id} className="odd:bg-transparent even:bg-muted/20 border-t border-border/30 hover:bg-muted/30">
                      <td className="px-3 py-2 text-foreground truncate max-w-[220px]">{r.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.leads}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-400">{r.ganhos}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-rose-400">{fmt(r.invest)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-primary font-semibold">{fmt(r.gmv)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className={r.roas >= 2 ? "text-emerald-400 font-semibold" : r.roas >= 1 ? "text-amber-400" : "text-muted-foreground"}>
                          {r.roas > 0 ? `${r.roas.toFixed(2)}x` : "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                {tenantsPerf.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">Sem dados no período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

const FUNNEL_LABELS: Record<string, string> = {
  lead: "Novo lead",
  qualificado: "Qualificado",
  consulta_agendada: "Consulta agendada",
  compareceu: "Compareceu",
  negociacao: "Em negociação",
  ganho: "Ganho",
  perdido: "Perdido",
  no_show: "No-show",
};
const FUNNEL_COLORS = ["#64748b", "#06b6d4", "#6366f1", "#8b5cf6", "#f59e0b", "#10b981", "#f43f5e", "#94a3b8"];

function KPI({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
        <Icon className="w-4 h-4 text-primary/70" />
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, accent, href }: { icon: any; label: string; value: string; accent: "cyan" | "emerald" | "violet"; href?: string }) {
  const map = {
    cyan: "border-cyan-500/30 bg-cyan-500/5 text-cyan-400",
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-400",
    violet: "border-violet-500/30 bg-violet-500/5 text-violet-400",
  }[accent];
  const inner = (
    <div className={`rounded-xl border p-4 flex items-center gap-3 hover:scale-[1.02] transition-transform ${map}`}>
      <Icon className="w-6 h-6" />
      <div className="flex-1 min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] opacity-80">{label}</div>
        <div className="text-2xl font-bold text-foreground">{value}</div>
      </div>
      {href && <ArrowUpRight className="w-4 h-4 opacity-60" />}
    </div>
  );
  return href ? <Link to={href}>{inner}</Link> : inner;
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}
