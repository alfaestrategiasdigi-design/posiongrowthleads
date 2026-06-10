import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Download, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import KanbanBoard from "@/components/admin/KanbanBoard";
import type { Lead } from "@/types/admin";

const KanbanPage = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadLeads(); }, []);

  const loadLeads = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
    if (error) { toast.error("Erro ao carregar leads"); }
    else { setLeads(data || []); }
    setLoading(false);
  };

  const handleExportCSV = () => {
    if (leads.length === 0) return;
    const headers = ["Responsável","WhatsApp","E-mail","Clínica","CNPJ","Cidade/Estado","Especialidade","Nº Profissionais","Investiu Tráfego","Faturamento","Status","Data"];
    const csvContent = [
      headers.join(";"),
      ...leads.map(l => [l.nome_completo, l.whatsapp, l.email||"", l.nome_empresa||"", l.cnpj||"", l.cidade_estado||"", l.especialidade||"", l.num_profissionais||"", l.investiu_trafego||"", l.faturamento_mensal||"", l.status, new Date(l.created_at).toLocaleString("pt-BR")].join(";"))
    ].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `leads-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  const handleClearLeads = async () => {
    if (!confirm("Tem certeza que deseja excluir todos os leads?")) return;
    const { error } = await supabase.from("leads").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) toast.error("Erro ao excluir leads");
    else { setLeads([]); toast.success("Leads excluídos"); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Kanban</h1>
          <p className="text-muted-foreground text-sm">Gerencie o funil de vendas</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCSV} disabled={leads.length === 0} className="gap-2 text-sm">
            <Download className="w-4 h-4" /> CSV
          </Button>
          <Button variant="destructive" onClick={handleClearLeads} disabled={leads.length === 0} className="gap-2 text-sm">
            <Trash2 className="w-4 h-4" /> Limpar
          </Button>
        </div>
      </div>
      <KanbanBoard leads={leads} onLeadsChange={loadLeads} />
    </div>
  );
};

export default KanbanPage;
