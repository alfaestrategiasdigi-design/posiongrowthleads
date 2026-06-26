import WhatsAppChat from "@/pages/admin/WhatsAppChat";
import { useTenant } from "@/hooks/useTenant";
import { Loader2 } from "lucide-react";

export default function TenantWhatsApp() {
  const { tenant, loading } = useTenant();

  if (loading || !tenant) {
    return (
      <div className="h-full min-h-[60vh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <WhatsAppChat
      tenantId={tenant.id}
      tenantSlug={tenant.slug}
      tenantName={tenant.name}
    />
  );
}