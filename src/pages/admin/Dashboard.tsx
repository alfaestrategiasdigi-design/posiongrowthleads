import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Link } from "react-router-dom";
import { DateRangePicker, makeRange, type DateRangeValue } from "@/components/shared/DateRangePicker";
import {
  Building2, DollarSign, TrendingUp, GitBranch, FileText, Trophy, Sparkles, ArrowUpRight,
  Loader2, Target,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { format, eachDayOfInterval } from "date-fns";
import { ptBR } from "date-fns/locale";

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

  useEffect(() => {
    (async () => {
      setLoading(true);
      // ⚠️ POSION Admin Master dashboard — SOMENTE dados da própria agência.
      // Nenhuma listagem/agregado pode vir de tabelas scoped por tenant
      // (clinic_leads, sales, campaign_spend, etc). Apenas:
      //  - agency_leads: pipeline POSION (prospecção de clínicas)
      //  - agency_contracts com tenant_id IS NULL: contratos fechados pela POSION
      //  - saas_contracts: assinaturas SaaS que a POSION vende
      //  - tenants: metadados de clientes (só para contagem)
      const [l, ac, sc, t] = await Promise.all([
        supabase.from("agency_leads").select("id,stage,valor_proposta,created_at,nome_clinica,plano_interesse,ganho_at,tenant_id_criado"),
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

  const inRange = (iso: string) => {
    const d = new Date(iso);
    return d >= range.from && d <= range.to;
  };

  // ============= AGÊNCIA (POSION) =============
  const agency = useMemo(() => {
    const leadsPeriodo = leads.filter((l) => inRange(l.created_at));
    const emNegociacao = leads.filter((l) => ["proposta", "negociacao"].includes(l.stage));
    const contratosPeriodo = agencyContracts.filter((c) => inRange(c.data_assinatura));

    const receitaAgencia = contratosPeriodo.reduce((s, c) => s + Number(c.valor_total || 0), 0);
    const mrr = saasContracts.filter((s) => s.status === "active").reduce((s, c) => s + Number(c.mrr || 0), 0);

    const stageCount: Record<string, number> = {};
    leads.forEach((l) => { stageCount[l.stage] = (stageCount[l.stage] || 0) + 1; });
    const stageData = Object.entries(stageCount).map(([stage, count]) => ({
      stage: STAGE_LABELS[stage] || stage, count, fill: STAGE_COLORS[stage] || "#888",
    }));

    const convRate = leadsPeriodo.length > 0 ? (contratosPeriodo.length / leadsPeriodo.length) * 100 : 0;
    const pipelineValue = emNegociacao.reduce((s, l) => s + (l.valor_proposta || 0), 0);
    const totalFechamentos = contratosPeriodo.length;
    const ticketMedio = totalFechamentos > 0 ? receitaAgencia / totalFechamentos : 0;

    return {
      leadsPeriodo: leadsPeriodo.length,
      ganhos: contratosPeriodo.length,
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
            Somente vendas e contratos da POSION · <span className="text-primary">{range.label}</span>
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
              {agencyContracts.slice(0, 6).map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border/30 last:border-0">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.cliente_nome}</div>
                    <div className="text-[10px] text-muted-foreground">{format(new Date(c.data_assinatura), "dd/MM/yy")}</div>
                  </div>
                  <span className="text-emerald-500 font-semibold text-xs">{fmt(c.valor_total || 0)}</span>
                </div>
              ))}
              {agencyContracts.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6">Nenhum ganho ainda.</div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* CLIENTES — apenas metadados (contagem), sem dados operacionais dos tenants */}
      <section>
        <SectionTitle icon={Building2} title="Clientes POSION" subtitle="Contagem de clínicas — dados operacionais ficam em cada tenant" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <KPI icon={Building2} label="Clínicas ativas" value={String(activeTenants)} sub={`${tenants.length} totais`} />
          <KPI icon={FileText} label="Contratos SaaS ativos" value={String(saasContracts.filter((s) => s.status === "active").length)} />
          <KPI icon={Sparkles} label="MRR total" value={fmt(agency.mrr)} />
        </div>
        <div className="pt-3">
          <Link to="/admin/tenants" className="text-xs text-primary hover:underline inline-flex items-center gap-1">
            Ver todas as clínicas <ArrowUpRight className="w-3 h-3" />
          </Link>
        </div>
      </section>
    </div>
  );
}

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
