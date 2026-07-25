import { useTenant } from "@/hooks/useTenant";
import RelatoriosContainer from "@/components/relatorios/RelatoriosContainer";
import OriginConversionReport from "@/components/relatorios/OriginConversionReport";
import { Loader2 } from "lucide-react";

export default function TenantRelatorios() {
  const { tenant, loading } = useTenant();
  if (loading) return <div className="flex items-center justify-center h-full p-12"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
  if (!tenant) return null;
  return (
    <div className="space-y-6">
      <RelatoriosContainer scope="tenant" currentTenantId={tenant.id} scopeLabel={tenant.name} />
      <div className="px-4 md:px-6 lg:px-8 pb-8">
        <OriginConversionReport tenantId={tenant.id} />
      </div>
    </div>
  );
}
