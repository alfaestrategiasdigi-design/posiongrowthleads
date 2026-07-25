import { Rows3, Rows2, StretchHorizontal } from "lucide-react";
import type { KanbanDensity } from "./types";

const OPTIONS: { value: KanbanDensity; label: string; Icon: any; hint: string }[] = [
  { value: "compact", label: "Pequena", Icon: Rows3, hint: "Compacto" },
  { value: "comfortable", label: "Média", Icon: Rows2, hint: "Padrão" },
  { value: "spacious", label: "Grande", Icon: StretchHorizontal, hint: "Confortável" },
];

export default function DensityToggle({
  value,
  onChange,
}: {
  value: KanbanDensity;
  onChange: (v: KanbanDensity) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Densidade dos cards"
      className="inline-flex items-center rounded-md border border-border bg-card p-0.5 shadow-sm"
    >
      {OPTIONS.map(({ value: v, Icon, hint }) => {
        const active = v === value;
        return (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            title={hint}
            aria-pressed={active}
            className={`inline-flex h-7 w-8 items-center justify-center rounded-[5px] transition-colors ${
              active
                ? "bg-primary/12 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
