import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { AlertTriangle, Info, Zap, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";

export type Alert = {
  id: string;
  severity: "info" | "warn" | "critical";
  title: string;
  description: string;
  scope?: string;
};

const SEV_STYLES: Record<Alert["severity"], string> = {
  info: "border-cyan-500/30 bg-cyan-500/5 text-cyan-300",
  warn: "border-amber-500/30 bg-amber-500/5 text-amber-300",
  critical: "border-rose-500/40 bg-rose-500/10 text-rose-300",
};

const ICONS: Record<Alert["severity"], any> = {
  info: Info,
  warn: AlertTriangle,
  critical: Zap,
};

const SEV_RANK: Record<Alert["severity"], number> = { critical: 0, warn: 1, info: 2 };

export default function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, Alert[]>();
    for (const a of alerts) {
      const arr = map.get(a.title) ?? [];
      arr.push(a);
      map.set(a.title, arr);
    }
    return Array.from(map.entries())
      .map(([title, items]) => ({
        title,
        items,
        severity: items.reduce<Alert["severity"]>(
          (acc, it) => (SEV_RANK[it.severity] < SEV_RANK[acc] ? it.severity : acc),
          "info"
        ),
      }))
      .sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  }, [alerts]);

  if (alerts.length === 0) {
    return (
      <Card className="px-3 py-2 border-emerald-500/20 bg-emerald-500/5 text-emerald-300 text-[11px] flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5" /> Nenhum alerta ativo — campanhas saudáveis no período.
      </Card>
    );
  }

  const critical = alerts.filter((a) => a.severity === "critical").length;
  const warns = alerts.filter((a) => a.severity === "warn").length;
  const topSeverity = groups[0].severity;

  return (
    <Card className={`border ${SEV_STYLES[topSeverity]} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between gap-3 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs">
          <AlertTriangle className="w-3.5 h-3.5" />
          <span className="font-semibold">{alerts.length} alerta{alerts.length > 1 ? "s" : ""}</span>
          <span className="opacity-70">
            · {critical} crítico{critical !== 1 ? "s" : ""} · {warns} atenção
          </span>
        </div>
        <div className="flex items-center gap-1 text-[11px] opacity-80">
          {open ? "Ocultar" : "Ver detalhes"}
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </div>
      </button>

      {open && (
        <div className="border-t border-white/5 divide-y divide-white/5">
          {groups.map((g) => (
            <GroupRow key={g.title} title={g.title} items={g.items} severity={g.severity} />
          ))}
        </div>
      )}
    </Card>
  );
}

function GroupRow({
  title,
  items,
  severity,
}: {
  title: string;
  items: Alert[];
  severity: Alert["severity"];
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = ICONS[severity];
  return (
    <div className="px-3 py-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="text-xs font-medium truncate">{title}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 opacity-80">
            {items.length}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-3 h-3 opacity-60" />
        ) : (
          <ChevronDown className="w-3 h-3 opacity-60" />
        )}
      </button>
      {expanded && (
        <ul className="mt-1.5 pl-5 space-y-1">
          {items.map((it) => (
            <li key={it.id} className="text-[11px] opacity-80">
              {it.description}
              {it.scope && (
                <span className="ml-1 text-[10px] uppercase tracking-wider opacity-50">
                  · {it.scope}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
