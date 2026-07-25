import { CheckCircle2, Circle, XCircle } from "lucide-react";
import { PIPELINE_STAGES, CLIENT_PIPELINE_STAGES } from "@/types/admin";

interface Props {
  stage: string;
  variant?: "agency" | "client";
}

export default function PipelineStepper({ stage, variant = "client" }: Props) {
  const source = variant === "agency" ? PIPELINE_STAGES : CLIENT_PIPELINE_STAGES;
  // Terminal states rendered apart
  const flow = source.filter((s) => s.id !== "perdido" && s.id !== "no_show");
  const isLost = stage === "perdido" || stage === "no_show";
  const currentIdx = flow.findIndex((s) => s.id === stage);

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
        Ciclo de vida
      </div>
      {isLost ? (
        <div className="flex items-center gap-2 text-rose-400">
          <XCircle className="w-5 h-5" />
          <span className="text-sm font-semibold">
            {stage === "no_show" ? "No-show" : "Perdido"}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {flow.map((s, i) => {
            const active = i === currentIdx;
            const done = currentIdx >= 0 && i < currentIdx;
            return (
              <div key={s.id} className="flex items-center gap-1 shrink-0">
                <div
                  className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-full border transition-all ${
                    active
                      ? "border-primary bg-primary/10 text-primary font-semibold"
                      : done
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                        : "border-border/60 text-muted-foreground"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <Circle className="w-3 h-3" />
                  )}
                  <span className="whitespace-nowrap">{s.short}</span>
                </div>
                {i < flow.length - 1 && (
                  <div
                    className={`h-px w-3 ${done ? "bg-emerald-500/50" : "bg-border/60"}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
