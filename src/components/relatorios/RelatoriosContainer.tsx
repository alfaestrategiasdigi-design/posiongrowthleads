import { useEffect, useMemo, useRef, useState } from "react";
import { format, subDays } from "date-fns";
import { Loader2, FileDown, FileSpreadsheet, Sparkles, Rows3, Rows2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRelatorioData } from "@/hooks/useRelatorioData";
import FiltersBar from "./FiltersBar";
import KpiSummary from "./KpiSummary";
import FunilVisual from "./FunilVisual";

import RankingsGrid from "./RankingsGrid";
import ChartsGrid from "./ChartsGrid";

type Density = "compact" | "comfortable";
const DENSITY_KEY = "relatorios.density";
import LeadsDetailTable from "./LeadsDetailTable";
import { exportLeadsCsv } from "./export/exportToCsv";
import { exportRelatorioPdf } from "./export/exportToPdf";
import type { RelatorioFilters, Scope } from "@/lib/relatorios/types";

interface Props {
  scope: Scope;
  currentTenantId: string | null;
  scopeLabel: string;
}

const today = () => format(new Date(), "yyyy-MM-dd");

export default function RelatoriosContainer({ scope, currentTenantId, scopeLabel }: Props) {
  const [filters, setFilters] = useState<RelatorioFilters>({
    from: format(subDays(new Date(), 29), "yyyy-MM-dd"),
    to: today(),
    tenantIds: [], campaigns: [], forms: [], ownerIds: [], origem: "all",
  });
  const [exportingPdf, setExportingPdf] = useState(false);
  const [density, setDensity] = useState<Density>(() => {
    if (typeof window === "undefined") return "comfortable";
    return (window.localStorage.getItem(DENSITY_KEY) as Density) || "comfortable";
  });
  useEffect(() => { try { window.localStorage.setItem(DENSITY_KEY, density); } catch {} }, [density]);
  const isCompact = density === "compact";
  const chartsRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, error } = useRelatorioData(filters, scope, currentTenantId);

  const periodLabel = useMemo(() =>
    `${new Date(filters.from).toLocaleDateString("pt-BR")} → ${new Date(filters.to).toLocaleDateString("pt-BR")}`,
    [filters.from, filters.to]);

  const handlePdf = async () => {
    if (!data) return;
    setExportingPdf(true);
    try {
      await exportRelatorioPdf({ scopeLabel, filters, data, chartsRoot: chartsRef.current });
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div data-density={density} className="min-h-full bg-gradient-to-b from-background via-background to-background/60">
      <div className={`px-4 md:px-6 lg:px-8 ${isCompact ? "pt-3 md:pt-4 pb-3 space-y-3" : "pt-5 md:pt-6 pb-4 space-y-4"} animate-fade-in`}>
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 text-[9.5px] uppercase tracking-[0.22em] text-accent/90 border border-accent/30 bg-accent/5 px-2.5 py-0.5 rounded-full mb-2">
              <Sparkles className="w-3 h-3" /> Relatório Consolidado
            </span>
            <h1 className={`${isCompact ? "text-lg md:text-xl" : "text-xl md:text-2xl lg:text-[26px]"} font-display text-foreground leading-tight`}>Relatórios</h1>
            <p className="text-muted-foreground text-xs md:text-sm mt-0.5 truncate">
              {scopeLabel} <span className="text-muted-foreground/50">·</span> {periodLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center rounded-md border border-border/60 bg-card/60 p-0.5" role="group" aria-label="Densidade">
              <button
                type="button"
                onClick={() => setDensity("comfortable")}
                aria-pressed={!isCompact}
                title="Modo confortável"
                className={`inline-flex items-center gap-1 px-2 h-8 rounded text-xs transition-colors ${!isCompact ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Rows2 className="w-3.5 h-3.5" /> Confortável
              </button>
              <button
                type="button"
                onClick={() => setDensity("compact")}
                aria-pressed={isCompact}
                title="Modo compacto"
                className={`inline-flex items-center gap-1 px-2 h-8 rounded text-xs transition-colors ${isCompact ? "bg-accent/15 text-accent" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Rows3 className="w-3.5 h-3.5" /> Compacto
              </button>
            </div>
            <Button variant="outline" size="sm" className="gap-2 h-9" disabled={!data || !data.leads.length}
              onClick={() => data && exportLeadsCsv(data.leads, scopeLabel)}>
              <FileSpreadsheet className="w-4 h-4" /> CSV
            </Button>
            <Button size="sm" className="gap-2 h-9" disabled={!data || exportingPdf} onClick={handlePdf}>
              {exportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} PDF
            </Button>
          </div>
        </div>

        <FiltersBar
          filters={filters}
          onChange={setFilters}
          scope={scope}
          availableTenants={data?.availableTenants ?? []}
          availableCampaigns={data?.availableCampaigns ?? []}
          availableForms={data?.availableForms ?? []}
          availableOwners={data?.availableOwners ?? []}
        />

        {isLoading && (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-6 h-6 animate-spin text-accent" />
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-300">
            Erro carregando relatório: {String((error as any).message || error)}
          </div>
        )}

        {data && !isLoading && (
          <div className={isCompact ? "space-y-3" : "space-y-4 md:space-y-5"}>
            <KpiSummary kpis={data.kpis} />
            <div className={`grid grid-cols-1 xl:grid-cols-5 ${isCompact ? "gap-2 md:gap-3" : "gap-3 md:gap-4"}`}>
              <div className="xl:col-span-3"><FunilVisual funil={data.funil} /></div>
              <div className={`xl:col-span-2 rounded-xl border border-border/60 bg-card/60 ${isCompact ? "p-3 md:p-4" : "p-4 md:p-5"} flex flex-col justify-between`}>
                <div>
                  <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Resumo do período</h3>
                  <p className="text-xs text-muted-foreground/80 mt-1">Indicadores-chave consolidados</p>
                </div>
                <ul className="text-xs md:text-sm space-y-2 mt-3">
                  <li className="flex items-center justify-between"><span className="text-muted-foreground">Leads</span><span className="tabular-nums font-medium">{data.kpis.totalLeads.toLocaleString("pt-BR")}</span></li>
                  <li className="flex items-center justify-between"><span className="text-muted-foreground">Ganhos</span><span className="tabular-nums font-medium text-emerald-400">{data.kpis.ganhos}</span></li>
                  <li className="flex items-center justify-between"><span className="text-muted-foreground">Valor ganho</span><span className="tabular-nums font-medium text-emerald-400">{data.kpis.valorGanho.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</span></li>
                  <li className="flex items-center justify-between"><span className="text-muted-foreground">Investimento</span><span className="tabular-nums font-medium">{data.kpis.investimento.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}</span></li>
                  <li className="flex items-center justify-between border-t border-border/60 pt-2 mt-1"><span className="text-muted-foreground">ROAS</span><span className="tabular-nums font-semibold">{data.kpis.investimento > 0 ? (data.kpis.valorGanho / data.kpis.investimento).toFixed(2) + "x" : "—"}</span></li>
                </ul>
              </div>
            </div>
            
            <RankingsGrid closers={data.rankingClosers} sdrs={data.rankingSdrs} />
            <div ref={chartsRef}>
              <ChartsGrid data={data} />
            </div>
            <LeadsDetailTable leads={data.leads} />
          </div>
        )}
      </div>
    </div>
  );
}

