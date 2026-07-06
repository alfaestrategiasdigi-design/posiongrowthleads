import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { DateRangePicker, makeRange, type DateRangeValue } from "@/components/shared/DateRangePicker";
import {
  Building2, DollarSign, TrendingUp, GitBranch, FileText, Trophy, Sparkles, ArrowUpRight,
  Loader2, Target, Pencil, Check, X, ArrowUp, ArrowDown, Minus,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { format, eachDayOfInterval, differenceInCalendarDays, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

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

const ORIGEM_LABELS: Record<string, string> = {
  facebook_ads: "Facebook Ads",
  facebook: "Facebook Ads",
  instagram: "Instagram",
  whatsapp: "WhatsApp",
  site: "Site / Orgânico",
  organico: "Orgânico",
  indicacao: "Indicação",
};
const originLabel = (o: string | null | undefined) => {
  if (!o) return "Outros";
  return ORIGEM_LABELS[o] ?? o.replace(/_/g, " ");
};

const GOAL_KEY = "posion:dashboard:monthly-goal";
const DEFAULT_GOAL = 50000;

interface AgencyLead {
  id: string; stage: string; valor_proposta: number | null; created_at: string;
  nome_clinica: string; plano_interesse: string | null;
  origem: string | null; ganho_at: string | null; perdido_motivo: string | null;
  updated_at: string | null;
}
interface AgencyContract { id: string; agency_lead_id: string | null; tenant_id: string | null; cliente_nome: string; valor_total: number; data_assinatura: string; status: string }
interface SaasContract { id: string; tenant_id: string | null; mrr: number; status: string; started_at: string }
interface Tenant { id: string; name: string; status: string; created_at: string }

export default function Dashboard() {
  const [range, setRange] = useState<DateRangeValue>(() => makeRange(30));
  const [loading, setLoading] = useState(true);
  const [leads, setLeads] = useState<AgencyLead[]>([]);
  const [agencyContracts, setAgencyContracts] = useState<AgencyContract[]>([]);
  const [saasContracts, setSaasContracts] = useState<SaasContract[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [monthlyGoal, setMonthlyGoal] = useState<number>(() => {
    const s = typeof window !== "undefined" ? window.localStorage.getItem(GOAL_KEY) : null;
    return s ? Number(s) || DEFAULT_GOAL : DEFAULT_GOAL;
  });
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalDraft, setGoalDraft] = useState<string>(String(monthlyGoal));

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [l, ac, sc, t] = await Promise.all([
        supabase.from("agency_leads").select("id,stage,valor_proposta,created_at,updated_at,nome_clinica,plano_interesse,origem,ganho_at,perdido_motivo,tenant_id_criado"),
        supabase
          .from("agency_contracts")
          .select("id,agency_lead_id,tenant_id,cliente_nome,valor_total,data_assinatura,status")
          .is("tenant_id", null)
          .order("data_assinatura", { ascending: false }),
        supabase.from("saas_contracts").select("id,tenant_id,mrr,status,started_at"),
        supabase.from("tenants").select("id,name,status,created_at"),
      ]);
      setLeads((l.data || []) as AgencyLead[]);
      setAgencyContracts((ac.data || []) as AgencyContract[]);
      setSaasContracts((sc.data || []) as SaasContract[]);
      setTenants((t.data || []) as Tenant[]);
      setLoading(false);
    })();
  }, [range]);

  const rangeLen = differenceInCalendarDays(range.to, range.from) + 1;
  const prevFrom = subDays(range.from, rangeLen);
  const prevTo = subDays(range.to, rangeLen);
  const inRange = (iso: string) => { const d = new Date(iso); return d >= range.from && d <= range.to; };
  const inPrev = (iso: string) => { const d = new Date(iso); return d >= prevFrom && d <= prevTo; };

  // ============= AGÊNCIA (POSION) =============
  const agency = useMemo(() => {
    const leadsPeriodo = leads.filter((l) => inRange(l.created_at));
    const leadsPrev = leads.filter((l) => inPrev(l.created_at));
    const emNegociacao = leads.filter((l) => ["proposta", "negociacao"].includes(l.stage));
    const contratosPeriodo = agencyContracts.filter((c) => inRange(c.data_assinatura));
    const contratosPrev = agencyContracts.filter((c) => inPrev(c.data_assinatura));

    const receitaAgencia = contratosPeriodo.reduce((s, c) => s + Number(c.valor_total || 0), 0);
    const mrr = saasContracts.filter((s) => s.status === "active").reduce((s, c) => s + Number(c.mrr || 0), 0);

    const stageCount: Record<string, number> = {};
    leads.forEach((l) => { stageCount[l.stage] = (stageCount[l.stage] || 0) + 1; });
    const stageData = Object.entries(stageCount).map(([stage, count]) => ({
      stage: STAGE_LABELS[stage] || stage, count, fill: STAGE_COLORS[stage] || "#888",
    }));

    // Origem dos leads (dentro do período)
    const origemCount: Record<string, number> = {};
    leadsPeriodo.forEach((l) => {
      const key = originLabel(l.origem);
      origemCount[key] = (origemCount[key] || 0) + 1;
    });
    const origemData = Object.entries(origemCount)
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);

    const convRate = leadsPeriodo.length > 0 ? (contratosPeriodo.length / leadsPeriodo.length) * 100 : 0;
    const convRatePrev = leadsPrev.length > 0 ? (contratosPrev.length / leadsPrev.length) * 100 : 0;
    const pipelineValue = emNegociacao.reduce((s, l) => s + (l.valor_proposta || 0), 0);
    const totalFechamentos = contratosPeriodo.length;
    const ticketMedio = totalFechamentos > 0 ? receitaAgencia / totalFechamentos : 0;

    // Sparkline series per KPI
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    const leadsSeries = days.map((d) => {
      const key = format(d, "yyyy-MM-dd");
      return leads.filter((l) => l.created_at.startsWith(key)).length;
    });
    const ganhosSeries = days.map((d) => {
      const key = format(d, "yyyy-MM-dd");
      return agencyContracts.filter((c) => c.data_assinatura === key).length;
    });
    const convSeries = days.map((_d, i) => {
      const lc = leadsSeries[i] || 0;
      const gc = ganhosSeries[i] || 0;
      return lc > 0 ? (gc / lc) * 100 : 0;
    });

    // Perdas + atividade
    const perdas = leads
      .filter((l) => l.stage === "perdido" && (l.updated_at ? inRange(l.updated_at) : inRange(l.created_at)))
      .sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at))
      .slice(0, 8);
    const atividade = [...leads]
      .filter((l) => l.updated_at && inRange(l.updated_at))
      .sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""))
      .slice(0, 8);

    return {
      leadsPeriodo: leadsPeriodo.length,
      leadsPrev: leadsPrev.length,
      ganhos: contratosPeriodo.length,
      ganhosPrev: contratosPrev.length,
      emNegociacao: emNegociacao.length,
      pipelineValue,
      receitaAgencia,
      receitaAgenciaPrev: contratosPrev.reduce((s, c) => s + Number(c.valor_total || 0), 0),
      mrr,
      convRate,
      convRatePrev,
      ticketMedio,
      stageData,
      origemData,
      contratosPeriodo,
      totalCombinado: receitaAgencia + mrr,
      leadsSeries,
      ganhosSeries,
      convSeries,
      perdas,
      atividade,
    };
  }, [leads, agencyContracts, saasContracts, range]);

  const timelineData = useMemo(() => {
    const days = eachDayOfInterval({ start: range.from, end: range.to });
    return days.map((d) => {
      const dayKey = format(d, "yyyy-MM-dd");
      const receitaContratos = agencyContracts
        .filter((c) => c.data_assinatura === dayKey)
        .reduce((s, c) => s + Number(c.valor_total || 0), 0);
      const label = format(d, "dd/MM", { locale: ptBR });
      return { day: label, receita: receitaContratos };
    });
  }, [agencyContracts, range]);

  const activeTenants = tenants.filter((t) => t.status === "active").length;

  const saveGoal = () => {
    const n = Math.max(0, Number(goalDraft.replace(/[^\d]/g, "")) || 0);
    setMonthlyGoal(n);
    window.localStorage.setItem(GOAL_KEY, String(n));
    setEditingGoal(false);
  };
  const goalPct = monthlyGoal > 0 ? Math.min(100, (agency.totalCombinado / monthlyGoal) * 100) : 0;

  if (loading) {
    return <div className="flex items-center justify-center h-96"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-amber-400/80 mb-1 font-mono">POSION · Admin Master</div>
          <h1 className="text-3xl font-bold">Dashboard da Agência</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Somente vendas e contratos da POSION · <span className="text-amber-400">{range.label}</span>
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* HERO — Total combinado */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div data-no-float className="premium-hero lg:col-span-2 rounded-2xl p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-amber-400/80 mb-2 font-mono">Receita total combinada</div>
              <div className="text-4xl font-bold bg-gradient-to-br from-white to-amber-200/90 bg-clip-text text-transparent">{fmt(agency.totalCombinado)}</div>
              <div className="text-sm text-muted-foreground mt-1">
                Agência {fmt(agency.receitaAgencia)} + SaaS MRR {fmt(agency.mrr)}/mês
              </div>
            </div>
            <div className="w-14 h-14 rounded-2xl premium-section-icon flex items-center justify-center">
              <DollarSign className="w-7 h-7 text-amber-300" />
            </div>
          </div>

          {/* Meta mensal */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Target className="w-3 h-3 text-amber-400" />
                Meta mensal
                {!editingGoal ? (
                  <button
                    type="button"
                    onClick={() => { setGoalDraft(String(monthlyGoal)); setEditingGoal(true); }}
                    className="ml-1 inline-flex items-center gap-1 text-amber-400/70 hover:text-amber-300"
                    title="Editar meta"
                  >
                    <span>{fmt(monthlyGoal)}</span>
                    <Pencil className="w-3 h-3" />
                  </button>
                ) : (
                  <span className="ml-1 inline-flex items-center gap-1">
                    <input
                      autoFocus
                      value={goalDraft}
                      onChange={(e) => setGoalDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveGoal(); if (e.key === "Escape") setEditingGoal(false); }}
                      className="w-24 bg-background/80 border border-amber-500/40 rounded px-1.5 py-0.5 text-foreground focus:outline-none focus:border-amber-400"
                      inputMode="numeric"
                    />
                    <button type="button" onClick={saveGoal} className="text-emerald-400 hover:text-emerald-300"><Check className="w-3 h-3" /></button>
                    <button type="button" onClick={() => setEditingGoal(false)} className="text-rose-400 hover:text-rose-300"><X className="w-3 h-3" /></button>
                  </span>
                )}
              </div>
              <span className="text-amber-300 font-semibold tabular-nums">
                {goalPct.toFixed(1)}% atingido
              </span>
            </div>
            <div className="mt-1.5 h-1.5 bg-muted/40 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${goalPct}%`,
                  background: "linear-gradient(90deg, hsl(44 75% 68%), hsl(40 78% 40%))",
                  boxShadow: "0 0 10px hsl(44 68% 52% / 0.5)",
                }}
              />
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
                <Line type="monotone" dataKey="receita" stroke="hsl(44 75% 55%)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-3">
          <MetricCard
            label="Leads (período)"
            value={String(agency.leadsPeriodo)}
            current={agency.leadsPeriodo}
            previous={agency.leadsPrev}
            series={agency.leadsSeries}
            href="/admin/pipeline"
          />
          <MetricCard
            label="Ganhos (período)"
            value={String(agency.ganhos)}
            current={agency.ganhos}
            previous={agency.ganhosPrev}
            series={agency.ganhosSeries}
            href="/admin/pipeline"
          />
          <MetricCard
            label="Conversão"
            value={`${agency.convRate.toFixed(1)}%`}
            current={agency.convRate}
            previous={agency.convRatePrev}
            series={agency.convSeries}
          />
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
          <div data-no-float className="premium-card rounded-xl p-4">
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
                    <span className="text-xs font-bold w-10 text-right tabular-nums">{s.count}</span>
                  </div>
                );
              })}
              {agency.stageData.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">Sem leads no período.</div>
              )}
            </div>
          </div>

          <div data-no-float className="premium-card rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3">Origem dos leads</h3>
            <div className="space-y-2">
              {(() => {
                const max = Math.max(1, ...agency.origemData.map((o) => o.count));
                return agency.origemData.map((o) => {
                  const pct = (o.count / max) * 100;
                  return (
                    <div key={o.label} className="flex items-center gap-3">
                      <span className="text-xs w-24 text-muted-foreground truncate" title={o.label}>{o.label}</span>
                      <div className="flex-1 h-2 bg-muted/40 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: "linear-gradient(90deg, hsl(44 75% 68%), hsl(40 78% 40%))" }}
                        />
                      </div>
                      <span className="text-xs font-bold w-10 text-right tabular-nums">{o.count}</span>
                    </div>
                  );
                });
              })()}
              {agency.origemData.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">Sem leads no período.</div>
              )}
            </div>
          </div>

          <div data-no-float className="premium-card rounded-xl p-4">
            <Tabs defaultValue="ganhos" className="w-full">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Movimentação</h3>
                <TabsList className="h-7 bg-muted/40">
                  <TabsTrigger value="ganhos" className="text-[10px] px-2 h-6 data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-300">Ganhos</TabsTrigger>
                  <TabsTrigger value="perdas" className="text-[10px] px-2 h-6 data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-300">Perdas</TabsTrigger>
                  <TabsTrigger value="ativ" className="text-[10px] px-2 h-6 data-[state=active]:bg-amber-500/15 data-[state=active]:text-amber-300">Atividade</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="ganhos" className="mt-0">
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {agencyContracts.slice(0, 8).map((c) => (
                    <div key={c.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{c.cliente_nome}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">{format(new Date(c.data_assinatura), "dd/MM/yy")}</div>
                      </div>
                      <span className="text-emerald-500 font-semibold text-xs tabular-nums">{fmt(c.valor_total || 0)}</span>
                    </div>
                  ))}
                  {agencyContracts.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-6">Nenhum ganho ainda.</div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="perdas" className="mt-0">
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {agency.perdas.map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0 gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{l.nome_clinica}</div>
                        <div className="text-[10px] text-muted-foreground truncate" title={l.perdido_motivo || ""}>
                          {l.perdido_motivo || "Sem motivo registrado"}
                        </div>
                      </div>
                      <span className="text-rose-400 font-semibold text-[10px] font-mono">
                        {format(new Date(l.updated_at || l.created_at), "dd/MM/yy")}
                      </span>
                    </div>
                  ))}
                  {agency.perdas.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-6">Nenhuma perda no período.</div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="ativ" className="mt-0">
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {agency.atividade.map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0 gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{l.nome_clinica}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {STAGE_LABELS[l.stage] || l.stage}
                        </div>
                      </div>
                      <span className="text-amber-300/80 font-semibold text-[10px] font-mono">
                        {format(new Date(l.updated_at || l.created_at), "dd/MM HH:mm")}
                      </span>
                    </div>
                  ))}
                  {agency.atividade.length === 0 && (
                    <div className="text-xs text-muted-foreground text-center py-6">Sem atividade recente.</div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </section>

      {/* CLIENTES */}
      <section>
        <SectionTitle icon={Building2} title="Clientes POSION" subtitle="Contagem de clínicas — dados operacionais ficam em cada tenant" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KPI icon={Building2} label="Clínicas ativas" value={String(activeTenants)} sub={`${tenants.length} totais`} />
          <KPI icon={FileText} label="Contratos SaaS ativos" value={String(saasContracts.filter((s) => s.status === "active").length)} />
          <KPI icon={Sparkles} label="MRR total" value={fmt(agency.mrr)} />
        </div>
        <div className="pt-3">
          <Link to="/admin/tenants" className="text-xs text-amber-400 hover:underline inline-flex items-center gap-1">
            Ver todas as clínicas <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function KPI({ icon: Icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <div data-no-float className="premium-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.18em] text-amber-400/70 font-mono">{label}</span>
        <div className="w-7 h-7 rounded-lg premium-section-icon flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-amber-300" />
        </div>
      </div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

/** Sparkline dourado, monocromático, minimalista */
function Sparkline({ data, width = 92, height = 32 }: { data: number[]; width?: number; height?: number }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : width;
  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const gradId = `spark-gold-${Math.random().toString(36).slice(2, 8)}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="hsl(44 75% 68%)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="hsl(44 75% 68%)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradId})`} />
      <polyline
        points={points}
        fill="none"
        stroke="hsl(44 75% 60%)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DeltaBadge({ current, previous, isPercent = false }: { current: number; previous: number; isPercent?: boolean }) {
  let delta = 0;
  if (isPercent) {
    delta = current - previous;
  } else {
    delta = previous > 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0);
  }
  const rounded = Math.abs(delta) < 0.05 ? 0 : delta;
  const Icon = rounded > 0 ? ArrowUp : rounded < 0 ? ArrowDown : Minus;
  const color = rounded > 0 ? "text-emerald-400" : rounded < 0 ? "text-rose-400" : "text-muted-foreground";
  const sign = rounded > 0 ? "+" : "";
  const label = isPercent
    ? `${sign}${rounded.toFixed(1)} pp`
    : `${sign}${rounded.toFixed(0)}%`;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-mono ${color}`}>
      <Icon className="w-3 h-3" />
      {label}
      <span className="text-muted-foreground/70">vs. período anterior</span>
    </span>
  );
}

function MetricCard({
  label, value, current, previous, series, href,
}: {
  label: string; value: string; current: number; previous: number; series: number[]; href?: string;
}) {
  const isPercent = label.toLowerCase().includes("conversão");
  const inner = (
    <div data-no-float className="premium-card rounded-xl p-4 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-amber-400/80 font-mono">{label}</div>
          {href && <ArrowUpRight className="w-3.5 h-3.5 text-amber-400/60" />}
        </div>
        <div className="text-2xl font-bold text-foreground mt-0.5 tabular-nums">{value}</div>
        <div className="mt-1">
          <DeltaBadge current={current} previous={previous} isPercent={isPercent} />
        </div>
      </div>
      <div className="shrink-0">
        <Sparkline data={series} />
      </div>
    </div>
  );
  return href ? <Link to={href}>{inner}</Link> : inner;
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: any; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="w-9 h-9 rounded-lg premium-section-icon flex items-center justify-center">
        <Icon className="w-4 h-4 text-amber-300" />
      </div>
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}
