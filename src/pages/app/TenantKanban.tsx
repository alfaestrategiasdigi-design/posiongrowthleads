import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Download, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import KanbanBoard from "@/components/admin/KanbanBoard";
import type { Lead } from "@/types/admin";

const RANGE_OPTIONS: { label: string; days: number | null }[] = [
  { label: "Hoje", days: 1 },
  { label: "7 dias", days: 7 },
  { label: "30 dias", days: 30 },
  { label: "90 dias", days: 90 },
  { label: "Tudo", days: null },
];

export default function TenantKanban() {
  const { tenant } = useTenant();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [rangeDays, setRangeDays] = useState<number | null>(null);
  const [nextAppt, setNextAppt] = useState<Record<string, string>>({});

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

  const loadNextAppointments = async () => {
    if (!tenant?.id) return;
    const { data } = await supabase
      .from("appointments")
      .select("lead_id, date_time, status")
      .eq("tenant_id", tenant.id)
      .not("lead_id", "is", null)
      .gte("date_time", new Date().toISOString())
      .not("status", "in", "(cancelado,no_show)")
      .order("date_time", { ascending: true });
    const map: Record<string, string> = {};
    (data || []).forEach((a: any) => {
      if (a.lead_id && !map[a.lead_id]) map[a.lead_id] = a.date_time;
    });
    setNextAppt(map);
  };

  useEffect(() => { loadLeads(); loadNextAppointments(); /* eslint-disable-next-line */ }, [tenant?.id]);

  useEffect(() => {
    if (!tenant?.id) return;
    const ch = supabase
      .channel(`kanban_sync_${tenant.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `tenant_id=eq.${tenant.id}` },
        () => loadLeads()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "appointments", filter: `tenant_id=eq.${tenant.id}` },
        () => { loadNextAppointments(); loadLeads(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [tenant?.id]);

  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cutoff = rangeDays != null ? Date.now() - rangeDays * 24 * 60 * 60 * 1000 : null;
    return leads.filter((l) => {
      if (cutoff != null) {
        const t = new Date(l.created_at).getTime();
        if (!isFinite(t) || t < cutoff) return false;
      }
      if (q) {
        const hay = [
          l.nome_completo, l.whatsapp, l.email, l.cidade_estado,
          l.origem, (l as any).facebook_form_name, l.facebook_campaign,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, search, rangeDays]);

  const handleExportCSV = () => {
    if (filteredLeads.length === 0) return;
    const headers = ["Nome", "WhatsApp", "E-mail", "Cidade/Estado", "Origem", "Formulário", "Campanha", "Valor Proposta", "Status", "Data"];
    const rows = filteredLeads.map(l => [
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

  const filtersActive = search.trim().length > 0 || rangeDays != null;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1800px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kanban de Leads</h1>
          <p className="text-muted-foreground">
            {filtersActive ? `${filteredLeads.length} de ${leads.length} leads` : `${leads.length} leads`} · arraste cards entre etapas
          </p>
        </div>
        <Button variant="outline" onClick={handleExportCSV} disabled={filteredLeads.length === 0} className="gap-2 text-sm">
          <Download className="w-4 h-4" /> Exportar CSV
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome, WhatsApp, e-mail, campanha…"
            className="pl-9 pr-9 h-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
              aria-label="Limpar busca"
            >
              <X className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {RANGE_OPTIONS.map((opt) => {
            const active = rangeDays === opt.days;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setRangeDays(opt.days)}
                className={`px-3 h-9 rounded-md border text-xs font-medium transition ${
                  active
                    ? "bg-amber-400/15 border-amber-400/50 text-amber-300"
                    : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-amber-400/30"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <KanbanBoard leads={filteredLeads} onLeadsChange={() => { loadLeads(); loadNextAppointments(); }} nextAppointmentByLead={nextAppt} />
    </div>
  );
}
