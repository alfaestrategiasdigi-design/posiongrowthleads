import type { FunilStage } from "@/lib/relatorios/types";

const fmtPct = (n: number | null) => n === null ? "—" : `${(n * 100).toFixed(1)}%`;

export default function BiFunnel({ funil }: { funil: FunilStage[] }) {
  const maxCount = Math.max(...funil.map(s => s.count), 1);
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4 md:p-5 space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="font-display text-base md:text-lg text-foreground leading-tight">Funil de Vendas</h3>
          <p className="text-[10.5px] text-muted-foreground uppercase tracking-[0.18em] mt-0.5">Leads → Vendas</p>
        </div>
        <span className="text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground/70 text-right hidden sm:block">
          quantidade<br/>% etapa anterior
        </span>
      </div>
      <div className="space-y-1.5">
        {funil.map(stage => {
          const w = (stage.count / maxCount) * 100;
          return (
            <div key={stage.id} className="grid grid-cols-[110px_1fr_auto] md:grid-cols-[150px_1fr_auto] items-center gap-2.5 md:gap-3">
              <span className="text-[12px] md:text-sm font-medium truncate text-foreground/90">{stage.label}</span>
              <div className="relative h-8 md:h-9 rounded-md bg-muted/25 overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-amber-400/90 via-amber-400/70 to-amber-400/40 transition-all"
                  style={{ width: `${w}%` }} />
                <div className="absolute inset-0 flex items-center px-2.5 md:px-3">
                  <span className="text-[12px] md:text-sm font-semibold tabular-nums text-foreground drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)]">
                    {stage.count.toLocaleString("pt-BR")}
                  </span>
                </div>
              </div>
              <div className="text-right text-[10.5px] md:text-xs tabular-nums w-[70px] md:w-24 leading-tight">
                <div className="text-foreground/85 font-medium">{fmtPct(stage.pctTotal)}</div>
                <div className="text-muted-foreground/80">{fmtPct(stage.pctPrev)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
