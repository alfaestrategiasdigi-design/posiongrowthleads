import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { TrendingUp, Users, Target, DollarSign } from "lucide-react";

const KPIS = [
  { label: "Faturamento mensal", icon: DollarSign, before: 28000, after: 142000, prefix: "R$ ", suffix: "" },
  { label: "Leads qualificados / mês", icon: Users, before: 35, after: 380, prefix: "", suffix: "" },
  { label: "Taxa de conversão", icon: Target, before: 2, after: 11, prefix: "", suffix: "%" },
  { label: "Ticket médio", icon: TrendingUp, before: 1800, after: 6500, prefix: "R$ ", suffix: "" },
];

const fmt = (n: number) =>
  n >= 1000 ? n.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : n.toFixed(n < 10 ? 1 : 0);

const BeforeAfterSection = () => {
  const [pos, setPos] = useState(50);
  const t = pos / 100;

  return (
    <section className="py-20 md:py-28 px-4 relative">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-12">
          <p className="text-[11px] uppercase tracking-[0.3em] text-accent/90 mb-4">
            Antes & Depois
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl text-foreground max-w-3xl mx-auto leading-tight">
            Arraste e veja a <span className="gold-gradient-text">transformação</span>.
          </h2>
          <p className="text-sm text-muted-foreground mt-4">
            Dados médios consolidados das clínicas após 6 meses com o método Posion.
          </p>
        </div>

        <div className="card-elevated p-8 md:p-10">
          {/* Slider */}
          <div className="flex items-center gap-4 mb-10">
            <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground w-16">Antes</span>
            <Slider
              value={[pos]}
              onValueChange={(v) => setPos(v[0] ?? 0)}
              min={0}
              max={100}
              step={1}
              className="flex-1"
              aria-label="Transição antes e depois"
            />
            <span className="text-xs uppercase tracking-[0.2em] text-accent w-16 text-right">Depois</span>
          </div>

          {/* KPIs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {KPIS.map((k) => {
              const current = k.before + (k.after - k.before) * t;
              const progress = ((current - k.before) / (k.after - k.before)) * 100;
              return (
                <div key={k.label} className="card-tech p-5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/30 flex items-center justify-center">
                      <k.icon className="w-4 h-4 text-accent" strokeWidth={1.8} />
                    </div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                      {k.label}
                    </p>
                  </div>
                  <p className="font-display text-3xl gold-gradient-text num mb-3 tabular-nums">
                    {k.prefix}
                    {fmt(current)}
                    {k.suffix}
                  </p>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full gradient-accent transition-[width] duration-150 ease-out"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-2">
                    <span>{k.prefix}{fmt(k.before)}{k.suffix}</span>
                    <span className="text-accent">{k.prefix}{fmt(k.after)}{k.suffix}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};

export default BeforeAfterSection;
