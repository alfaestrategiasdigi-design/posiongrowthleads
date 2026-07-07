import { useMemo, useRef, useState } from "react";
import { format, subDays } from "date-fns";
import { Loader2, FileDown, FileSpreadsheet, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRelatorioData } from "@/hooks/useRelatorioData";
import FiltersBar from "./FiltersBar";
import KpiSummary from "./KpiSummary";
import FunilVisual from "./FunilVisual";
import ChartsGrid from "./ChartsGrid";
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
    tenantIds: [], campaigns: [], forms: [], ownerIds: [], adAccountIds: [], origem: "all",
  });
  const [exportingPdf, setExportingPdf] = useState(false);
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
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-accent/90 border border-accent/30 bg-accent/5 px-2.5 py-1 rounded-full mb-2">
            <Sparkles className="w-3 h-3" /> Relatório Consolidado
          </span>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Relatórios</h1>
          <p className="text-muted-foreground text-sm">{scopeLabel} · {periodLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-2" disabled={!data || !data.leads.length}
            onClick={() => data && exportLeadsCsv(data.leads, scopeLabel)}>
            <FileSpreadsheet className="w-4 h-4" /> CSV
          </Button>
          <Button size="sm" className="gap-2" disabled={!data || exportingPdf} onClick={handlePdf}>
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
        <div className="card-elevated p-6 text-sm text-rose-400">
          Erro carregando relatório: {String((error as any).message || error)}
        </div>
      )}

      {data && !isLoading && (
        <>
          <KpiSummary kpis={data.kpis} />
          <FunilVisual funil={data.funil} />
          <div ref={chartsRef}>
            <ChartsGrid data={data} />
          </div>
          <LeadsDetailTable leads={data.leads} />
        </>
      )}
    </div>
  );
}
