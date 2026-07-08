import { useQuery } from "@tanstack/react-query";
import { fetchRelatorio, fetchFilterOptions } from "@/lib/relatorios/queries";
import { buildRelatorioData } from "@/lib/relatorios/aggregators";
import type { RelatorioFilters, Scope } from "@/lib/relatorios/types";

export function useRelatorioData(filters: RelatorioFilters, scope: Scope, currentTenantId: string | null) {
  return useQuery({
    queryKey: ["relatorio", scope, currentTenantId, filters],
    queryFn: async () => {
      const [{ leads, appointments, insights, spend, sales, goals }, opts] = await Promise.all([
        fetchRelatorio(filters, scope, currentTenantId),
        fetchFilterOptions(scope, currentTenantId),
      ]);
      return buildRelatorioData(filters, leads, appointments, insights, spend, sales, goals, opts.tenants);
    },
    staleTime: 30_000,
  });
}
