import { Card } from "@/components/ui/card";
import { AlertTriangle, Info, Zap } from "lucide-react";

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

export default function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  if (alerts.length === 0) {
    return (
      <Card className="p-3 border-emerald-500/20 bg-emerald-500/5 text-emerald-300 text-xs flex items-center gap-2">
        <Zap className="w-3.5 h-3.5" /> Nenhum alerta ativo — campanhas saudáveis no período.
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {alerts.map((a) => {
        const Icon = ICONS[a.severity];
        return (
          <Card key={a.id} className={`p-3 border ${SEV_STYLES[a.severity]} flex gap-2.5`}>
            <Icon className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold">{a.title}</div>
              <div className="text-[11px] opacity-80 mt-0.5">{a.description}</div>
              {a.scope && <div className="text-[10px] uppercase tracking-wider opacity-60 mt-1">{a.scope}</div>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
