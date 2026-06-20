import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Wallet, Users, Target, Sparkles, Megaphone, ArrowUpRight,
  CheckCircle2, Trophy, Activity, Building2, Clock, TrendingUp, DollarSign,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell,
  Tooltip, Legend, XAxis, YAxis, CartesianGrid, Area, AreaChart, ComposedChart, Line,
} from "recharts";
import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";
import { PIPELINE_STAGES } from "@/types/admin";
import SystemHealthCard from "@/components/admin/dashboard/SystemHealthCard";
import SalesPanel from "@/components/admin/dashboard/SalesPanel";
import type { SaasContract } from "@/components/admin/dashboard/SaasContractDialog";

type Lead = {
  id: string;
  status: string;
  origem: string | null;
  created_at: string;
  fechado_em: string | null;
  valor_proposta: number | null;
  tenant_id: string | null;
  facebook_form_id: string | null;
  facebook_form_name: string | null;
  facebook_campaign: string | null;
};
type Spend = { id: string; channel: string; campaign_name: string | null; campaign_id: string | null; amount_spent: number; leads_generated: number; impressions: number; clicks: number; period_start: string; period_end: string; tenant_id: string | null };
type Sale = { id: string; amount: number; amount_paid: number; amount_pending: number; payment_status: string; sale_date: string; clinic_lead_id: string | null; tenant_id: string; facebook_campaign_id: string | null; seller_name: string | null; procedure_category: string | null; international: boolean };
type Tenant = { id: string; name: string };

const COLORS = ["hsl(245 78% 62%)", "hsl(265 85% 68%)", "hsl(199 89% 60%)", "hsl(142 71% 55%)", "hsl(280 65% 65%)", "hsl(215 25% 55%)"];

// Funil 7 etapas (exclui ganho/perdido, mostrados separadamente)
const FUNNEL_7 = PIPELINE_STAGES.filter(s => s.id !== "ganho" && s.id !== "perdido");

