import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";

export default function TenantAgenda() {
  const { tenant } = useTenant();
  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Agenda</h1>
        <p className="text-muted-foreground">{tenant?.name}</p>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base flex items-center gap-2"><Calendar className="w-4 h-4 text-primary" /> Agendamentos da clínica</CardTitle></CardHeader>
        <CardContent className="py-12 text-center text-muted-foreground">
          <p>Em breve: agenda integrada com o funil e com lembretes via WhatsApp.</p>
        </CardContent>
      </Card>
    </div>
  );
}
