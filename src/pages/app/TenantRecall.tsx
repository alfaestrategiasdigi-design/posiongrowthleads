import AutomationsPage from "@/pages/AutomationsPage";
import { useTenant } from "@/hooks/useTenant";
import { Loader2 } from "lucide-react";

export default function TenantRecall() {
  const { tenant, loading } = useTenant();
  if (loading || !tenant) {
    return <div className="p-12 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }
  return <AutomationsPage scope={{ tenantId: tenant.id, isAdminMaster: false }} />;
}
