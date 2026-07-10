import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, TrendingUp, TrendingDown, DollarSign, ShoppingBag, Receipt, Target, Trophy, Users, Globe, AlertTriangle, CheckCircle2, Filter, LineChart as LineIcon, Activity, Medal, Bell, Info, XCircle, PartyPopper, MessageCircle } from "lucide-react";
import { Link } from "react-router-dom";
import { SaleRow, BRL, PCT, summarize, groupSum, evaluationFunnel, weeklyBreakdown, categorize, isInternational, isEvaluation } from "@/lib/clinic-kpis";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ReferenceLine, Cell,
  FunnelChart, Funnel, LabelList,
} from "recharts";
import { format as fmtD, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Search, GitBranch, Building2, Sparkles, ArrowUpRight } from "lucide-react";
import { DateRangePicker, makeRange, type DateRangeValue } from "@/components/shared/DateRangePicker";
import { differenceInDays, startOfDay, endOfDay, subDays, format as fmtDate } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import LeadDetailModal from "@/components/admin/LeadDetailModal";
import type { Lead as AdminLead } from "@/types/admin";
import { computeFunnelMetrics, type FunnelAppointment } from "@/lib/funnel-metrics";

interface Goal { year: number; month: number; goal_1: number; goal_2: number; goal_3: number; }
interface LeadRow { id: string; stage: string | null; created_at: string; name: string | null; phone: string | null; mql: boolean | null; sql_qualified: boolean | null; }

const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

// Funil padronizado POSION — 8 etapas fixas
const FUNNEL_ORDER = ["lead","qualificado","reuniao_agendada","compareceu","negociacao","ganho"] as const;
const FUNNEL_LABELS: Record<string,string> = {
  lead: "Lead", qualificado: "Qualificado", reuniao_agendada: "R. Agendada",
  compareceu: "Compareceu", negociacao: "Negociação", ganho: "Ganho",
  perdido: "Perdido", no_show: "No-show",
};
const FUNNEL_COLORS = ["rgba(245,245,245,0.55)", "rgba(245,245,245,0.65)", "rgba(245,245,245,0.75)", "rgba(245,245,245,0.85)", "#E8C468", "#4ADE80"];

const FUNNEL_DEFINITIONS: Record<string, { definition: string; formula: string }> = {
  qualificacao:   { definition: "Leads que preencheram os critérios mínimos (ex.: dados válidos) e foram aceitos como oportunidade.", formula: "Qualificados ÷ Leads" },
  agendamento:    { definition: "Leads qualificados que marcaram uma reunião ou consulta com sucesso.", formula: "Agendados ÷ Qualificados" },
  comparecimento: { definition: "Reuniões agendadas em que o lead realmente compareceu.", formula: "Compareceu ÷ (Compareceu + No-show)" },
  fechamento:     { definition: "Leads que compareceram e efetivamente fecharam a venda.", formula: "Ganho ÷ Compareceu" },
  noShow:         { definition: "Agendamentos em que o lead faltou sem aviso prévio. Comparecimento + No-show sempre somam 100% dos agendamentos decididos.", formula: "No-show ÷ (Compareceu + No-show)" },
  geral:          { definition: "Percentual de leads que viraram venda no período — visão geral do funil.", formula: "Ganho ÷ Leads" },
};

