import type { Kpis } from "@/lib/relatorios/types";
import { Users, CheckCircle2, Calendar, UserCheck, Trophy, TrendingUp, DollarSign, TrendingDown, Megaphone, Target } from "lucide-react";

const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtNum = (n: number) => n.toLocaleString("pt-BR");

function Card({ label, value, sub, icon: Icon, tone = "default" }: {
  label: string; value: string; sub?: string; icon: any; tone?: "default"|"good"|"bad";
}) {
  const toneCls = tone === "good" ? "text-emerald-400" : tone === "bad" ? "text-rose-400" : "text-foreground";
  return (
    <div className="card-elevated p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground truncate">{label}</span>
        <Icon className="w-4 h-4 text-accent/70 shrink-0" />
      </div>
      <div className={`text-2xl font-display leading-tight tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

export default function KpiSummary({ kpis }: { kpis: Kpis }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
      <Card label="Leads no período" value={fmtNum(kpis.totalLeads)} icon={Users} />
      <Card label="Taxa de qualificação" value={fmtPct(kpis.taxaQualificacao)} sub={`${fmtNum(kpis.qualificados)} / ${fmtNum(kpis.totalLeads)}`} icon={CheckCircle2} />
      <Card label="Agendamentos" value={fmtNum(kpis.agendamentos)} icon={Calendar} />
      <Card label="Taxa comparecimento" value={fmtPct(kpis.taxaComparecimento)} sub={`${fmtNum(kpis.compareceu)} de ${fmtNum(kpis.compareceu + kpis.noShow)}`} icon={UserCheck} />
      <Card label="Ganhos" value={fmtNum(kpis.ganhos)} sub={`Conv. ${fmtPct(kpis.taxaConversao)}`} icon={Trophy} tone="good" />
      <Card label="Valor ganho" value={fmtBRL(kpis.valorGanho)} icon={DollarSign} tone="good" />
      <Card label="Valor perdido" value={fmtBRL(kpis.valorPerdido)} icon={TrendingDown} tone="bad" />
      <Card label="Investimento" value={fmtBRL(kpis.investimento)} icon={Megaphone} />
      <Card label="CPL médio" value={fmtBRL(kpis.cpl)} icon={TrendingUp} />
      <Card label="CAC" value={fmtBRL(kpis.cac)} icon={Target} />
    </div>
  );
}
