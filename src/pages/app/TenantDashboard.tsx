import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Loader2, TrendingUp, TrendingDown, DollarSign, ShoppingBag, Receipt, Target, Trophy, Users, Globe, AlertTriangle, CheckCircle2, Filter, LineChart as LineIcon, Activity } from "lucide-react";
import { SaleRow, BRL, PCT, summarize, groupSum, evaluationFunnel, weeklyBreakdown, categorize, isInternational, isEvaluation } from "@/lib/clinic-kpis";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend, ReferenceLine, Cell,
} from "recharts";

interface Goal { year: number; month: number; goal_1: number; goal_2: number; goal_3: number; }
interface LeadRow { id: string; stage: string | null; created_at: string; }

const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

const FUNNEL_STAGES = ["Novo", "Qualificado", "Avaliação Agendada", "Compareceu", "Fechado Ganho"] as const;
const FUNNEL_COLORS = ["#60A5FA", "#A78BFA", "#F472B6", "#FBBF24", "#34D399"];

export default function TenantDashboard() {
  const { tenant } = useTenant();
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(5);

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    Promise.all([
      supabase.from("sales").select("*").eq("tenant_id", tenant.id).order("sale_date", { ascending: true }),
      supabase.from("monthly_goals").select("*").eq("tenant_id", tenant.id),
    ]).then(([s, g]) => {
      setSales((s.data || []) as SaleRow[]);
      setGoals((g.data || []) as Goal[]);
      setLoading(false);
    });
  }, [tenant]);

  const monthSales = useMemo(() =>
    sales.filter((s) => {
      const d = new Date(s.sale_date + "T00:00:00");
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    }), [sales, year, month]);

  const prevSales = useMemo(() => {
    const pm = month === 1 ? 12 : month - 1;
    const py = month === 1 ? year - 1 : year;
    return sales.filter((s) => { const d = new Date(s.sale_date + "T00:00:00"); return d.getFullYear() === py && d.getMonth() + 1 === pm; });
  }, [sales, year, month]);

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

  // Available months from data
  const availableMonths = useMemo(() => {
    const set = new Set<string>();
    sales.forEach((s) => { const d = new Date(s.sale_date + "T00:00:00"); set.add(`${d.getFullYear()}-${d.getMonth() + 1}`); });
    return Array.from(set).sort().reverse().map((k) => { const [y, m] = k.split("-").map(Number); return { y, m }; });
  }, [sales]);

  const prevMonthLabel = MONTHS[(month === 1 ? 12 : month - 1) - 1].toLowerCase();

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pb-2 border-b border-border/40">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80 mb-2 font-medium">Dashboard Clínica</div>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight">
            Relatório de <span className="gold-gradient-text">{MONTHS[month - 1]}/{year}</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-2">{tenant?.name} — inteligência em tempo real</p>
        </div>
        <Select value={`${year}-${month}`} onValueChange={(v) => { const [y, m] = v.split("-").map(Number); setYear(y); setMonth(m); }}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            {availableMonths.map(({ y, m }) => (
              <SelectItem key={`${y}-${m}`} value={`${y}-${m}`}>{MONTHS[m - 1]}/{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Headline KPIs — Premium Flat */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiPremium icon={DollarSign} label="Faturamento" value={total ? BRL(total) : null} delta={varTotal} loading={loading} prevLabel={prevMonthLabel} />
        <KpiPremium icon={ShoppingBag} label="Nº de Vendas" value={count ? count.toString() : null} delta={varCount} loading={loading} prevLabel={prevMonthLabel} />
        <KpiPremium icon={Receipt} label="Ticket Médio" value={avg ? BRL(avg) : null} delta={varTicket} loading={loading} prevLabel={prevMonthLabel} />
        <KpiPremium icon={Trophy} label="Maior Venda" value={maxSale ? BRL(maxSale.amount) : null} sub={maxSale?.patient_name} loading={loading} />
      </div>

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

      {/* Trimester */}
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

function KpiPremium({ icon: Icon, label, value, delta, loading, sub, prevLabel }: { icon: any; label: string; value: string | null; delta?: number; loading?: boolean; sub?: string; prevLabel?: string }) {
  const showSkeleton = loading || value === null;
  const positive = (delta ?? 0) >= 0;
  // Auto-shrink: números longos (ex: "R$ 1.245.000") nunca estouram o card
  const len = (value ?? "").length;
  const fontSize = len <= 8 ? 30 : len <= 12 ? 24 : len <= 16 ? 20 : 17;

  return (
    <div
      className="relative p-5 group transition-all overflow-hidden min-w-0"
      style={{
        background: "linear-gradient(155deg, rgba(20,30,60,0.85) 0%, rgba(10,17,36,0.95) 100%)",
        border: "1px solid rgba(212,175,55,0.14)",
        borderRadius: 18,
        boxShadow: "0 1px 0 rgba(255,255,255,0.05) inset, 0 12px 32px -16px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.02)",
      }}
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
