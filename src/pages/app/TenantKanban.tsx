import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import KanbanBoard from "@/components/admin/KanbanBoard";
import type { Lead } from "@/types/admin";

export default function TenantKanban() {
  const { tenant } = useTenant();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const loadLeads = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false });
    if (error) toast.error("Erro ao carregar leads");
    else setLeads((data || []) as Lead[]);
    setLoading(false);
  };

  useEffect(() => { loadLeads(); /* eslint-disable-next-line */ }, [tenant?.id]);

  useEffect(() => {
    if (!tenant?.id) return;
    const ch = supabase
      .channel(`kanban_leads_${tenant.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `tenant_id=eq.${tenant.id}` },
        () => loadLeads()
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [tenant?.id]);

  const handleExportCSV = () => {
    if (leads.length === 0) return;
    const headers = ["Nome", "WhatsApp", "E-mail", "Cidade/Estado", "Origem", "Formulário", "Campanha", "Valor Proposta", "Status", "Data"];
    const rows = leads.map(l => [
      l.nome_completo, l.whatsapp, l.email || "", l.cidade_estado || "",
      l.origem || "", (l as any).facebook_form_name || "", l.facebook_campaign || "",
      l.valor_proposta ?? "", l.status, new Date(l.created_at).toLocaleString("pt-BR"),
    ].join(";"));
    const blob = new Blob([[headers.join(";"), ...rows].join("\n")], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `leads-${tenant?.slug ?? "tenant"}-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  if (!tenant || loading) {
    return <div className="p-8 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1800px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kanban de Leads</h1>
          <p className="text-muted-foreground">
            {leads.length} leads · arraste cards entre etapas
          </p>
        </div>
        <Button variant="outline" onClick={handleExportCSV} disabled={leads.length === 0} className="gap-2 text-sm">
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
      </div>

      <KanbanBoard leads={leads} onLeadsChange={loadLeads} />
    </div>
  );
}
