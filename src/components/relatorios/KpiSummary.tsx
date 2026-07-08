import type { Kpis } from "@/lib/relatorios/types";
import { Users, CheckCircle2, Calendar, UserCheck, Trophy, TrendingUp, DollarSign, TrendingDown, Megaphone, Target, Repeat, Sparkles, Wallet, ShoppingCart, Percent, Flag } from "lucide-react";

const fmtBRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;
const fmtNum = (n: number) => n.toLocaleString("pt-BR");

function Kpi({ label, value, sub, icon: Icon, tone = "default", big = false }: {
  label: string; value: string; sub?: string; icon: any; tone?: "default"|"good"|"bad"|"accent"; big?: boolean;
}) {
  const toneCls =
    tone === "good"   ? "text-emerald-400" :
    tone === "bad"    ? "text-rose-400" :
    tone === "accent" ? "text-accent" : "text-foreground";
  const iconBg =
    tone === "good"   ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
    tone === "bad"    ? "bg-rose-500/10 text-rose-400 border-rose-500/20" :
    tone === "accent" ? "bg-accent/10 text-accent border-accent/25" :
                        "bg-muted/40 text-muted-foreground border-border";
  return (
    <div className="group relative rounded-xl border border-border/60 bg-card/60 hover:bg-card/80 transition-colors p-3.5 md:p-4 flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground truncate">{label}</span>
        <span className={`w-7 h-7 shrink-0 rounded-lg border grid place-items-center ${iconBg}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
      </div>
      <div className={`font-display leading-none tabular-nums ${toneCls} ${big ? "text-2xl md:text-3xl" : "text-xl md:text-[22px]"}`}>{value}</div>
      {sub && <div className="text-[10.5px] text-muted-foreground truncate">{sub}</div>}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{title}</h3>
        {hint && <span className="text-[10px] text-muted-foreground/70">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export default function KpiSummary({ kpis }: { kpis: Kpis }) {
  return (
    <div className="space-y-4">
      <Section title="Resultado" hint="valor e conversão do período">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3">
          <Kpi label="Valor ganho" value={fmtBRL(kpis.valorGanho)} sub={`${fmtNum(kpis.ganhos)} negócios · ${fmtPct(kpis.taxaConversao)} conv.`} icon={DollarSign} tone="good" big />
          <Kpi label="Ganhos" value={fmtNum(kpis.ganhos)} sub={`Conv. ${fmtPct(kpis.taxaConversao)}`} icon={Trophy} tone="good" />
          <Kpi label="Valor perdido" value={fmtBRL(kpis.valorPerdido)} icon={TrendingDown} tone="bad" />
          <Kpi label="Investimento" value={fmtBRL(kpis.investimento)} sub="Meta + spend manual" icon={Megaphone} tone="accent" />
        </div>
      </Section>

      <Section title="Aquisição & funil" hint="topo, meio e fundo">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2.5 md:gap-3">
          <Kpi label="Leads no período" value={fmtNum(kpis.totalLeads)} icon={Users} />
          <Kpi label="Qualificação" value={fmtPct(kpis.taxaQualificacao)} sub={`${fmtNum(kpis.qualificados)} / ${fmtNum(kpis.totalLeads)}`} icon={CheckCircle2} />
          <Kpi label="Agendamentos" value={fmtNum(kpis.agendamentos)} icon={Calendar} />
          <Kpi label="Comparecimento" value={fmtPct(kpis.taxaComparecimento)} sub={`${fmtNum(kpis.compareceu)} de ${fmtNum(kpis.compareceu + kpis.noShow)}`} icon={UserCheck} />
          <Kpi label="CPL médio" value={fmtBRL(kpis.cpl)} icon={TrendingUp} />
          <Kpi label="CAC" value={fmtBRL(kpis.cac)} icon={Target} />
        </div>
      </Section>

      <Section title="Financeiro" hint="vendas, meta e custos por conversão">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5 md:gap-3">
          <Kpi label="Vendas" value={fmtBRL(kpis.vendasTotal)} sub={`${fmtNum(kpis.vendasQtd)} venda(s)`} icon={ShoppingCart} tone="good" />
          <Kpi label="Nova venda" value={fmtBRL(kpis.novaVenda)} sub="1º contato no período" icon={Sparkles} />
          <Kpi label="Monetização" value={fmtBRL(kpis.monetizacao)} sub="Recompra do mesmo paciente" icon={Repeat} />
          <Kpi label="Meta" value={fmtBRL(kpis.meta)} sub={kpis.meta > 0 ? `${fmtPct(kpis.vendasTotal / kpis.meta)} atingido` : "Sem meta cadastrada"} icon={Flag} tone="accent" />
          <Kpi label="Não realizado" value={fmtBRL(kpis.naoRealizado)} sub="Meta − Vendas" icon={TrendingDown} tone={kpis.naoRealizado > 0 ? "bad" : "good"} />
          <Kpi label="Ticket médio" value={fmtBRL(kpis.ticketMedio)} icon={Wallet} />
          <Kpi label="CPA" value={fmtBRL(kpis.cpa)} sub="Invest. / vendas" icon={Target} />
          <Kpi label="CPL" value={fmtBRL(kpis.cpl)} icon={TrendingUp} />
          <Kpi label="CPMQL" value={fmtBRL(kpis.cpmql)} sub="Invest. / MQL" icon={Percent} />
          <Kpi label="CPSQL" value={fmtBRL(kpis.cpsql)} sub="Invest. / SQL" icon={Percent} />
        </div>
      </Section>
    </div>
  );
}
