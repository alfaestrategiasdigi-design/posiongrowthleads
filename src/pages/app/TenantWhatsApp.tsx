import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle } from "lucide-react";

export default function TenantWhatsApp() {
  const { tenant } = useTenant();
  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Central WhatsApp</h1>
        <p className="text-muted-foreground">{tenant?.name}</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><MessageCircle className="w-4 h-4 text-primary" /> Conversas</CardTitle></CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p>Conecte sua API do WhatsApp em <strong>Configurações</strong> para começar a receber e enviar mensagens por aqui.</p>
        </CardContent>
      </Card>
    </div>
  );
}
