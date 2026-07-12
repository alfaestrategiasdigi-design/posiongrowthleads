import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { Loader2, Calculator } from "lucide-react";

const BRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 }).format(v || 0);

type Props = {
  from: Date;
  to: Date;
  /** If provided, restrict KPI to this tenant. If omitted, aggregate globally and show per-tenant breakdown. */
  tenantId?: string | null;
  title?: string;
};

type Row = {
  tenant_id: string;
  tenant_name: string;
  total_spend: number;
  total_appointments: number;
  cost_per_appointment: number;
};

type Summary = {
  total_spend: number;
  total_appointments: number;
  cost_per_appointment: number;
};

export default function CostPerAppointmentCard({ from, to, tenantId = null, title }: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const start = format(from, "yyyy-MM-dd");
      const end = format(to, "yyyy-MM-dd");

      const { data: s } = await supabase.rpc("get_cost_per_appointment", {
        p_start: start,
        p_end: end,
        p_tenant: tenantId,
      });

      let breakdown: Row[] = [];
      if (!tenantId) {
        const { data: b } = await supabase.rpc("get_cost_per_appointment_by_tenant", {
          p_start: start,
          p_end: end,
        });
        breakdown = (b as Row[]) ?? [];
      }

      if (cancelled) return;
      const first = Array.isArray(s) ? s[0] : s;
      setSummary(
        first
          ? {
              total_spend: Number(first.total_spend) || 0,
              total_appointments: Number(first.total_appointments) || 0,
              cost_per_appointment: Number(first.cost_per_appointment) || 0,
            }
          : null,
      );
      setRows(breakdown);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [from, to, tenantId]);

  return (
    <div data-no-float className="rounded-2xl border border-white/10 bg-card/60 backdrop-blur p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-amber-400/80 mb-1 font-mono">
            {title ?? "Custo por agendamento"}
          </div>
          <p className="text-xs text-muted-foreground">Gasto em tráfego pago ÷ nº de reuniões no período</p>
        </div>
        <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
          <Calculator className="w-5 h-5" />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-20">
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Kpi label="Custo / reunião" value={BRL(summary?.cost_per_appointment ?? 0)} accent />
            <Kpi label="Gasto em ads" value={BRL(summary?.total_spend ?? 0)} />
            <Kpi label="Agendamentos" value={String(summary?.total_appointments ?? 0)} />
          </div>

          {!tenantId && rows.length > 0 && (
            <div className="mt-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2 font-mono">
                Quebra por tenant
              </div>
              <div className="overflow-x-auto rounded-lg border border-white/5">
                <table className="w-full text-sm">
                  <thead className="bg-white/[0.03] text-[11px] uppercase tracking-wider text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Clínica</th>
                      <th className="text-right px-3 py-2 font-medium">Ads</th>
                      <th className="text-right px-3 py-2 font-medium">Agend.</th>
                      <th className="text-right px-3 py-2 font-medium">Custo/agend.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.tenant_id} className="border-t border-white/5">
                        <td className="px-3 py-2">{r.tenant_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{BRL(Number(r.total_spend))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.total_appointments}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-400">
                          {Number(r.total_appointments) > 0 ? BRL(Number(r.cost_per_appointment)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${accent ? "text-amber-400" : "text-white"}`}>{value}</div>
    </div>
  );
}
