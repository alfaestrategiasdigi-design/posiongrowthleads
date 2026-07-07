import type { FunilStage } from "@/lib/relatorios/types";

const fmtPct = (n: number | null) => n === null ? "—" : `${(n * 100).toFixed(1)}%`;

export default function FunilVisual({ funil }: { funil: FunilStage[] }) {
  const main = funil.filter(s => !["perdido","no_show"].includes(s.id));
  const extras = funil.filter(s => ["perdido","no_show"].includes(s.id));
  const maxCount = Math.max(...main.map(s => s.count), 1);

  return (
    <div className="card-elevated p-6 space-y-5">
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-lg text-foreground">Funil de Conversão</h3>
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">% total · % etapa anterior</span>
      </div>

      <div className="space-y-2">
        {main.map(stage => {
          const w = (stage.count / maxCount) * 100;
          return (
            <div key={stage.id} className="grid grid-cols-[120px_1fr_auto] items-center gap-3">
              <span className="text-sm font-medium truncate">{stage.label}</span>
              <div className="relative h-9 rounded-md bg-muted/30 overflow-hidden">
                <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent to-accent/60 transition-all"
                  style={{ width: `${w}%` }} />
                <div className="absolute inset-0 flex items-center px-3">
                  <span className="text-sm font-semibold tabular-nums text-foreground/90">{stage.count.toLocaleString("pt-BR")}</span>
                </div>
              </div>
              <div className="text-right text-xs tabular-nums w-32">
                <div className="text-foreground/80">{fmtPct(stage.pctTotal)}</div>
                <div className="text-muted-foreground">{fmtPct(stage.pctPrev)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {extras.length > 0 && (
        <div className="pt-3 border-t border-border grid grid-cols-2 gap-3">
          {extras.map(s => (
            <div key={s.id} className="flex items-center justify-between px-3 py-2 rounded-md bg-rose-500/5 border border-rose-500/20">
              <span className="text-sm">{s.label}</span>
              <span className="text-sm font-semibold tabular-nums text-rose-300">{s.count} · {fmtPct(s.pctTotal)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