export default function TenantDashboard() {
  const { tenant } = useTenant();
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [appointments, setAppointments] = useState<FunnelAppointment[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [waStatus, setWaStatus] = useState<{ connected: boolean; label: string } | null>(null);
  const now = new Date();
  const [range, setRange] = useState<DateRangeValue>(() => makeRange(30));
  const year = range.to.getFullYear();
  const month = range.to.getMonth() + 1;
  const periodDays = Math.max(1, differenceInDays(range.to, range.from) + 1);
  const inRange = (dateStr: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr.length === 10 ? dateStr + "T12:00:00" : dateStr);
    return d >= range.from && d <= range.to;
  };

  // Investimento mensal (armazenado localmente por tenant+ano-mês)
  const invKey = tenant ? `posion:invest:${tenant.id}:${year}-${month}` : "";
  const [investment, setInvestment] = useState<number>(0);
  useEffect(() => {
    if (!invKey) return;
    const v = Number(localStorage.getItem(invKey) || 0);
    setInvestment(isFinite(v) ? v : 0);
  }, [invKey]);
  const saveInvestment = (v: number) => {
    setInvestment(v);
    if (invKey) localStorage.setItem(invKey, String(v));
  };

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    Promise.all([
      supabase.from("sales").select("*").eq("tenant_id", tenant.id).order("sale_date", { ascending: true }),
      supabase.from("monthly_goals").select("*").eq("tenant_id", tenant.id),
      supabase.from("leads").select("id,status,created_at,name,phone").eq("tenant_id", tenant.id),
      supabase.from("whatsapp_connections").select("status,instance_name").eq("tenant_id", tenant.id).maybeSingle(),
    ]).then(([s, g, l, wa]) => {
      setSales((s.data || []) as SaleRow[]);
      setGoals((g.data || []) as Goal[]);
      setLeads(((l.data || []) as any[]).map(r => ({ id: r.id, stage: r.status, created_at: r.created_at, name: r.name, phone: r.phone })) as LeadRow[]);
      const w: any = wa.data;
      if (w) {
        const connected = ["open", "connected", "CONNECTED"].includes(String(w.status || "").toLowerCase()) || w.status === "open";
        setWaStatus({ connected, label: w.status ? `${w.instance_name || "instância"} · ${w.status}` : "Sem status" });
      } else {
        setWaStatus({ connected: false, label: "Nenhuma instância configurada" });
      }
      setLoading(false);
    });
  }, [tenant]);

  const monthSales = useMemo(() =>
    sales.filter((s) => inRange(s.sale_date)), [sales, range]);

  const prevSales = useMemo(() => {
    const prevTo = subDays(range.from, 1);
    const prevFrom = subDays(prevTo, periodDays - 1);
    return sales.filter((s) => {
      const d = new Date((s.sale_date || "") + "T12:00:00");
      return d >= startOfDay(prevFrom) && d <= endOfDay(prevTo);
    });
  }, [sales, range, periodDays]);

  const trimester = useMemo(() => {
    const months = [-2, -1, 0].map((off) => {
      let m = month + off, y = year;
      while (m <= 0) { m += 12; y -= 1; }
      const rows = sales.filter((s) => { const d = new Date(s.sale_date + "T00:00:00"); return d.getFullYear() === y && d.getMonth() + 1 === m; });
      const { total, count, avg } = summarize(rows);
      return { y, m, label: MONTHS[m - 1], total, count, avg };
    });
    return months;
  }, [sales, year, month]);

  const goal = goals.find((g) => g.year === year && g.month === month);
  const { total, count, avg, maxSale } = summarize(monthSales);
  const prev = summarize(prevSales);
  const varTotal = prev.total ? (total - prev.total) / prev.total : 0;
  const varCount = prev.count ? (count - prev.count) / prev.count : 0;
  const varTicket = prev.avg ? (avg - prev.avg) / prev.avg : 0;

  const byChannel = useMemo(() => groupSum(monthSales, (r) => r.channel || "—", (r) => Number(r.amount)), [monthSales]);
  const bySeller = useMemo(() => groupSum(monthSales, (r) => r.seller_name || "—", (r) => Number(r.amount)), [monthSales]);
  const byCategory = useMemo(() => groupSum(monthSales, (r) => categorize(r), (r) => Number(r.amount)), [monthSales]);
  const funnel = useMemo(() => evaluationFunnel(monthSales), [monthSales]);
  const weeks = useMemo(() => weeklyBreakdown(monthSales), [monthSales]);
  const intl = useMemo(() => monthSales.filter(isInternational), [monthSales]);
  const intlTotal = intl.reduce((s, r) => s + Number(r.amount), 0);

  // Funil padronizado (8 etapas) — cumulativo por etapa alcançada
  const stageIndex = (s: string | null) => {
    const i = FUNNEL_ORDER.indexOf(s as any);
    if (i >= 0) return i;
    // perdido/no_show entram como "alcançou até onde estavam antes"
    // sem contagem cumulativa; contabilizados como conversão negativa separadamente
    return -1;
  };
  // Período específico do painel de conversão (independente do range global)
  const [funnelPeriod, setFunnelPeriod] = useState<"global" | "7" | "30" | "90">("global");
  const funnelRange = useMemo(() => {
    if (funnelPeriod === "global") return { from: range.from, to: range.to };
    const days = Number(funnelPeriod);
    const to = endOfDay(new Date());
    const from = startOfDay(subDays(to, days - 1));
    return { from, to };
  }, [funnelPeriod, range]);
  const funnelPrevRange = useMemo(() => {
    const days = Math.max(1, differenceInDays(funnelRange.to, funnelRange.from) + 1);
    const prevTo = endOfDay(subDays(funnelRange.from, 1));
    const prevFrom = startOfDay(subDays(prevTo, days - 1));
    return { from: prevFrom, to: prevTo };
  }, [funnelRange]);

  const computeFunnel = (from: Date, to: Date) => {
    const periodLeads = leads.filter((l) => {
      if (!l.created_at) return false;
      const d = new Date(l.created_at.length === 10 ? l.created_at + "T12:00:00" : l.created_at);
      return d >= from && d <= to;
    });
    const counts: Record<string, number> = {};
    FUNNEL_ORDER.forEach((s) => (counts[s] = 0));
    let noShowCount = 0, perdidoCount = 0;
    const bump = (uptoIdx: number) => { for (let i = 0; i <= uptoIdx; i++) counts[FUNNEL_ORDER[i]]++; };
    for (const l of periodLeads) {
      if (l.stage === "no_show") { noShowCount++; bump(FUNNEL_ORDER.indexOf("reuniao_agendada")); continue; }
      if (l.stage === "perdido") { perdidoCount++; bump(0); continue; }
      const idx = stageIndex(l.stage);
      if (idx >= 0) bump(idx); else bump(0);
    }
    const top = counts[FUNNEL_ORDER[0]] || 1;
    const chart = FUNNEL_ORDER.map((stage, i) => ({
      stage: FUNNEL_LABELS[stage], stageKey: stage, value: counts[stage],
      pct: counts[stage] / top, color: FUNNEL_COLORS[i],
    }));
    const totalLeads = counts.lead || 0;
    const qualificados = counts.qualificado || 0;
    const agendados = counts.reuniao_agendada || 0;
    const compareceram = counts.compareceu || 0;
    const ganhos = counts.ganho || 0;
    const decididos = compareceram + noShowCount;
    const rates = {
      qualificacao:  totalLeads   ? qualificados / totalLeads    : 0,
      agendamento:   qualificados ? agendados    / qualificados  : 0,
      comparecimento: decididos   ? compareceram / decididos     : 0,
      fechamento:    compareceram ? ganhos       / compareceram  : 0,
      noShow:        decididos    ? noShowCount  / decididos     : 0,
      geral:         totalLeads   ? ganhos       / totalLeads    : 0,
      totals: { totalLeads, qualificados, agendados, compareceram, ganhos, noShowCount, perdidoCount, decididos },
    };
    return { chart, rates };
  };

  const funnelData = useMemo(() => computeFunnel(funnelRange.from, funnelRange.to), [leads, funnelRange]);
  const funnelPrev = useMemo(() => computeFunnel(funnelPrevRange.from, funnelPrevRange.to), [leads, funnelPrevRange]);

  const funnelChart = funnelData.chart;
  const funnelRates = funnelData.rates;
  const funnelPrevRates = funnelPrev.rates;

  // Evolução por dia dentro do range (cap 90 dias para performance visual)
  const evolution30 = useMemo(() => {
    const days = Math.min(periodDays, 90);
    const end = range.to;
    const data: { date: string; label: string; total: number; count: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(end);
      d.setDate(end.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const rows = sales.filter((s) => s.sale_date === key);
      data.push({
        date: key,
        label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
        total: rows.reduce((a, r) => a + Number(r.amount || 0), 0),
        count: rows.length,
      });
    }
    return data;
  }, [sales, range, periodDays]);

  const avgDaily = evolution30.length ? evolution30.reduce((a, r) => a + r.total, 0) / evolution30.length : 0;

  // ROI vs Investimento
  const roi = investment > 0 ? (total - investment) / investment : 0;
  const cac = count > 0 && investment > 0 ? investment / count : 0;
  const monthLeadsCount = useMemo(
    () => leads.filter((l) => inRange(l.created_at)).length,
    [leads, range]
  );
  const cpl = monthLeadsCount > 0 && investment > 0 ? investment / monthLeadsCount : 0;

  // Períodos com dados (mantido para labels do trimestre)
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    sales.forEach((s) => { const d = new Date(s.sale_date + "T00:00:00"); set.add(`${d.getFullYear()}-${d.getMonth() + 1}`); });
    return Array.from(set).sort().reverse().map((k) => { const [y, m] = k.split("-").map(Number); return { y, m }; });
  }, [sales]);


  const prevMonthLabel = MONTHS[(month === 1 ? 12 : month - 1) - 1].toLowerCase();

  // Sparkline data — últimos 14 dias
  const sparkRev = useMemo(() => evolution30.slice(-14).map((d) => ({ v: d.total })), [evolution30]);
  const sparkCount = useMemo(() => evolution30.slice(-14).map((d) => ({ v: d.count })), [evolution30]);
  const sparkTicket = useMemo(() => evolution30.slice(-14).map((d) => ({ v: d.count > 0 ? d.total / d.count : 0 })), [evolution30]);

  // Leads por dia (últimos 30)
  const leadsPerDay = useMemo(() => {
    const map: Record<string, number> = {};
    leads.forEach((l) => { const k = l.created_at.slice(0, 10); map[k] = (map[k] || 0) + 1; });
    return evolution30.map((d) => ({ date: d.date, count: map[d.date] || 0 }));
  }, [leads, evolution30]);

  // Ranking da equipe
  const ranking = useMemo(() => {
    const map = new Map<string, { seller: string; count: number; total: number; ganhos: number; perdas: number }>();
    monthSales.forEach((s) => {
      const k = s.seller_name || "—";
      const r = map.get(k) || { seller: k, count: 0, total: 0, ganhos: 0, perdas: 0 };
      r.count += 1; r.total += Number(s.amount || 0); r.ganhos += 1;
      map.set(k, r);
    });
    return Array.from(map.values()).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [monthSales]);

  // Alertas inteligentes
  const alerts = useMemo(() => {
    const arr: { level: "success" | "warning" | "danger" | "info"; msg: string }[] = [];
    // Meta atingida
    if (goal) {
      if (goal.goal_3 && total >= goal.goal_3) arr.push({ level: "success", msg: `Meta 3 atingida! Faturamento acima de ${BRL(goal.goal_3)}.` });
      else if (goal.goal_2 && total >= goal.goal_2) arr.push({ level: "success", msg: `Meta 2 atingida! Faltam ${BRL(Math.max(0, goal.goal_3 - total))} para a Meta 3.` });
      else if (goal.goal_1 && total >= goal.goal_1) arr.push({ level: "success", msg: `Meta 1 atingida! Faltam ${BRL(Math.max(0, goal.goal_2 - total))} para a Meta 2.` });
    }
    // No-show alto
    if (funnelData.rates.noShow > 0.2 && funnelData.rates.totals.agendados >= 3) {
      arr.push({ level: "warning", msg: `Taxa de no-show em ${PCT(funnelData.rates.noShow)} este período — acima do benchmark (20%).` });
    }
    // Zero leads em 3 dias
    const last3 = leadsPerDay.slice(-3);
    if (last3.length === 3 && last3.every((d) => d.count === 0)) {
      arr.push({ level: "danger", msg: "Nenhum lead capturado nos últimos 3 dias — verificar campanhas de tráfego." });
    }
    // Win rate baixo
    if (funnelData.rates.totals.compareceram >= 5 && funnelData.rates.fechamento < 0.2) {
      arr.push({ level: "warning", msg: `Taxa de fechamento em ${PCT(funnelData.rates.fechamento)} — considere revisar o script de venda.` });
    }
    // Sem vendas na semana
    const last7 = evolution30.slice(-7).reduce((s, d) => s + d.total, 0);
    if (last7 === 0 && monthSales.length > 0) {
      arr.push({ level: "warning", msg: "Sem vendas registradas nos últimos 7 dias." });
    }
    return arr;
  }, [goal, total, funnelData, leadsPerDay, evolution30, monthSales]);

  // ============ ADMIN MASTER STYLE — SEÇÕES EXTRAS =============
  // Timeline de receita diária (para HERO)
  const heroTimeline = useMemo(() => evolution30.map((d) => ({ day: d.label, receita: d.total })), [evolution30]);

  // ROI mensal (últimos 6 meses) — investimento por mês vem do localStorage
  const roiMonthly = useMemo(() => {
    const map = new Map<string, { invest: number; receita: number }>();
    sales.forEach((s) => {
      const k = fmtD(startOfMonth(new Date(s.sale_date + "T12:00:00")), "yyyy-MM");
      const cur = map.get(k) || { invest: 0, receita: 0 };
      cur.receita += Number(s.amount || 0);
      map.set(k, cur);
    });
    // aplicar investimentos armazenados por mês
    if (tenant) {
      Array.from(map.keys()).forEach((k) => {
        const [y, m] = k.split("-").map(Number);
        const v = Number(localStorage.getItem(`posion:invest:${tenant.id}:${y}-${m}`) || 0);
        const cur = map.get(k)!;
        cur.invest = isFinite(v) ? v : 0;
      });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([k, v]) => ({
        month: fmtD(new Date(k + "-01T12:00:00"), "MMM/yy", { locale: ptBR }),
        invest: v.invest,
        receita: v.receita,
        lucro: Math.max(v.receita - v.invest, 0),
      }));
  }, [sales, tenant, investment]);

  // Funil recharts (usa funnelChart existente)
  const funnelChartData = useMemo(
    () => funnelChart.map((s, i) => ({ ...s, name: s.stage, fill: FUNNEL_COLORS[i % FUNNEL_COLORS.length] })),
    [funnelChart]
  );

  const [sellerSearch, setSellerSearch] = useState("");



  const [drill, setDrill] = useState<{ key: string; label: string } | null>(null);
  const [openLead, setOpenLead] = useState<AdminLead | null>(null);

  // Numerator stages for each conversion metric — leads counted in the numerator
  const STAGE_SETS: Record<string, string[]> = {
    qualificacao:   ["qualificado","reuniao_agendada","compareceu","negociacao","ganho","no_show"],
    agendamento:    ["reuniao_agendada","compareceu","negociacao","ganho","no_show"],
    comparecimento: ["compareceu","negociacao","ganho"],
    fechamento:     ["ganho"],
    noShow:         ["no_show"],
    geral:          ["ganho"],
  };
  const drillLeads = useMemo(() => {
    if (!drill) return [];
    const allowed = new Set(STAGE_SETS[drill.key] || []);
    return leads
      .filter((l) => inRange(l.created_at) && l.stage && allowed.has(l.stage))
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }, [drill, leads, range]);

  return (
    <div className="p-3 sm:p-4 md:p-8 space-y-4 sm:space-y-6 max-w-[1600px] mx-auto">
      {/* Header — mirrors Admin Master style */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-amber-400/80 mb-1 font-mono">POSION · Central da Clínica</div>
          <h1 className="text-3xl font-bold">Dashboard {tenant?.name}</h1>
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <span>Faturamento, funil e vendas · <span className="text-amber-400">{range.label}</span></span>
            {waStatus && (
              <Link
                to={`/app/${tenant?.slug}/whatsapp`}
                title={`WhatsApp: ${waStatus.label}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border transition"
                style={waStatus.connected
                  ? { color: "#4ADE80", background: "rgba(74,222,128,0.10)", borderColor: "rgba(74,222,128,0.35)" }
                  : { color: "#F87171", background: "rgba(248,113,113,0.10)", borderColor: "rgba(248,113,113,0.35)" }}
              >
                <MessageCircle className="w-3 h-3" />
                {waStatus.connected ? "WhatsApp conectado" : "WhatsApp offline"}
              </Link>
            )}
          </p>
        </div>
        <DateRangePicker value={range} onChange={setRange} />
      </div>

      {/* HERO — Faturamento total + gráfico + KPIs à direita (padrão Admin Master) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 items-start">
        <div data-no-float className="premium-hero lg:col-span-2 rounded-2xl p-4 sm:p-6 h-auto flex flex-col">

          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-amber-400/80 mb-2 font-mono">Faturamento do período</div>
              <div className="text-2xl sm:text-3xl md:text-4xl font-bold text-white tracking-tight break-words">{BRL(total)}</div>

              <div className="text-sm mt-1 text-muted-foreground">
                {count} vendas · Ticket médio {BRL(avg)}
                {Number.isFinite(varTotal) && (
                  <span className={`ml-2 ${varTotal >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                    {varTotal >= 0 ? "+" : ""}{(varTotal * 100).toFixed(1)}% vs período anterior
                  </span>
                )}
              </div>
            </div>
            <div className="w-11 h-11 sm:w-14 sm:h-14 rounded-2xl premium-section-icon flex items-center justify-center shrink-0">
              <DollarSign className="w-6 h-6 sm:w-7 sm:h-7 text-amber-300" />
            </div>

          </div>

          {/* Progresso da meta mensal (se houver) */}
          {goal && (goal.goal_1 || goal.goal_2 || goal.goal_3) ? (
            <div className="mt-4">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="flex items-center gap-2 text-muted-foreground">
                  <Target className="w-3 h-3 text-amber-400" />
                  Meta mensal · {BRL(goal.goal_3 || goal.goal_2 || goal.goal_1 || 0)}
                </span>
                <span className="text-amber-300 font-semibold tabular-nums">
                  {Math.min(100, (total / (goal.goal_3 || goal.goal_2 || goal.goal_1 || 1)) * 100).toFixed(1)}% atingido
                </span>
              </div>
              <div className="mt-1.5 h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (total / (goal.goal_3 || goal.goal_2 || goal.goal_1 || 1)) * 100)}%`,
                    background: "linear-gradient(90deg, #E8C468, #B8860B)",
                  }}
                />
              </div>
            </div>
          ) : null}

          <div className="h-[280px] mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={heroTimeline} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
                <defs>
                  <linearGradient id="tenantHeroArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#E8C468" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#E8C468" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#71717A" }} stroke="rgba(255,255,255,0.08)" />
                <YAxis tick={{ fontSize: 10, fill: "#71717A" }} stroke="rgba(255,255,255,0.08)" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <RTooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid rgba(232,196,104,0.28)", borderRadius: 8, fontSize: 12, color: "#F5F5F5" }}
                  labelStyle={{ color: "#A1A1AA" }}
                  formatter={(v: any) => BRL(Number(v))}
                />
                <Line
                  type="monotone"
                  dataKey="receita"
                  stroke="#F5F5F5"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: "#E8C468", stroke: "#F5F5F5", strokeWidth: 1 }}
                  fill="url(#tenantHeroArea)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col gap-3 h-full">
          <div className="grid grid-cols-1 gap-3">
            <KpiPremium icon={ShoppingBag} label="Nº de Vendas" value={loading ? null : String(count)} delta={varCount} loading={loading} prevLabel={prevMonthLabel} spark={sparkCount} />
            <KpiPremium icon={Receipt} label="Ticket Médio" value={loading ? null : BRL(avg)} delta={varTicket} loading={loading} prevLabel={prevMonthLabel} spark={sparkTicket} />
            <KpiPremium icon={Trophy} label="Maior Venda" value={loading ? null : BRL(maxSale?.amount ?? 0)} sub={maxSale?.patient_name || "—"} loading={loading} />
          </div>

          {/* Taxas de Conversão do Funil — versão compacta preenche espaço ao lado do gráfico */}
          <TooltipProvider delayDuration={120}>
            <div className="flex-1 flex flex-col rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.06] via-transparent to-transparent p-3 min-h-0">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Filter className="w-3.5 h-3.5 text-primary shrink-0" />
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-primary/90 truncate">Taxas de Conversão do Funil</h3>
                </div>
                <Select value={funnelPeriod} onValueChange={(v) => setFunnelPeriod(v as any)}>
                  <SelectTrigger className="h-6 w-[110px] text-[10px] font-mono bg-card/60 border-border/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="global">Período global</SelectItem>
                    <SelectItem value="7">Últimos 7 dias</SelectItem>
                    <SelectItem value="30">Últimos 30 dias</SelectItem>
                    <SelectItem value="90">Últimos 90 dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-[9px] font-mono text-muted-foreground mb-2">
                {fmtDate(funnelRange.from, "dd/MM/yy")} — {fmtDate(funnelRange.to, "dd/MM/yy")} · vs. {fmtDate(funnelPrevRange.from, "dd/MM/yy")} — {fmtDate(funnelPrevRange.to, "dd/MM/yy")}
              </div>
              <div className="grid grid-cols-3 gap-2 flex-1 auto-rows-fr">
                {[
                  { key: "qualificacao", label: "Qualificação", value: funnelRates.qualificacao, prev: funnelPrevRates.qualificacao, hint: "Qualif. ÷ Leads" },
                  { key: "agendamento", label: "Agendamento", value: funnelRates.agendamento, prev: funnelPrevRates.agendamento, hint: "Agend. ÷ Qualif." },
                  { key: "comparecimento", label: "Comparecim.", value: funnelRates.comparecimento, prev: funnelPrevRates.comparecimento, hint: "Comp. ÷ (Comp.+No-show)" },
                  { key: "fechamento", label: "Fechamento", value: funnelRates.fechamento, prev: funnelPrevRates.fechamento, hint: "Ganho ÷ Comp." },
                  { key: "noShow", label: "No-show", value: funnelRates.noShow, prev: funnelPrevRates.noShow, hint: "No-show ÷ (Comp.+No-show)", invert: true },
                  { key: "geral", label: "Conv. Geral", value: funnelRates.geral, prev: funnelPrevRates.geral, hint: "Ganho ÷ Leads" },
                ].map((k) => {
                  const def = FUNNEL_DEFINITIONS[k.key];
                  const color = k.invert
                    ? (k.value < 0.15 ? "#22C55E" : k.value < 0.3 ? "#F59E0B" : "#EF4444")
                    : (k.value >= 0.3 ? "#22C55E" : k.value >= 0.15 ? "#F59E0B" : "#EF4444");
                  const delta = k.value - k.prev;
                  const hasDelta = k.prev > 0 || k.value > 0;
                  // Para "positivo" em métricas normais: subir é bom. Para no-show (invert): descer é bom.
                  const isGood = k.invert ? delta < 0 : delta > 0;
                  const deltaColor = Math.abs(delta) < 0.001 ? "#71717A" : (isGood ? "#22C55E" : "#EF4444");
                  const DeltaIcon = Math.abs(delta) < 0.001 ? null : (delta > 0 ? TrendingUp : TrendingDown);
                  return (
                    <div
                      key={k.label}
                      role="button"
                      tabIndex={0}
                      onClick={() => setDrill({ key: k.key, label: k.label })}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrill({ key: k.key, label: k.label }); } }}
                      className="rounded-lg border border-border/50 bg-card/40 px-2 py-2 cursor-pointer transition hover:border-primary/60 hover:bg-card/70 focus:outline-none focus:ring-2 focus:ring-primary/40 h-full flex flex-col justify-between gap-1"
                      title="Clique para ver os leads desta etapa no período"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground truncate cursor-help">
                            <span title={k.label}>{k.label}</span>
                            <Info className="w-3 h-3 opacity-60 hover:opacity-100" />
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[240px] bg-[#0a0a0a] border border-primary/30 text-popover-foreground">
                          <div className="space-y-1">
                            <p className="font-semibold text-xs">{k.label}</p>
                            <p className="text-[11px] leading-snug text-muted-foreground">{def.definition}</p>
                            <div className="text-[10px] font-mono text-amber-400 pt-1">Fórmula: {def.formula}</div>
                            <div className="text-[10px] font-mono text-muted-foreground pt-0.5">
                              Período anterior: {PCT(k.prev)}
                            </div>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                      <div className="flex items-baseline gap-1.5 mt-0.5">
                        <div className="font-display text-lg num leading-tight" style={{ color }}>{PCT(k.value)}</div>
                        {hasDelta && DeltaIcon && (
                          <span className="flex items-center gap-0.5 text-[9px] font-mono tabular-nums" style={{ color: deltaColor }}>
                            <DeltaIcon className="w-2.5 h-2.5" />
                            {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}pp
                          </span>
                        )}
                      </div>
                      <div className="text-[9px] text-muted-foreground truncate" title={k.hint}>{k.hint}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </TooltipProvider>
        </div>

      </div>

      {/* Alertas Inteligentes */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((a, i) => {
            const cfg = {
              success: { bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.3)", color: "#22C55E", Icon: PartyPopper },
              warning: { bg: "rgba(234,179,8,0.08)", border: "rgba(234,179,8,0.3)", color: "#EAB308", Icon: AlertTriangle },
              danger:  { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.3)", color: "#EF4444", Icon: XCircle },
              info:    { bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.3)", color: "#3B82F6", Icon: Info },
            }[a.level];
            const Icon = cfg.Icon;
            return (
              <div key={i} className="flex items-center gap-3 rounded-lg px-4 py-2.5" style={{ background: cfg.bg, border: `1px solid ${cfg.border}` }}>
                <Icon className="w-4 h-4 shrink-0" style={{ color: cfg.color }} />
                <span className="text-sm" style={{ color: cfg.color }}>{a.msg}</span>
              </div>
            );
          })}
        </div>
      )}


      {/* Métricas da Clínica — cards de destaque */}
      <section>
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Activity className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Métricas da Clínica</h2>
            <p className="text-xs text-muted-foreground">Comparecimento, faturamento e ticket médio · {range.label}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-emerald-400/80 mb-2">Comparecimentos</div>
                <div className="text-2xl sm:text-3xl md:text-4xl font-bold">{funnelRates.totals.compareceram}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {funnelRates.totals.agendados} agendados · {PCT(funnelRates.comparecimento)} de presença
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              </div>
            </div>
            <div className="mt-3 h-1.5 bg-muted/40 rounded-full overflow-hidden">
              <div className="h-full bg-emerald-400" style={{ width: `${Math.min(100, funnelRates.comparecimento * 100)}%` }} />
            </div>
          </div>

          <div className="rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80 mb-2">Faturamento</div>
                <div className="text-2xl sm:text-3xl md:text-4xl font-bold">{BRL(total)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {count} vendas {typeof varTotal === "number" && Number.isFinite(varTotal) && (
                    <span className={varTotal >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      · {varTotal >= 0 ? "+" : ""}{(varTotal * 100).toFixed(1)}% vs período anterior
                    </span>
                  )}
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center">
                <DollarSign className="w-6 h-6 text-primary" />
              </div>
            </div>
            <div className="mt-3 h-12">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkRev}>
                  <defs>
                    <linearGradient id="cardRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#cardRev)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-2xl border border-violet-500/30 bg-gradient-to-br from-violet-500/10 via-violet-500/5 to-transparent p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.22em] text-violet-400/80 mb-2">Ticket Médio</div>
                <div className="text-2xl sm:text-3xl md:text-4xl font-bold">{BRL(avg)}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Maior venda {BRL(maxSale?.amount ?? 0)}
                  {maxSale?.patient_name ? ` · ${maxSale.patient_name}` : ""}
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-violet-500/20 border border-violet-500/40 flex items-center justify-center">
                <Receipt className="w-6 h-6 text-violet-400" />
              </div>
            </div>
            <div className="mt-3 h-12">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={sparkTicket}>
                  <defs>
                    <linearGradient id="cardTicket" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#A78BFA" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#A78BFA" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="v" stroke="#A78BFA" strokeWidth={2} fill="url(#cardTicket)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </section>




      {/* Goals */}
      {goal && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Target className="w-4 h-4 text-primary" /> Atingimento de Metas</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-3 gap-4">
            {([
              { label: "Meta 1", value: goal.goal_1 },
              { label: "Meta 2", value: goal.goal_2 },
              { label: "Meta 3", value: goal.goal_3 },
            ] as const).map((g) => {
              const pct = g.value ? total / g.value : 0;
              const reached = total >= g.value;
              return (
                <div key={g.label} className="card-luxe p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium tracking-tight">{g.label} <span className="text-muted-foreground num">· {BRL(g.value)}</span></span>
                    {reached
                      ? <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/30">✓ Atingida</Badge>
                      : <Badge variant="outline" className="num">{PCT(pct)}</Badge>}
                  </div>
                  <Progress value={Math.min(100, pct * 100)} className="h-1.5" />
                  <div className="text-xs text-muted-foreground num">
                    {reached ? `+${BRL(total - g.value)} acima` : `Faltam ${BRL(g.value - total)}`}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Trimester — só aparece se houver ao menos 1 mês com venda */}
      {trimester.some((t) => t.total > 0) && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Evolução Trimestral</CardTitle></CardHeader>
          <CardContent className="grid md:grid-cols-3 gap-4">
            {trimester.map((t, i) => {
              const isCurrent = i === 2;
              return (
                <div key={`${t.y}-${t.m}`} className={`card-luxe p-4 ${isCurrent ? "card-luxe-accent" : ""}`}>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{t.label}/{t.y}</div>
                  <div className="font-display text-2xl num mt-1 leading-none">{BRL(t.total)}</div>
                  <div className="text-[11px] text-muted-foreground mt-1 num">{t.count} vendas · {BRL(t.avg)} ticket</div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* 30-day Evolution */}
      <Card>
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> Evolução — {range.label}</CardTitle>
          <span className="text-xs text-muted-foreground num">Média diária: <span className="text-foreground font-medium">{BRL(avgDaily)}</span></span>
        </CardHeader>
        <CardContent>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={evolution30} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94A3B8" }} interval={3} />
                <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
                <RTooltip
                  contentStyle={{ background: "rgba(10,17,36,0.95)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 10, fontSize: 12 }}
                  labelStyle={{ color: "#D4AF37", fontWeight: 600 }}
                  formatter={(v: any, n: string) => n === "total" ? [BRL(Number(v)), "Faturamento"] : [v, "Vendas"]}
                />
                <ReferenceLine y={avgDaily} stroke="#94A3B8" strokeDasharray="4 4" label={{ value: "média", fill: "#94A3B8", fontSize: 10, position: "right" }} />
                <Area type="monotone" dataKey="total" stroke="#D4AF37" strokeWidth={2} fill="url(#gradRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Taxas de conversão do funil padronizado */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4 text-primary" /> Taxas de Conversão do Funil
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: "Qualificação",   value: funnelRates.qualificacao,   hint: "Qualif. ÷ Leads" },
              { label: "Agendamento",    value: funnelRates.agendamento,    hint: "Agend. ÷ Qualif." },
              { label: "Comparecimento", value: funnelRates.comparecimento, hint: "Comp. ÷ (Comp.+No-show)" },
              { label: "Fechamento",     value: funnelRates.fechamento,     hint: "Ganho ÷ Comp." },
              { label: "No-show",        value: funnelRates.noShow,         hint: "No-show ÷ (Comp.+No-show)", invert: true },
              { label: "Conversão Geral",value: funnelRates.geral,          hint: "Ganho ÷ Leads" },
            ].map((k) => {
              const good = k.invert ? k.value < 0.15 : k.value >= 0.3;
              const color = k.invert
                ? (k.value < 0.15 ? "#22C55E" : k.value < 0.3 ? "#F59E0B" : "#EF4444")
                : (k.value >= 0.3 ? "#22C55E" : k.value >= 0.15 ? "#F59E0B" : "#EF4444");
              return (
                <div key={k.label} className="rounded-lg border border-border/50 bg-card/40 p-3">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{k.label}</div>
                  <div className="font-display text-2xl num leading-none mt-1" style={{ color }}>{PCT(k.value)}</div>
                  <div className="text-[10px] text-muted-foreground mt-1">{k.hint}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Funil do Kanban + ROI */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Filter className="w-4 h-4 text-primary" /> Funil de Conversão (Kanban)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funnelChart} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 0 }}>
                  <CartesianGrid horizontal={false} stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                  <YAxis type="category" dataKey="stage" tick={{ fontSize: 11, fill: "#CBD5E1" }} width={140} />
                  <RTooltip
                    contentStyle={{ background: "rgba(10,17,36,0.95)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 10, fontSize: 12 }}
                    formatter={(v: any, _n, p: any) => [`${v} leads (${PCT(p.payload.pct)})`, p.payload.stage]}
                  />
                  <Bar dataKey="value" radius={[0, 8, 8, 0]}>
                    {funnelChart.map((d, i) => <Cell key={i} fill={d.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3 pt-3 border-t border-border/40">
              {funnelChart.map((d) => (
                <div key={d.stage} className="text-center">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate" title={d.stage}>{d.stage}</div>
                  <div className="font-display text-lg num leading-none mt-1" style={{ color: d.color }}>{d.value}</div>
                  <div className="text-[10px] text-muted-foreground num">{PCT(d.pct)}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><LineIcon className="w-4 h-4 text-primary" /> ROI vs Investimento</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Investimento em tráfego (mês)</label>
                <Input
                  type="number"
                  min={0}
                  value={investment || ""}
                  onChange={(e) => saveInvestment(Number(e.target.value) || 0)}
                  placeholder="R$ 0,00"
                  className="mt-1 num"
                />
              </div>
              <div className="text-right">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">ROI</div>
                <div className="font-display text-3xl num leading-none mt-1" style={{ color: roi >= 0 ? "#22C55E" : "#EF4444" }}>
                  {investment > 0 ? `${(roi * 100).toFixed(0)}%` : "—"}
                </div>
              </div>
            </div>
            <div className="h-44 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[
                  { name: "Investido", value: investment, fill: "#EF4444" },
                  { name: "Faturado", value: total, fill: "#22C55E" },
                  { name: "Lucro", value: Math.max(0, total - investment), fill: "#D4AF37" },
                ]} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#94A3B8" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#94A3B8" }} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : `${v}`} />
                  <RTooltip
                    contentStyle={{ background: "rgba(10,17,36,0.95)", border: "1px solid rgba(212,175,55,0.25)", borderRadius: 10, fontSize: 12 }}
                    formatter={(v: any) => [BRL(Number(v)), ""]}
                  />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]}>
                    {[0,1,2].map((i) => <Cell key={i} fill={["#EF4444","#22C55E","#D4AF37"][i]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/40">
              <MiniStat label="CPL" value={cpl > 0 ? BRL(cpl) : "—"} sub={`${monthLeadsCount} leads`} />
              <MiniStat label="CAC" value={cac > 0 ? BRL(cac) : "—"} sub={`${count} vendas`} />
              <MiniStat label="Ticket" value={avg ? BRL(avg) : "—"} sub="médio" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel / Attendance */}
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Users className="w-4 h-4 text-primary" /> Funil de Avaliações</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Avaliações vendidas" value={funnel.sold.toString()} />
              <Stat label="Compareceram" value={funnel.attended.toString()} hint={PCT(funnel.attendanceRate)} good={funnel.attendanceRate >= 0.75} />
              <Stat label="No-show" value={funnel.noShow.toString()} hint={PCT(funnel.noShowRate)} bad={funnel.noShowRate > 0.15} />
              <Stat label="Agendadas (futuras)" value={funnel.future.toString()} />
            </div>
            <div className="p-3 rounded-lg bg-muted/40 border">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Conversão avaliação → procedimento</span>
                <span className="font-semibold">{PCT(funnel.conversionRate)}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">{funnel.converted} de {funnel.evalPatients} pacientes avaliados fecharam outro procedimento.</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Globe className="w-4 h-4 text-primary" /> Segmentação de Público</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Nacional</div>
                <div className="font-display text-2xl num mt-1 leading-none">{BRL(total - intlTotal)}</div>
                <div className="text-[11px] text-muted-foreground mt-1 num">{count - intl.length} vendas</div>
              </div>
              <div className="p-3 rounded-xl bg-primary/5 border border-primary/20">
                <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80">Internacional</div>
                <div className="font-display text-2xl num mt-1 leading-none gold-gradient-text">{BRL(intlTotal)}</div>
                <div className="text-[11px] text-muted-foreground mt-1 num">{intl.length} vendas</div>
              </div>
            </div>
            {intl.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/40 pb-1">Vendas Internacionais</div>
                <div className="space-y-1.5 max-h-48 overflow-auto">
                  {intl.map((s) => (
                    <div key={s.id} className="flex items-center justify-between text-sm">
                      <span className="truncate flex items-center gap-2">{s.patient_name} <CheckCircle2 className="w-3 h-3 text-emerald-400" /></span>
                      <span className="font-medium num">{BRL(Number(s.amount))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {intl.length === 0 && <div className="text-xs text-muted-foreground">Nenhuma venda internacional no período.</div>}
          </CardContent>
        </Card>
      </div>

      {/* By channel / seller */}
      <div className="grid lg:grid-cols-2 gap-4">
        <BreakdownCard title="Receita por Canal" rows={byChannel} total={total} />
        <BreakdownCard title="Receita por Vendedor" rows={bySeller} total={total} />
      </div>

      {/* Categories */}
      <BreakdownCard title="Receita por Categoria de Procedimento" rows={byCategory} total={total} />

      {/* Ranking da equipe */}
      {ranking.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Medal className="w-4 h-4 text-primary" /> Ranking da Equipe — {MONTHS[month - 1]}/{year}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground border-b border-border/40">
                    <th className="text-left py-2 pr-3 font-medium w-10">#</th>
                    <th className="text-left py-2 pr-3 font-medium">Vendedor</th>
                    <th className="text-right py-2 pr-3 font-medium">Vendas</th>
                    <th className="text-right py-2 pr-3 font-medium">Faturamento</th>
                    <th className="text-right py-2 pr-3 font-medium">Ticket Médio</th>
                    <th className="text-right py-2 pr-3 font-medium">% do Total</th>
                  </tr>
                </thead>
                <tbody>
                  {ranking.map((r, i) => {
                    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
                    const ticket = r.count > 0 ? r.total / r.count : 0;
                    const share = total > 0 ? r.total / total : 0;
                    return (
                      <tr key={r.seller} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                        <td className="py-3 pr-3 text-base">{medal}</td>
                        <td className="py-3 pr-3 font-medium truncate max-w-[220px]">{r.seller}</td>
                        <td className="py-3 pr-3 text-right num">{r.count}</td>
                        <td className="py-3 pr-3 text-right num font-semibold">{BRL(r.total)}</td>
                        <td className="py-3 pr-3 text-right num text-muted-foreground">{BRL(ticket)}</td>
                        <td className="py-3 pr-3 text-right num text-muted-foreground">{PCT(share)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Weekly */}
      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Performance Semanal</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {weeks.map((w) => (
              <div key={w.week} className="card-luxe p-3">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Semana {w.week}</div>
                <div className="font-display text-xl num mt-1 leading-none">{BRL(w.total)}</div>
                <div className="text-[11px] text-muted-foreground mt-1 num">{w.count} vendas · {BRL(w.ticket)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ============= SEÇÕES NO PADRÃO ADMIN MASTER ============= */}

      {/* HERO — Receita total + mini timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-[0.22em] text-primary/70 mb-2">Receita no período</div>
              <div className="text-2xl sm:text-3xl md:text-4xl font-bold">{BRL(total)}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {count} vendas · Ticket médio {BRL(avg)} · {range.label}
              </div>
            </div>
            <div className="w-14 h-14 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center">
              <DollarSign className="w-7 h-7 text-primary" />
            </div>
          </div>
          <div className="h-32 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={heroTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={3} />
                <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <RTooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => BRL(Number(v))}
                />
                <Line type="monotone" dataKey="receita" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 flex items-center gap-3">
            <GitBranch className="w-6 h-6 text-cyan-400" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] opacity-80 text-cyan-400">Leads (período)</div>
              <div className="text-2xl font-bold text-foreground">{funnelRates.totals.totalLeads}</div>
            </div>
          </div>
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
            <Trophy className="w-6 h-6 text-emerald-400" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] opacity-80 text-emerald-400">Ganhos</div>
              <div className="text-2xl font-bold text-foreground">{funnelRates.totals.ganhos}</div>
            </div>
          </div>
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 flex items-center gap-3">
            <Target className="w-6 h-6 text-violet-400" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.18em] opacity-80 text-violet-400">Conversão</div>
              <div className="text-2xl font-bold text-foreground">{PCT(funnelRates.geral)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* FUNIL DE CONVERSÃO — recharts FunnelChart estilo admin master */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Target className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Funil de conversão da clínica</h2>
            <p className="text-xs text-muted-foreground">Leads {tenant?.name || ""} no período selecionado</p>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border/60 bg-card/40 p-4">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart>
                  <RTooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any, _n: any, p: any) => [`${v} leads`, p.payload.stage]}
                  />
                  <Funnel dataKey="value" data={funnelChartData} isAnimationActive>
                    <LabelList position="right" dataKey="name" stroke="none" fill="hsl(var(--foreground))" fontSize={11} />
                    <LabelList position="center" dataKey="value" stroke="none" fill="#fff" fontSize={12} fontWeight={700} />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-card/40 p-4">
            <h3 className="text-sm font-semibold mb-3">Taxas entre etapas</h3>
            <div className="overflow-hidden rounded-lg border border-border/40">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="text-left px-3 py-2">Etapa</th><th className="text-right px-3 py-2">Leads</th><th className="text-right px-3 py-2">Conv. vs anterior</th></tr>
                </thead>
                <tbody>
                  {funnelChart.map((s, i) => {
                    const prev = i > 0 ? funnelChart[i - 1].value : 0;
                    const conv = prev > 0 ? (s.value / prev) * 100 : 0;
                    return (
                      <tr key={s.stage} className="odd:bg-transparent even:bg-muted/20 border-t border-border/30">
                        <td className="px-3 py-2 text-foreground">{s.stage}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{s.value}</td>
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

      {/* ROI vs INVESTIMENTO — mensal (últimos 6 meses) */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold">ROI vs investimento</h2>
            <p className="text-xs text-muted-foreground">Receita vs tráfego pago · últimos 6 meses</p>
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-4 h-80">
          {roiMonthly.length === 0 ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Sem dados no período.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={roiMonthly}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <RTooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any) => BRL(Number(v))}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="invest" stackId="a" name="Investimento" fill="#f43f5e" />
                <Bar dataKey="lucro" stackId="a" name="Lucro (Rec-Inv)" fill="#10b981" radius={[6, 6, 0, 0]} />
                <Bar dataKey="receita" name="Receita total" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      {/* TABELA ZEBRA — performance por vendedor */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Performance consolidada por vendedor</h2>
            <p className="text-xs text-muted-foreground">Busca e ranking · ordenado por faturamento</p>
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-card/40 p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Buscar vendedor…"
                value={sellerSearch}
                onChange={(e) => setSellerSearch(e.target.value)}
                className="pl-8 h-9 bg-background/50"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {ranking.filter((r) => r.seller.toLowerCase().includes(sellerSearch.toLowerCase())).length} resultados
            </span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border/40">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Vendedor</th>
                  <th className="text-right px-3 py-2">Vendas</th>
                  <th className="text-right px-3 py-2">Ticket médio</th>
                  <th className="text-right px-3 py-2">Faturamento</th>
                  <th className="text-right px-3 py-2">% do total</th>
                </tr>
              </thead>
              <tbody>
                {ranking
                  .filter((r) => r.seller.toLowerCase().includes(sellerSearch.toLowerCase()))
                  .map((r) => {
                    const ticket = r.count > 0 ? r.total / r.count : 0;
                    const share = total > 0 ? (r.total / total) * 100 : 0;
                    return (
                      <tr key={r.seller} className="odd:bg-transparent even:bg-muted/20 border-t border-border/30 hover:bg-muted/30">
                        <td className="px-3 py-2 text-foreground truncate max-w-[220px]">{r.seller}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.count}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{BRL(ticket)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-primary font-semibold">{BRL(r.total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{share.toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                {ranking.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">Sem vendas no período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Drill-down: leads da etapa selecionada */}
      <Dialog open={!!drill} onOpenChange={(o) => !o && setDrill(null)}>
        <DialogContent className="max-w-2xl bg-[#0a0a0a] border-primary/30">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-primary" />
              Leads — {drill?.label}
            </DialogTitle>
            <DialogDescription>
              {drillLeads.length} lead{drillLeads.length === 1 ? "" : "s"} no período de {fmtDate(range.from, "dd/MM/yyyy")} a {fmtDate(range.to, "dd/MM/yyyy")}.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] pr-2">
            {drillLeads.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Nenhum lead nesta etapa dentro do período selecionado.
              </div>
            ) : (
              <ul className="divide-y divide-border/40">
                {drillLeads.map((l) => (
                  <li key={l.id}>
                    <button
                      onClick={() => setOpenLead({ id: l.id, name: l.name || "Sem nome", phone: l.phone || "" } as unknown as AdminLead)}
                      className="w-full text-left px-2 py-2.5 hover:bg-primary/5 rounded transition flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{l.name || "Sem nome"}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {l.phone || "—"} · Criado em {fmtDate(new Date(l.created_at), "dd/MM/yyyy")}
                        </div>
                      </div>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wider shrink-0">
                        {FUNNEL_LABELS[l.stage || ""] || l.stage}
                      </Badge>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <LeadDetailModal
        lead={openLead}
        open={!!openLead}
        onClose={() => setOpenLead(null)}
        onUpdated={() => {
          // Recarrega leads para refletir mudanças de estágio
          if (tenant) {
            supabase.from("leads").select("id,status,created_at,name,phone").eq("tenant_id", tenant.id).then(({ data }) => {
              setLeads(((data || []) as any[]).map((r) => ({ id: r.id, stage: r.status, created_at: r.created_at, name: r.name, phone: r.phone })));
            });
          }
        }}
      />
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, delta, accent, sub }: any) {
  return (
    <div className={`card-luxe ${accent ? "card-luxe-accent" : ""} p-5 group`}>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/80 font-medium">{label}</div>
        <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
      <div className="font-display text-3xl num leading-none">{value}</div>
      {typeof delta === "number" && (
        <div className={`text-xs mt-3 flex items-center gap-1 num ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
          {delta >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {(delta * 100).toFixed(1)}% <span className="text-muted-foreground ml-0.5 normal-case tracking-normal">vs mês anterior</span>
        </div>
      )}
      {sub && <div className="text-xs text-muted-foreground mt-2 truncate">{sub}</div>}
    </div>
  );
}

function KpiPremium({ icon: Icon, label, value, delta, loading, sub, prevLabel, spark }: { icon: any; label: string; value: string | null; delta?: number; loading?: boolean; sub?: string; prevLabel?: string; spark?: { v: number }[] }) {
  const showSkeleton = loading || value === null;
  const positive = (delta ?? 0) >= 0;
  // Auto-shrink: números longos (ex: "R$ 1.245.000") nunca estouram o card
  const len = (value ?? "").length;
  const fontSize = len <= 8 ? 30 : len <= 12 ? 24 : len <= 16 ? 20 : 17;

  return (
    <div
      data-no-float
      className="premium-card relative p-5 group transition-all overflow-hidden min-w-0 rounded-2xl h-full flex flex-col"
    >
      {/* Top accent line */}
      <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(212,175,55,0.5), transparent)" }} />
      {/* Soft glow blob */}
      <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full opacity-30 pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(212,175,55,0.25) 0%, transparent 70%)" }} />

      <div className="flex items-start justify-between mb-4 relative">
        <div style={{ fontFamily: "Inter, sans-serif", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#94A3B8" }}>
          {label}
        </div>
        <div className="flex items-center justify-center shrink-0"
          style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, rgba(212,175,55,0.18), rgba(212,175,55,0.06))", border: "1px solid rgba(212,175,55,0.25)" }}>
          <Icon className="w-4 h-4" style={{ color: "#D4AF37" }} />
        </div>
      </div>

      {showSkeleton ? (
        <div className="kpi-skeleton" style={{ height: 32, width: "70%", borderRadius: 6 }} />
      ) : (
        <div
          className="num tabular-nums relative"
          title={value ?? undefined}
          style={{
            fontFamily: "Syne, sans-serif",
            fontSize,
            fontWeight: 700,
            color: "#FFFFFF",
            letterSpacing: "-0.025em",
            lineHeight: 1.08,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {value}
        </div>
      )}

      {typeof delta === "number" && !showSkeleton && (
        <div className="mt-3 inline-flex items-center gap-1"
          style={{
            background: positive ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
            color: positive ? "#22C55E" : "#EF4444",
            border: `1px solid ${positive ? "rgba(34,197,94,0.25)" : "rgba(239,68,68,0.25)"}`,
            borderRadius: 100, padding: "3px 9px",
            fontFamily: "Inter, sans-serif", fontSize: 10.5, fontWeight: 600,
          }}
        >
          {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
          {positive ? "+" : ""}{(delta * 100).toFixed(1)}% <span className="opacity-70 ml-0.5 font-normal">vs {prevLabel ?? "anterior"}</span>
        </div>
      )}
      {sub && !showSkeleton && (
        <div className="mt-2 text-[11px] truncate" style={{ color: "#94A3B8" }} title={sub}>{sub}</div>
      )}
      {spark && spark.length > 0 && !showSkeleton && (
        <div className="mt-3 h-8 -mx-1 opacity-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={spark} margin={{ top: 2, right: 2, left: 2, bottom: 0 }}>
              <defs>
                <linearGradient id={`spk-${label}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#D4AF37" stopOpacity={0.5} />
                  <stop offset="100%" stopColor="#D4AF37" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke="#D4AF37" strokeWidth={1.5} fill={`url(#spk-${label})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

function BreakdownCard({ title, rows, total }: { title: string; rows: { name: string; total: number; count: number; ticket: number }[]; total: number }) {
  const max = rows[0]?.total || 1;
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {rows.map((r) => (
          <div key={r.name} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="truncate font-medium">{r.name}</span>
              <span className="text-muted-foreground">{BRL(r.total)} · {r.count}</span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-primary/70 to-primary rounded-full" style={{ width: `${(r.total / max) * 100}%` }} />
            </div>
            <div className="text-xs text-muted-foreground">{total ? PCT(r.total / total) : "—"} · ticket {BRL(r.ticket)}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="text-sm text-muted-foreground">Sem dados.</div>}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="text-center p-2 rounded-lg bg-muted/30 border border-border/40">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-base num leading-none mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, hint, good, bad }: { label: string; value: string; hint?: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="p-3 rounded-xl bg-muted/30 border border-border/60">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="font-display text-2xl num mt-1 leading-none">{value}</div>
      {hint && (
        <div className={`text-xs mt-2 flex items-center gap-1 num ${good ? "text-emerald-400" : bad ? "text-rose-400" : "text-muted-foreground"}`}>
          {good && <CheckCircle2 className="w-3 h-3" />}
          {bad && <AlertTriangle className="w-3 h-3" />}
          {hint}
        </div>
      )}
    </div>
  );
}