const Dashboard = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [spends, setSpends] = useState<Spend[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7" | "30" | "90" | "all">("30");
  const [tenantFilter, setTenantFilter] = useState<string>("all");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [contracts, setContracts] = useState<SaasContract[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const periodDays = period === "all" ? 9999 : Number(period);
  const cutoff = new Date(Date.now() - periodDays * 86400000);

  const load = async () => {
    setLoading(true);
    const cutISO = cutoff.toISOString();
    const [l, s, sa, t, cfg] = await Promise.all([
      supabase.from("leads").select("id,status,origem,created_at,fechado_em,valor_proposta,tenant_id,facebook_form_id,facebook_form_name,facebook_campaign")
        .gte("created_at", cutISO).order("created_at", { ascending: false }).limit(8000),
      supabase.from("campaign_spend").select("*").gte("period_start", cutISO.slice(0, 10)).limit(3000),
      supabase.from("sales").select("id,amount,amount_paid,amount_pending,payment_status,sale_date,clinic_lead_id,tenant_id,facebook_campaign_id,seller_name,procedure_category,international").gte("sale_date", cutISO.slice(0, 10)).limit(5000),
      supabase.from("tenants").select("id,name").order("name"),
      supabase.rpc("get_facebook_config_meta" as any),
    ]);
    setLeads((l.data ?? []) as Lead[]);
    setSpends((s.data ?? []) as Spend[]);
    setSales((sa.data ?? []) as Sale[]);
    setTenants((t.data ?? []) as Tenant[]);
    const row: any = Array.isArray(cfg.data) ? cfg.data[0] : cfg.data;
    setLastSync(row?.last_campaigns_sync_at ?? null);
    setLoading(false);
  };

  const loadContracts = async () => {
    const { data } = await supabase.from("saas_contracts").select("*").order("created_at", { ascending: false });
    setContracts((data ?? []) as SaasContract[]);
  };

  useEffect(() => {
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return;
      const { data: admin } = await supabase.rpc("has_role", { _user_id: u.user.id, _role: "admin" as any });
      const ok = !!admin;
      setIsAdmin(ok);
      if (ok) loadContracts();
    })();
  }, []);

  useEffect(() => {
    load();
    const ch = supabase.channel("dashboard-leads")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    if (!lastSync) return;
    const ageMin = (Date.now() - new Date(lastSync).getTime()) / 60000;
    if (ageMin > 15) {
      supabase.functions.invoke("facebook-campaigns-sync", { body: { days: 30 } })
        .then(() => load()).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSync]);

  // aplica filtro de tenant
  const fLeads = useMemo(() => tenantFilter === "all" ? leads : leads.filter(l => l.tenant_id === tenantFilter), [leads, tenantFilter]);
  const fSpends = useMemo(() => tenantFilter === "all" ? spends : spends.filter(s => s.tenant_id === tenantFilter), [spends, tenantFilter]);
  const fSales = useMemo(() => tenantFilter === "all" ? sales : sales.filter(s => s.tenant_id === tenantFilter), [sales, tenantFilter]);

  const stats = useMemo(() => {
    const total = fLeads.length;
    const fbLeads = fLeads.filter(l => l.origem === "facebook_ads").length;
    const qual = fLeads.filter(l => ["mql","sql","reuniao_agendada","reuniao_realizada","proposta","negociacao"].includes(l.status)).length;
    const fech = fLeads.filter(l => l.status === "ganho" || l.status === "convertido" || l.status === "fechado_ganho").length;
    const perdido = fLeads.filter(l => l.status === "perdido" || l.status === "fechado_perdido").length;
    const invested = fSpends.reduce((a, b) => a + Number(b.amount_spent || 0), 0);
    const revenue = fSales.reduce((a, b) => a + Number(b.amount || 0), 0);
    const cpl = total > 0 ? invested / total : 0;
    const cac = fech > 0 ? invested / fech : 0;
    const roas = invested > 0 ? revenue / invested : 0;
    const convRate = total > 0 ? (fech / total) * 100 : 0;
    const qualRate = total > 0 ? (qual / total) * 100 : 0;
    // ciclo médio (dias entre created_at e fechado_em para leads fechados ganho)
    const closed = fLeads.filter(l => (l.status === "ganho" || l.status === "convertido") && l.fechado_em);
    const cycleDays = closed.length > 0
      ? closed.reduce((a, l) => a + ((new Date(l.fechado_em!).getTime() - new Date(l.created_at).getTime()) / 86400000), 0) / closed.length
      : 0;
    return { total, fbLeads, qual, fech, perdido, invested, revenue, cpl, cac, roas, convRate, qualRate, cycleDays };
  }, [fLeads, fSpends, fSales]);

  // leads × gasto por dia
  const dailySeries = useMemo(() => {
    const days = period === "all" ? 30 : Number(period);
    const buckets: Record<string, { date: string; leads: number; fb: number; spent: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      buckets[d] = { date: d.slice(5), leads: 0, fb: 0, spent: 0 };
    }
    for (const l of fLeads) {
      const d = l.created_at.slice(0, 10);
      if (buckets[d]) { buckets[d].leads += 1; if (l.origem === "facebook_ads") buckets[d].fb += 1; }
    }
    for (const s of fSpends) {
      const d = s.period_start;
      if (buckets[d]) buckets[d].spent += Number(s.amount_spent || 0);
    }
    return Object.values(buckets);
  }, [fLeads, fSpends, period]);

  const originMix = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of fLeads) { const k = l.origem || "site"; map[k] = (map[k] || 0) + 1; }
    const labels: Record<string, string> = { facebook_ads: "Facebook Ads", site: "Site", whatsapp: "WhatsApp", indicacao: "Indicação", organico: "Orgânico" };
    return Object.entries(map).map(([k, v]) => ({ name: labels[k] ?? k, value: v }));
  }, [fLeads]);

  // funil 7 etapas
  const funnel = useMemo(() => {
    return FUNNEL_7.map(stage => ({
      stage: stage.short,
      count: fLeads.filter(l => l.status === stage.id).length,
      color: stage.hex,
    }));
  }, [fLeads]);

  // top 5 campanhas FB (com receita atrelada)
  const topCampaigns = useMemo(() => {
    const map = new Map<string, { name: string; leads: number; spent: number; revenue: number }>();
    for (const l of fLeads) {
      if (l.origem !== "facebook_ads") continue;
      const key = l.facebook_campaign || l.facebook_form_name || "(sem campanha)";
      const cur = map.get(key) || { name: key, leads: 0, spent: 0, revenue: 0 };
      cur.leads += 1; map.set(key, cur);
    }
    for (const s of fSpends) {
      if (s.channel !== "meta_ads") continue;
      const key = s.campaign_name || "(sem campanha)";
      const cur = map.get(key) || { name: key, leads: 0, spent: 0, revenue: 0 };
      cur.spent += Number(s.amount_spent || 0); map.set(key, cur);
    }
    for (const sa of fSales) {
      if (!sa.facebook_campaign_id) continue;
      const cur = map.get(sa.facebook_campaign_id);
      if (cur) cur.revenue += Number(sa.amount || 0);
    }
    return Array.from(map.values()).sort((a, b) => b.leads - a.leads).slice(0, 5);
  }, [fLeads, fSpends, fSales]);

  // heatmap horário × dia da semana
  const heatmap = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const l of fLeads) {
      const d = new Date(l.created_at);
      grid[d.getDay()][d.getHours()] += 1;
    }
    const max = Math.max(1, ...grid.flat());
    return { grid, max };
  }, [fLeads]);

  // breakdown por tenant (apenas no modo "todos")
  const byTenant = useMemo(() => {
    const map = new Map<string, { id: string; name: string; leads: number; revenue: number; invested: number; sales: number }>();
    for (const t of tenants) map.set(t.id, { id: t.id, name: t.name, leads: 0, revenue: 0, invested: 0, sales: 0 });
    for (const l of leads) {
      if (!l.tenant_id) continue;
      const cur = map.get(l.tenant_id); if (cur) cur.leads += 1;
    }
    for (const s of sales) {
      if (!s.tenant_id) continue;
      const cur = map.get(s.tenant_id); if (cur) { cur.revenue += Number(s.amount || 0); cur.sales += 1; }
    }
    for (const sp of spends) {
      if (!sp.tenant_id) continue;
      const cur = map.get(sp.tenant_id); if (cur) cur.invested += Number(sp.amount_spent || 0);
    }
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue || b.leads - a.leads);
  }, [tenants, leads, sales, spends]);

  const activeTenants = byTenant.filter(t => t.leads > 0 || t.revenue > 0 || t.invested > 0);
  const inactiveTenants = byTenant.filter(t => !(t.leads > 0 || t.revenue > 0 || t.invested > 0));
  const totalTenantRevenue = byTenant.reduce((a, t) => a + t.revenue, 0);

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
              <Sparkles className="w-3 h-3" /> Comercial Premium
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Painel Comercial</h1>
          <p className="text-muted-foreground text-sm">Funil completo, performance Meta e saúde do sistema — em tempo real.</p>
          {lastSync && (
            <p className="text-[11px] text-muted-foreground/70 mt-1">Última sync Meta: {new Date(lastSync).toLocaleString("pt-BR")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {tenants.length > 0 && (
            <div className="flex items-center gap-2 bg-card/70 backdrop-blur border border-border rounded-full px-3 py-1.5">
              <Building2 className="w-3.5 h-3.5 text-accent" />
              <select value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}
                className="bg-transparent text-xs text-foreground focus:outline-none cursor-pointer">
                <option value="all">Todos locatários</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}
          {tenantFilter === "all" && tenants.length > 0 && (
            <button
              onClick={() => document.getElementById("tenant-breakdown")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              title={inactiveTenants.length ? `Sem dados: ${inactiveTenants.map(t => t.name).join(", ")}` : "Todos os clientes com dados no período"}
              className={`inline-flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-full border transition hover:scale-[1.02] ${
                activeTenants.length < tenants.length
                  ? "bg-amber-500/10 border-amber-500/40 text-amber-300"
                  : "bg-emerald-500/10 border-emerald-500/40 text-emerald-300"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${activeTenants.length < tenants.length ? "bg-amber-400" : "bg-emerald-400"} animate-pulse`} />
              {activeTenants.length} de {tenants.length} ativos
            </button>
          )}
          <div className="flex gap-1 bg-card/70 backdrop-blur border border-border rounded-full p-1">
            {[{v:"7",l:"7d"},{v:"30",l:"30d"},{v:"90",l:"90d"},{v:"all",l:"Tudo"}].map(o => (
              <button key={o.v} onClick={() => setPeriod(o.v as any)}
                className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition ${period===o.v ? "gradient-accent text-[hsl(232_65%_5%)]" : "text-muted-foreground hover:text-foreground"}`}>
                {o.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPIs Linha 1 — Volume */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiTile icon={Users} label="Leads" value={stats.total} accent="sky" sub="no período" />
        <KpiTile icon={Megaphone} label="Facebook Ads" value={stats.fbLeads} accent="gold" sub={`${stats.total ? Math.round(stats.fbLeads/stats.total*100) : 0}% do total`} />
        <KpiTile icon={CheckCircle2} label="Qualificados" value={stats.qual} accent="emerald" sub={`${stats.qualRate.toFixed(1)}% taxa`} />
        <KpiTile icon={Trophy} label="Fechados" value={stats.fech} accent="emerald" sub={`${stats.convRate.toFixed(1)}% conversão`} />
        <KpiTile icon={Wallet} label="Investido" value={stats.invested} prefix="R$ " accent="rose" sub="Meta Ads" />
        <KpiTile icon={DollarSign} label="Receita" value={stats.revenue} prefix="R$ " accent="emerald" sub="vendas no período" />
      </div>

      {/* KPIs Linha 2 — Performance */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiTile icon={Target} label="CPL" value={stats.cpl} prefix="R$ " accent="gold" decimals={2} sub="custo por lead" />
        <KpiTile icon={Target} label="CAC" value={stats.cac} prefix="R$ " accent="rose" decimals={2} sub="custo de aquisição" />
        <KpiTile icon={TrendingUp} label="ROAS" value={stats.roas} suffix="x" accent="emerald" decimals={2} sub="retorno sobre investimento" />
        <KpiTile icon={Clock} label="Ciclo médio" value={stats.cycleDays} suffix=" d" accent="sky" decimals={1} sub="dias até fechar" />
      </div>

      {/* Breakdown por cliente — só no modo "todos" */}
      {tenantFilter === "all" && byTenant.length > 0 && (
        <div id="tenant-breakdown" className="card-elevated p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Distribuição</p>
              <h3 className="font-display text-lg text-foreground normal-case tracking-normal">
                Por cliente · {byTenant.length} {byTenant.length === 1 ? "cliente" : "clientes"}
              </h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {activeTenants.length} com dados · {inactiveTenants.length} sem dados no período
            </span>
          </div>
          <div className="space-y-2.5">
            {byTenant.map((t) => {
              const isActive = t.leads > 0 || t.revenue > 0 || t.invested > 0;
              const pct = totalTenantRevenue > 0 ? (t.revenue / totalTenantRevenue) * 100 : 0;
              return (
                <button
                  key={t.id}
                  onClick={() => setTenantFilter(t.id)}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition hover:scale-[1.005] hover:border-accent/50 ${
                    isActive ? "bg-card/60 border-border" : "bg-card/30 border-border/40 opacity-70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? "bg-emerald-400" : "bg-muted-foreground/40"}`} />
                      <span className="text-sm font-medium text-foreground truncate">{t.name}</span>
                      {!isActive && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 border border-border/40 rounded px-1.5 py-0.5">sem dados</span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 text-xs tabular-nums flex-shrink-0">
                      <span className="text-muted-foreground">{t.leads} leads</span>
                      <span className="text-muted-foreground">{t.sales} vendas</span>
                      <span className="text-emerald-400 font-semibold">
                        R$ {t.revenue.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-card/40 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.max(pct, isActive ? 2 : 0)}%`,
                        background: isActive
                          ? "linear-gradient(90deg, hsl(142 71% 55%), hsl(199 89% 60%))"
                          : "hsl(215 25% 35%)",
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Painel de vendas (admin master) */}
      {tenantFilter === "all" && (
        <SalesPanel
          tenants={tenants}
          sales={sales as any}
          contracts={contracts}
          isAdmin={isAdmin}
          onContractsChanged={loadContracts}
        />
      )}

      {/* Funil 7 etapas */}
      <div className="card-elevated p-6">
        <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Funil</p>
        <h3 className="font-display text-lg text-foreground normal-case tracking-normal mb-4">Funil de conversão — 7 etapas</h3>
        <div className="space-y-2">
          {funnel.map((f, i) => {
            const max = Math.max(1, ...funnel.map(x => x.count));
            const pct = (f.count / max) * 100;
            const prev = i > 0 ? funnel[i - 1].count : f.count;
            const conv = prev > 0 ? (f.count / prev) * 100 : 0;
            return (
              <div key={f.stage} className="flex items-center gap-3">
                <div className="w-32 text-xs text-muted-foreground text-right truncate">{f.stage}</div>
                <div className="flex-1 h-9 bg-card/40 rounded-lg overflow-hidden border border-border/40 relative">
                  <div className="h-full rounded-lg transition-all duration-700"
                    style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${f.color}, ${f.color}aa)` }} />
                  <div className="absolute inset-0 flex items-center justify-between px-3">
                    <span className="text-sm font-semibold text-foreground tabular-nums">{f.count}</span>
                    {i > 0 && <span className="text-[10px] text-muted-foreground">{conv.toFixed(0)}% vs etapa anterior</span>}
                  </div>
                </div>
              </div>
            );
          })}
          <div className="flex gap-4 pt-3 mt-3 border-t border-border/30 text-xs">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /><strong className="text-emerald-400">{stats.fech}</strong> ganhos</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" /><strong className="text-rose-400">{stats.perdido}</strong> perdidos</span>
          </div>
        </div>
      </div>

      {/* Leads × Gasto + Saúde do Sistema */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card-elevated p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Performance diária</p>
              <h3 className="font-display text-lg text-foreground normal-case tracking-normal">Leads × Investimento</h3>
            </div>
            <Activity className="w-5 h-5 text-accent/70" />
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={dailySeries} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(199 89% 60%)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(199 89% 60%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(224 30% 18%)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} />
                <YAxis yAxisId="left" stroke="hsl(199 89% 60%)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis yAxisId="right" orientation="right" stroke="hsl(45 75% 70%)" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area yAxisId="left" type="monotone" dataKey="leads" name="Leads" stroke="hsl(199 89% 60%)" strokeWidth={2.5} fill="url(#leadsFill)" />
                <Line yAxisId="right" type="monotone" dataKey="spent" name="Investido (R$)" stroke="hsl(45 75% 70%)" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <SystemHealthCard />
      </div>

      {/* Origem + Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2 card-elevated p-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Origens</p>
          <h3 className="font-display text-lg text-foreground normal-case tracking-normal mb-3">Por origem</h3>
          {originMix.length === 0 ? (
            <EmptyHint text="Sem leads no período" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                  <Pie data={originMix} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2} stroke="hsl(226 53% 9%)">
                    {originMix.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11, color: "hsl(215 20% 65%)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 card-elevated p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Padrões</p>
              <h3 className="font-display text-lg text-foreground normal-case tracking-normal">Heatmap — horário × dia</h3>
            </div>
            <Clock className="w-5 h-5 text-accent/70" />
          </div>
          <Heatmap data={heatmap.grid} max={heatmap.max} />
        </div>
      </div>

      {/* Top 5 campanhas */}
      <div className="card-elevated p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Campanhas</p>
            <h3 className="font-display text-lg text-foreground normal-case tracking-normal">Top 5 — Facebook Ads</h3>
          </div>
          <Megaphone className="w-5 h-5 text-accent" />
        </div>
        {topCampaigns.length === 0 ? (
          <EmptyHint text="Nenhuma campanha. Sincronize em /admin/campanhas." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  <th className="py-2 pr-4">Campanha</th>
                  <th className="py-2 px-2 text-right">Leads</th>
                  <th className="py-2 px-2 text-right">Investido</th>
                  <th className="py-2 px-2 text-right">Receita</th>
                  <th className="py-2 px-2 text-right">CPL</th>
                  <th className="py-2 pl-2 text-right">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {topCampaigns.map((c, i) => {
                  const cpl = c.leads > 0 ? c.spent / c.leads : 0;
                  const roas = c.spent > 0 ? c.revenue / c.spent : 0;
                  return (
                    <tr key={i} className="border-b border-border/20 hover:bg-card/40 transition">
                      <td className="py-3 pr-4 font-medium text-foreground truncate max-w-xs">{c.name}</td>
                      <td className="py-3 px-2 text-right tabular-nums text-sky-400">{c.leads}</td>
                      <td className="py-3 px-2 text-right tabular-nums">R$ {c.spent.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
                      <td className="py-3 px-2 text-right tabular-nums text-emerald-400">R$ {c.revenue.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}</td>
                      <td className="py-3 px-2 text-right tabular-nums">R$ {cpl.toFixed(2)}</td>
                      <td className={`py-3 pl-2 text-right tabular-nums font-semibold ${roas >= 2 ? "text-emerald-400" : roas >= 1 ? "text-amber-400" : "text-rose-400"}`}>{roas.toFixed(2)}x</td>
                    </tr>
                  );
                })}
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

const DOW = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

const Heatmap = ({ data, max }: { data: number[][]; max: number }) => (
  <div className="overflow-x-auto">
    <div className="min-w-[640px]">
      <div className="flex gap-px text-[9px] text-muted-foreground/60 pl-10 mb-1">
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="flex-1 text-center">{h % 3 === 0 ? h : ""}</div>
        ))}
      </div>
      {data.map((row, d) => (
        <div key={d} className="flex items-center gap-px mb-px">
          <div className="w-10 text-[10px] text-muted-foreground pr-2 text-right">{DOW[d]}</div>
          {row.map((v, h) => {
            const intensity = v / max;
            const bg = v === 0
              ? "hsl(224 30% 14%)"
              : `hsl(45 75% ${70 - intensity * 30}% / ${0.25 + intensity * 0.75})`;
            return (
              <div key={h} title={`${DOW[d]} ${h}h: ${v} lead(s)`}
                className="flex-1 h-5 rounded-sm transition hover:ring-1 hover:ring-accent"
                style={{ background: bg }} />
            );
          })}
        </div>
      ))}
    </div>
  </div>
);

const ACCENTS: Record<string, { ring: string; text: string; bg: string; glow: string }> = {
  gold:   { ring: "ring-accent/25",        text: "text-accent",         bg: "bg-accent/10",         glow: "hover:shadow-[0_20px_45px_-20px_hsl(42_65%_58%/0.6)]" },
  emerald:{ ring: "ring-emerald-500/25",   text: "text-emerald-400",    bg: "bg-emerald-500/10",    glow: "hover:shadow-[0_20px_45px_-20px_hsl(142_71%_45%/0.5)]" },
  sky:    { ring: "ring-sky-500/25",       text: "text-sky-400",        bg: "bg-sky-500/10",        glow: "hover:shadow-[0_20px_45px_-20px_hsl(199_89%_48%/0.5)]" },
  rose:   { ring: "ring-rose-500/25",      text: "text-rose-400",       bg: "bg-rose-500/10",       glow: "hover:shadow-[0_20px_45px_-20px_hsl(347_77%_55%/0.5)]" },
};

const KpiTile = ({ icon: Icon, label, value, prefix = "", suffix = "", decimals = 0, sub, accent = "gold" }: any) => {
  const { ref, inView } = useInView<HTMLDivElement>();
  const animated = useCountUp(value, inView, 1200);
  const a = ACCENTS[accent] ?? ACCENTS.gold;
  const shown = decimals > 0 ? animated.toFixed(decimals) : Math.round(animated).toLocaleString("pt-BR");

  return (
    <div ref={ref}
      className={`group relative bg-card/80 backdrop-blur border border-border/50 rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 ${a.glow}`}>
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
