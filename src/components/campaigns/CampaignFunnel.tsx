import { Card } from "@/components/ui/card";
import { AlertTriangle, TrendingDown, TrendingUp } from "lucide-react";

interface Step {
  label: string;
  value: number;
  hint?: string;
  cost?: number;
}

const BRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
const NUM = (v: number) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));

export default function CampaignFunnel({
  spend, leads, contacts, appointments, showed, sales, benchmarks, labels,
}: {
  spend: number;
  leads: number;
  contacts: number;
  appointments: number;
  showed: number;
  sales: number;
  benchmarks?: { show?: number; close?: number };
  labels?: {
    title?: string;
    appointments?: string;
    showed?: string;
    sales?: string;
    appointmentCost?: string;
    showedCost?: string;
    cac?: string;
  };
}) {
  const steps: Step[] = [
    { label: "Leads", value: leads, cost: leads ? spend / leads : 0, hint: "CPL" },
    { label: "Contato WhatsApp", value: contacts },
    { label: labels?.appointments ?? "Consulta Agendada", value: appointments, cost: appointments ? spend / appointments : 0, hint: labels?.appointmentCost ?? "Custo/Consulta" },
    { label: labels?.showed ?? "Consulta Realizada", value: showed, cost: showed ? spend / showed : 0, hint: labels?.showedCost ?? "Custo/Realizada" },
    { label: labels?.sales ?? "Venda", value: sales, cost: sales ? spend / sales : 0, hint: labels?.cac ?? "CAC" },
  ];

  const max = Math.max(...steps.map((s) => s.value), 1);
  const showRate = appointments ? (showed / appointments) * 100 : 0;
  const closeRate = showed ? (sales / showed) * 100 : 0;

  return (
    <Card className="p-4 bg-gradient-to-br from-card to-background/60 border-primary/10">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80">
          Funil da Clínica
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className={`flex items-center gap-1 ${showRate >= (benchmarks?.show ?? 60) ? "text-emerald-400" : "text-rose-400"}`}>
            {showRate >= (benchmarks?.show ?? 60) ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            Taxa de Show {showRate.toFixed(0)}%
          </span>
          <span className={`flex items-center gap-1 ${closeRate >= (benchmarks?.close ?? 20) ? "text-emerald-400" : "text-rose-400"}`}>
            Fechamento {closeRate.toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {steps.map((s, i) => {
          const prev = i > 0 ? steps[i - 1].value : null;
          const conv = prev && prev > 0 ? (s.value / prev) * 100 : null;
          const width = Math.max(20, (s.value / max) * 100);
          const belowBench =
            (s.label === "Consulta Realizada" && conv != null && conv < (benchmarks?.show ?? 60)) ||
            (s.label === "Venda" && conv != null && conv < (benchmarks?.close ?? 20));
          return (
            <div key={s.label} className="flex flex-col gap-1.5">
              <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{s.label}</div>
              <div className={`h-14 rounded-md flex items-end p-1.5 relative overflow-hidden ${belowBench ? "bg-rose-500/10 border border-rose-500/30" : "bg-primary/10 border border-primary/20"}`}>
                <div
                  className={`absolute inset-x-0 bottom-0 ${belowBench ? "bg-rose-500/25" : "bg-primary/25"}`}
                  style={{ height: `${width}%` }}
                />
                <div className="relative w-full flex items-baseline justify-between">
                  <span className="text-base font-bold tabular-nums">{NUM(s.value)}</span>
                  {conv != null && (
                    <span className={`text-[9px] ${belowBench ? "text-rose-300" : "text-primary/80"}`}>
                      {conv.toFixed(0)}%
                    </span>
                  )}
                </div>
              </div>
              {s.cost != null && s.hint ? (
                <div className="text-[9px] text-muted-foreground tabular-nums flex justify-between">
                  <span>{s.hint}</span>
                  <span className="text-amber-400">{BRL(s.cost)}</span>
                </div>
              ) : <div className="h-3" />}
              {belowBench && (
                <div className="flex items-center gap-1 text-[9px] text-rose-400">
                  <AlertTriangle className="w-2.5 h-2.5" /> abaixo do benchmark
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
