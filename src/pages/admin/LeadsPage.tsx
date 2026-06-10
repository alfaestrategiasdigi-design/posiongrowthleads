import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Search, Download, Loader2, Phone, Mail, Building2, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import LeadDetailModal from "@/components/admin/LeadDetailModal";
import type { Lead } from "@/types/admin";

const statusLabels: Record<string, { label: string; color: string }> = {
  novo: { label: "Novo", color: "bg-blue-500/10 text-blue-400" },
  em_contato: { label: "Em Contato", color: "bg-amber-500/10 text-amber-400" },
  negociando: { label: "Negociando", color: "bg-purple-500/10 text-purple-400" },
  convertido: { label: "Convertido", color: "bg-green-500/10 text-green-400" },
  perdido: { label: "Perdido", color: "bg-red-500/10 text-red-400" },
};

const LeadsPage = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from("leads").select("*").order("created_at", { ascending: false });
      setLeads(data || []);
      setLoading(false);
    };
    load();
  }, []);

  const filtered = leads.filter(l =>
    !searchQuery ||
    l.nome_completo.toLowerCase().includes(searchQuery.toLowerCase()) ||
    l.whatsapp.includes(searchQuery) ||
    (l.nome_empresa || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (l.cidade_estado || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleExportCSV = () => {
    if (filtered.length === 0) return;
    const headers = ["Responsável","WhatsApp","E-mail","Clínica","CNPJ","Cidade","Especialidade","Nº Profissionais","Investiu Tráfego","Faturamento","Status","Data"];
    const csv = [headers.join(";"), ...filtered.map(l => [l.nome_completo, l.whatsapp, l.email||"", l.nome_empresa||"", l.cnpj||"", l.cidade_estado||"", l.especialidade||"", l.num_profissionais||"", l.investiu_trafego||"", l.faturamento_mensal||"", l.status, new Date(l.created_at).toLocaleString("pt-BR")].join(";"))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `leads-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Leads</h1>
          <p className="text-muted-foreground text-sm">{leads.length} leads cadastrados</p>
        </div>
        <Button variant="outline" onClick={handleExportCSV} disabled={filtered.length === 0} className="gap-2 text-sm">
          <Download className="w-4 h-4" /> Exportar
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input placeholder="Buscar por nome, telefone, empresa..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 bg-muted/50 border-border" />
      </div>

      <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Nome</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Contato</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Clínica</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Cidade</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Especialidade</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Faturamento</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Tráfego</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Status</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Data</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => {
                const st = statusLabels[lead.status] || statusLabels.novo;
                return (
                  <tr key={lead.id} onClick={() => setSelectedLead(lead)} className="border-b border-border/30 hover:bg-muted/20 cursor-pointer transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center">
                          <span className="text-xs font-bold text-accent">{lead.nome_completo.charAt(0)}</span>
                        </div>
                        <span className="text-sm font-medium text-foreground">{lead.nome_completo}</span>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="space-y-1">
                        <p className="text-sm text-foreground flex items-center gap-1"><Phone className="w-3 h-3" /> {lead.whatsapp}</p>
                        {lead.email && <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="w-3 h-3" /> {lead.email}</p>}
                      </div>
                    </td>
                    <td className="p-4">
                      {lead.nome_empresa && <p className="text-sm text-foreground flex items-center gap-1"><Building2 className="w-3 h-3" /> {lead.nome_empresa}</p>}
                    </td>
                    <td className="p-4">
                      {lead.cidade_estado && <p className="text-sm text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" /> {lead.cidade_estado}</p>}
                    </td>
                    <td className="p-4">
                      {lead.especialidade && <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium">{lead.especialidade}</span>}
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-muted-foreground">{lead.faturamento_mensal || "—"}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-muted-foreground">{lead.investiu_trafego || "—"}</span>
                    </td>
                    <td className="p-4">
                      <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${st.color}`}>{st.label}</span>
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-muted-foreground">{format(new Date(lead.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}</span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-muted-foreground text-sm">Nenhum lead encontrado</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LeadDetailModal lead={selectedLead} open={!!selectedLead} onClose={() => setSelectedLead(null)} />
    </div>
  );
};

export default LeadsPage;
