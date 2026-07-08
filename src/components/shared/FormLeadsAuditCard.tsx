import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Loader2, CheckCircle2, Clock, AlertTriangle, Zap, MinusCircle } from "lucide-react";
import { Link } from "react-router-dom";

interface Props {
  from: Date | string; // yyyy-MM-dd or Date
  to: Date | string;
  scope: "admin" | "tenant";
  currentTenantId: string | null;
  detailsHref?: string; // optional link to a page listing form leads
}

type ExecStatus = "completed" | "running" | "waiting_delay" | "waiting_response" | "failed" | string;

interface Bucket {
  totalLeads: number;
  withExecution: number;
  byStatus: Record<string, number>;
  lastLead: { nome: string; created_at: string } | null;
  lastExecutionError: string | null;
}

const FORM_ORIGENS = ["formulario", "form", "forms_manual", "site", "landing"];

function toIso(v: Date | string, endOfDay = false): string {
  if (typeof v === "string") {
    return endOfDay ? `${v}T23:59:59.999Z` : `${v}T00:00:00.000Z`;
  }
  const d = new Date(v);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

const STATUS_LABEL: Record<string, string> = {
  completed: "Concluídas",
  running: "Em execução",
  waiting_delay: "Aguardando delay",
  waiting_response: "Aguardando resposta",
  failed: "Falharam",
};

const STATUS_ICON: Record<string, any> = {
  completed: CheckCircle2,
  running: Zap,
  waiting_delay: Clock,
  waiting_response: Clock,
  failed: AlertTriangle,
};

const STATUS_TONE: Record<string, string> = {
  completed: "text-emerald-400 border-emerald-500/25 bg-emerald-500/5",
  running: "text-sky-400 border-sky-500/25 bg-sky-500/5",
  waiting_delay: "text-amber-400 border-amber-500/25 bg-amber-500/5",
  waiting_response: "text-amber-400 border-amber-500/25 bg-amber-500/5",
  failed: "text-rose-400 border-rose-500/25 bg-rose-500/5",
};

export default function FormLeadsAuditCard({ from, to, scope, currentTenantId, detailsHref }: Props) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Bucket | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setErr(null);
      try {
        const start = toIso(from);
        const end = toIso(to, true);

        let leadsQ = supabase
          .from("leads")
          .select("id, nome_completo, created_at, origem, tenant_id")
          .in("origem", FORM_ORIGENS)
          .gte("created_at", start)
          .lte("created_at", end)
          .order("created_at", { ascending: false })
          .limit(1000);

        if (scope === "tenant" && currentTenantId) {
          leadsQ = leadsQ.eq("tenant_id", currentTenantId);
        } else if (scope === "admin") {
          leadsQ = leadsQ.is("tenant_id", null);
        }

        const { data: leads, error: leadsErr } = await leadsQ;
        if (leadsErr) throw leadsErr;
        const leadRows = leads || [];
        const leadIds = leadRows.map((l: any) => l.id);

        const bucket: Bucket = {
          totalLeads: leadRows.length,
          withExecution: 0,
          byStatus: {},
          lastLead: leadRows[0] ? { nome: leadRows[0].nome_completo, created_at: leadRows[0].created_at } : null,
          lastExecutionError: null,
        };

        if (leadIds.length > 0) {
          const { data: execs, error: execErr } = await supabase
            .from("automation_executions")
            .select("lead_id, status, last_error, started_at")
            .in("lead_id", leadIds)
            .order("started_at", { ascending: false })
            .limit(5000);
          if (execErr) throw execErr;

          const seenLeads = new Set<string>();
          for (const e of execs || []) {
            const st = String((e as any).status || "unknown");
            bucket.byStatus[st] = (bucket.byStatus[st] || 0) + 1;
            if ((e as any).lead_id) seenLeads.add(String((e as any).lead_id));
            if (!bucket.lastExecutionError && st === "failed" && (e as any).last_error) {
              bucket.lastExecutionError = String((e as any).last_error).slice(0, 160);
            }
          }
          bucket.withExecution = seenLeads.size;
        }

        if (!cancel) setData(bucket);
      } catch (e: any) {
        if (!cancel) setErr(e?.message || String(e));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [from, to, scope, currentTenantId]);

  const noneTriggered = data ? Math.max(0, data.totalLeads - data.withExecution) : 0;

  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4 md:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground font-mono flex items-center gap-1.5">
            <FileText className="w-3 h-3 text-accent" /> Auditoria · Leads via formulário
          </div>
          <h3 className="text-sm md:text-base font-semibold text-foreground mt-0.5">
            Origem <span className="text-accent">formulário</span> + status dos disparos automáticos
          </h3>
        </div>
        {detailsHref && (
          <Link to={detailsHref} className="text-[11px] text-accent hover:text-accent/80 whitespace-nowrap">
            Ver detalhes →
          </Link>
        )}
      </div>

      {loading ? (
        <div className="h-24 flex items-center justify-center text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
        </div>
      ) : err ? (
        <div className="text-xs text-rose-300 bg-rose-500/5 border border-rose-500/25 rounded p-2">{err}</div>
      ) : data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
            <MetricPill label="Leads no período" value={data.totalLeads} icon={FileText} tone="text-foreground border-border bg-muted/30" />
            <MetricPill
              label="Com automação disparada"
              value={data.withExecution}
              sub={data.totalLeads > 0 ? `${((data.withExecution / data.totalLeads) * 100).toFixed(0)}%` : undefined}
              icon={Zap}
              tone="text-accent border-accent/25 bg-accent/5"
            />
            <MetricPill
              label="Sem automação"
              value={noneTriggered}
              icon={MinusCircle}
              tone={noneTriggered > 0 ? "text-amber-400 border-amber-500/25 bg-amber-500/5" : "text-muted-foreground border-border bg-muted/30"}
            />
            <MetricPill
              label="Falhas"
              value={data.byStatus.failed || 0}
              icon={AlertTriangle}
              tone={(data.byStatus.failed || 0) > 0 ? "text-rose-400 border-rose-500/25 bg-rose-500/5" : "text-muted-foreground border-border bg-muted/30"}
            />
          </div>

          {Object.keys(data.byStatus).length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">Execuções por status</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(data.byStatus)
                  .sort((a, b) => b[1] - a[1])
                  .map(([status, count]) => {
                    const Icon = STATUS_ICON[status] || Clock;
                    const tone = STATUS_TONE[status] || "text-muted-foreground border-border bg-muted/30";
                    return (
                      <span
                        key={status}
                        className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border ${tone}`}
                      >
                        <Icon className="w-3 h-3" />
                        {STATUS_LABEL[status] || status}
                        <span className="tabular-nums font-semibold ml-0.5">{count}</span>
                      </span>
                    );
                  })}
              </div>
            </div>
          )}

          {data.lastLead && (
            <div className="text-[11px] text-muted-foreground border-t border-border/50 pt-2">
              Último lead: <span className="text-foreground">{data.lastLead.nome}</span>{" "}
              <span className="text-muted-foreground/70">
                · {new Date(data.lastLead.created_at).toLocaleString("pt-BR")}
              </span>
            </div>
          )}
          {data.lastExecutionError && (
            <div className="text-[11px] text-rose-300 bg-rose-500/5 border border-rose-500/25 rounded p-2">
              <span className="uppercase tracking-wider text-[9px] mr-1 opacity-80">Último erro:</span>
              {data.lastExecutionError}
            </div>
          )}
          {data.totalLeads === 0 && (
            <div className="text-xs text-muted-foreground italic">
              Nenhum lead com origem <code className="font-mono">formulario</code> no período selecionado.
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function MetricPill({
  label, value, sub, icon: Icon, tone,
}: { label: string; value: number; sub?: string; icon: any; tone: string }) {
  return (
    <div className={`rounded-lg border p-2.5 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] uppercase tracking-[0.18em] opacity-80 truncate">{label}</span>
        <Icon className="w-3.5 h-3.5 shrink-0 opacity-90" />
      </div>
      <div className="text-lg md:text-xl font-semibold tabular-nums mt-1">{value.toLocaleString("pt-BR")}</div>
      {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}
