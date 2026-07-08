import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import {
  Search, Download, Loader2, Phone, Mail, Building2, MapPin, Facebook,
  Sparkles, Users, CheckCircle2, Trophy, Flame, Filter, RefreshCw, ShieldAlert,
  Kanban as KanbanIcon, FileText, Calendar as CalendarIcon, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import LeadDetailModal from "@/components/admin/LeadDetailModal";
import LeadsReportModal from "@/components/leads/LeadsReportModal";
import type { Lead } from "@/types/admin";
import { toast } from "sonner";

const statusLabels: Record<string, { label: string; color: string; dot: string }> = {
  lead:             { label: "Lead",            color: "bg-slate-500/10 text-slate-300 border-slate-500/30",       dot: "bg-slate-400" },
  qualificado:      { label: "Qualificado",     color: "bg-sky-500/10 text-sky-300 border-sky-500/30",             dot: "bg-sky-400" },
  reuniao_agendada: { label: "R. Agendada",     color: "bg-indigo-500/10 text-indigo-300 border-indigo-500/30",    dot: "bg-indigo-400" },
  compareceu:       { label: "Compareceu",      color: "bg-violet-500/10 text-violet-300 border-violet-500/30",    dot: "bg-violet-400" },
  negociacao:       { label: "Negociação",      color: "bg-amber-500/10 text-amber-300 border-amber-500/30",       dot: "bg-amber-400" },
  ganho:            { label: "Ganho",           color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-400" },
  perdido:          { label: "Perdido",         color: "bg-rose-500/10 text-rose-300 border-rose-500/30",          dot: "bg-rose-400" },
  no_show:          { label: "No-show",         color: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",          dot: "bg-zinc-400" },
};

const QUALIFIED = ["qualificado","reuniao_agendada","compareceu","negociacao"];
const WON = ["ganho"];

export default function TenantLeads() {
  const { tenant } = useTenant();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [originFilter, setOriginFilter] = useState<string>("all");
  const [formFilter, setFormFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [showReport, setShowReport] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [accessDenied, setAccessDenied] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    if (!tenant?.id) return;
    setLoading(true);

    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) { setAccessDenied(true); setLoading(false); return; }
    const { data: canAccess, error: accErr } = await supabase.rpc("has_tenant_access", {
      _user_id: uid, _tenant_id: tenant.id,
    });
    if (accErr || canAccess !== true) {
      setAccessDenied(true); setLeads([]); setLoading(false);
      return;
    }
    setAccessDenied(false);

    // Whitelist explícita: nunca traga campos de prospecção B2B (nome_empresa,
    // cnpj, faturamento_mensal, num_profissionais, investiu_trafego, especialidade)
    // para o painel do dono da clínica. Filtragem no backend evita exposição
    // acidental via devtools/network mesmo que o front esconda visualmente.
    const TENANT_LEAD_COLUMNS = [
      "id","tenant_id","created_at","status","origem",
      "nome_completo","whatsapp","email","cidade_estado",
      "observacoes","valor_proposta","tipo_purchase",
      "sdr_qualification","extras",
      "facebook_form_id","facebook_form_name","facebook_campaign",
      "utm_source","utm_medium","utm_campaign",
      "mql","sql_qualified",
      "reuniao_agendada_em","reuniao_realizada_em","proposta_enviada_em","fechado_em","motivo_perda",
    ].join(",");

    const { data } = await supabase
      .from("leads")
      .select(TENANT_LEAD_COLUMNS)
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false });
    const clean = (data ?? []).filter((r: any) => r?.tenant_id === tenant.id);
    setLeads(clean as unknown as Lead[]);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tenant?.id]);

  // Realtime: novos leads roteados para este tenant
  useEffect(() => {
    if (!tenant?.id) return;
    const ch = supabase
      .channel(`tenant_leads_${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `tenant_id=eq.${tenant.id}` },
        () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [tenant?.id]);

  async function syncSources() {
    if (!tenant?.id || syncing) return;
    setSyncing(true);
    try {
      const fb = await supabase.functions.invoke("facebook-backfill-leads", {
        body: { tenant_id: tenant.id, max_per_form: 1000 },
      });
      const fbErr = (fb as any)?.error?.message ?? (fb as any)?.data?.error;
      if (fbErr) {
        toast.warning("Sincronização parcial", { description: `Meta: ${fbErr}` });
      } else {
        const t = (fb as any)?.data?.totals;
        toast.success("Leads sincronizados", {
          description: t ? `${t.imported} novos · ${t.deduped} já existiam` : "Fontes atualizadas",
        });
      }
      await load();
    } catch (e: any) {
      toast.error("Falha ao sincronizar", { description: e?.message ?? String(e) });
    } finally {
      setSyncing(false);
    }
  }

  const fbSummary = useMemo(() => {
    const fb = leads.filter(l => l.origem === "facebook_ads");
    const byForm = new Map<string, { id: string; name: string; count: number }>();
    const byStatus: Record<string, number> = {};
    for (const l of fb) {
      const id = (l as any).facebook_form_id || "(sem form)";
      const name = (l as any).facebook_form_name || id;
      const cur = byForm.get(id) || { id, name, count: 0 };
      cur.count += 1;
      byForm.set(id, cur);
      byStatus[l.status] = (byStatus[l.status] || 0) + 1;
    }
    return {
      total: fb.length,
      forms: Array.from(byForm.values()).sort((a, b) => b.count - a.count),
      statuses: Object.entries(byStatus).sort((a, b) => b[1] - a[1]),
    };
  }, [leads]);

  const kpis = useMemo(() => {
    const total = leads.length;
    const fb = leads.filter(l => l.origem === "facebook_ads").length;
    const qual = leads.filter(l => QUALIFIED.includes(l.status)).length;
    const won = leads.filter(l => WON.includes(l.status)).length;
    const novos24h = leads.filter(l => Date.now() - new Date(l.created_at).getTime() < 86400000).length;
    return { total, fb, qual, won, novos24h, convRate: total ? (won / total) * 100 : 0 };
  }, [leads]);

  const origins = useMemo(() => {
    const set = new Set<string>();
    leads.forEach(l => set.add(l.origem || "outro"));
    return Array.from(set);
  }, [leads]);

  const filtered = leads.filter(l => {
    if (statusFilter !== "all" && l.status !== statusFilter) return false;
    if (originFilter !== "all" && (l.origem || "outro") !== originFilter) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (l.nome_completo || "").toLowerCase().includes(q) ||
      (l.whatsapp || "").includes(searchQuery) ||
      (l.nome_empresa || "").toLowerCase().includes(q) ||
      (l.cidade_estado || "").toLowerCase().includes(q) ||
      (l.email || "").toLowerCase().includes(q)
    );
  });

  const handleExportCSV = () => {
    if (filtered.length === 0) return;

    // Coletar todas as chaves de form_data entre os leads
    const formKeys = new Set<string>();
    filtered.forEach(l => {
      const fd = (l as any).form_data;
      if (fd && typeof fd === "object" && !Array.isArray(fd)) {
        Object.keys(fd).forEach(k => formKeys.add(k));
      }
    });
    const formKeysArray = Array.from(formKeys);

    const baseHeaders = ["Nome","WhatsApp","E-mail","Status","Origem","Formulário","UTM Campaign","Data"];
    const allHeaders = [...baseHeaders, ...formKeysArray];

    const rows = filtered.map(l => {
      const any = l as any;
      const formName = any.facebook_form_name || any.facebook_form_id || "";
      const base = [
        l.nome_completo || "",
        l.whatsapp || "",
        l.email || "",
        l.status || "",
        any.source || any.origem || "",
        formName,
        any.utm_campaign || "",
        l.created_at ? new Date(l.created_at).toLocaleString("pt-BR") : "",
      ];
      const fd = any.form_data;
      const formValues = formKeysArray.map(key => {
        const v = fd && typeof fd === "object" ? fd[key] : undefined;
        if (v === undefined || v === null) return "";
        return typeof v === "object" ? JSON.stringify(v) : String(v);
      });
      return [...base, ...formValues];
    });

    const escape = (cell: unknown) => `"${String(cell ?? "").replace(/"/g, '""')}"`;
    const BOM = "\uFEFF";
    const csv = BOM + [allHeaders, ...rows].map(r => r.map(escape).join(";")).join("\r\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `leads-${tenant?.slug}-${new Date().toISOString().split("T")[0]}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (!tenant) return null;
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }
  if (accessDenied) {
    return (
      <div className="p-8 max-w-lg mx-auto">
        <div className="card-elevated border border-rose-500/30 p-6 text-center space-y-2">
          <ShieldAlert className="w-10 h-10 text-rose-400 mx-auto" />
          <h2 className="text-xl font-bold">Acesso negado</h2>
          <p className="text-sm text-muted-foreground">
            Você não tem permissão para visualizar os leads de <b>{tenant.name}</b>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-accent/90 border border-accent/30 bg-accent/5 px-2.5 py-1 rounded-full">
              <Sparkles className="w-3 h-3" /> CRM · {tenant.name}
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Leads</h1>
          <p className="text-muted-foreground text-sm">
            {leads.length} leads no tenant · {filtered.length} visíveis após filtros
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="outline" onClick={syncSources} disabled={syncing} className="gap-2 text-sm rounded-full">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Sincronizar
          </Button>
          <Button variant="outline" asChild className="gap-2 text-sm rounded-full">
            <Link to={`/app/${tenant.slug}/kanban`}><KanbanIcon className="w-4 h-4" /> Kanban</Link>
          </Button>
          <Button variant="outline" onClick={handleExportCSV} disabled={filtered.length === 0} className="gap-2 text-sm rounded-full">
            <Download className="w-4 h-4" /> Exportar CSV
          </Button>
        </div>
      </div>

      {/* KPI Tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <KpiTile icon={Users} label="Total" value={kpis.total} accent="sky" sub="no tenant" />
        <KpiTile icon={Flame} label="Últ. 24h" value={kpis.novos24h} accent="rose" sub="novos leads" />
        <KpiTile icon={Facebook} label="Facebook Ads" value={kpis.fb} accent="gold" sub={`${kpis.total ? Math.round(kpis.fb/kpis.total*100):0}% do total`} />
        <KpiTile icon={CheckCircle2} label="Qualificados" value={kpis.qual} accent="emerald" sub="MQL → Negociação" />
        <KpiTile icon={Trophy} label="Ganhos" value={kpis.won} accent="emerald" sub={`${kpis.convRate.toFixed(1)}% conversão`} />
      </div>

      {/* Resumo Facebook Ads */}
      {fbSummary.total > 0 && (
        <div className="card-elevated p-6">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80 flex items-center gap-1.5">
                <Facebook className="w-3 h-3" /> Origem Facebook Ads
              </p>
              <h3 className="font-display text-lg text-foreground normal-case tracking-normal">
                {fbSummary.total} leads importados
              </h3>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Por formulário</p>
              <div className="space-y-2">
                {fbSummary.forms.slice(0, 6).map(f => {
                  const pct = (f.count / fbSummary.total) * 100;
                  return (
                    <div key={f.id} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-foreground" title={f.id}>{f.name}</span>
                        <span className="font-bold text-accent tabular-nums">{f.count}</span>
                      </div>
                      <div className="h-1.5 bg-card/60 rounded-full overflow-hidden">
                        <div className="h-full gradient-accent rounded-full" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-3">Por status</p>
              <div className="space-y-2">
                {fbSummary.statuses.map(([st, ct]) => {
                  const meta = statusLabels[st] ?? { label: st, color: "bg-muted text-muted-foreground border-border", dot: "bg-muted-foreground" };
                  const pct = (ct / fbSummary.total) * 100;
                  return (
                    <div key={st} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className={`px-2 py-0.5 rounded-full font-medium border ${meta.color}`}>{meta.label}</span>
                        <span className="font-bold tabular-nums text-foreground">{ct}</span>
                      </div>
                      <div className="h-1.5 bg-card/60 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${meta.dot}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="card-elevated p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome, telefone, e-mail, empresa..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 bg-card/40 border-border/60 rounded-full"
          />
        </div>
        <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-full px-3 py-1.5">
          <Filter className="w-3.5 h-3.5 text-accent" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-transparent text-xs text-foreground focus:outline-none cursor-pointer"
          >
            <option value="all">Todos status</option>
            {Object.entries(statusLabels).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 bg-card/40 border border-border/60 rounded-full px-3 py-1.5">
          <Filter className="w-3.5 h-3.5 text-accent" />
          <select
            value={originFilter}
            onChange={e => setOriginFilter(e.target.value)}
            className="bg-transparent text-xs text-foreground focus:outline-none cursor-pointer"
          >
            <option value="all">Todas origens</option>
            {origins.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      </div>

      {/* Tabela */}
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/60 bg-card/40">
                <th className="text-left text-[10px] uppercase tracking-[0.18em] font-medium text-muted-foreground p-4">Nome</th>
                <th className="text-left text-[10px] uppercase tracking-[0.18em] font-medium text-muted-foreground p-4">Contato</th>
                <th className="text-left text-[10px] uppercase tracking-[0.18em] font-medium text-muted-foreground p-4">Cidade</th>
                <th className="text-left text-[10px] uppercase tracking-[0.18em] font-medium text-muted-foreground p-4">Formulário</th>
                <th className="text-left text-[10px] uppercase tracking-[0.18em] font-medium text-muted-foreground p-4">Status</th>
                <th className="text-left text-[10px] uppercase tracking-[0.18em] font-medium text-muted-foreground p-4">Data</th>
              </tr>

            </thead>
            <tbody>
              {filtered.map(lead => {
                const st = statusLabels[lead.status] || statusLabels.lead;
                const formName = (lead as any).facebook_form_name || (lead as any).facebook_form_id;
                return (
                  <tr key={lead.id} onClick={() => setSelectedLead(lead)} className="border-b border-border/30 hover:bg-accent/5 cursor-pointer transition-colors group">
                    <td className="p-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full gradient-accent flex items-center justify-center shadow-md ring-1 ring-accent/30">
                          <span className="text-sm font-bold text-[hsl(232_65%_5%)]">{(lead.nome_completo || "?").charAt(0).toUpperCase()}</span>
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{lead.nome_completo || "—"}</p>
                          {lead.origem === "facebook_ads" && (
                            <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Facebook className="w-2.5 h-2.5 text-sky-400" /> Facebook Ads
                            </p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="p-4">
                      <div className="space-y-1">
                        {lead.whatsapp && <p className="text-sm text-foreground flex items-center gap-1.5"><Phone className="w-3 h-3 text-accent/70" /> {lead.whatsapp}</p>}
                        {lead.email && <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail className="w-3 h-3" /> {lead.email}</p>}
                      </div>
                    </td>
                    <td className="p-4">
                      {lead.cidade_estado && <p className="text-sm text-muted-foreground flex items-center gap-1.5"><MapPin className="w-3 h-3" /> {lead.cidade_estado}</p>}
                    </td>

                    <td className="p-4">
                      {formName && <span className="text-xs text-muted-foreground truncate max-w-[160px] inline-block" title={formName}>{formName}</span>}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${st.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                        {st.label}
                      </span>
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-muted-foreground tabular-nums">{format(new Date(lead.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}</span>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={6} className="p-12 text-center text-muted-foreground text-sm">Nenhum lead encontrado. Clique em <b>Sincronizar</b> para importar dos formulários vinculados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <LeadDetailModal lead={selectedLead} open={!!selectedLead} onClose={() => setSelectedLead(null)} onUpdated={load} />
    </div>
  );
}

/* ---------- KPI Tile ---------- */
type Accent = "sky" | "gold" | "emerald" | "rose" | "violet";
const ACCENT_MAP: Record<Accent, { ring: string; text: string; glow: string }> = {
  sky:     { ring: "ring-sky-500/20",     text: "text-sky-300",     glow: "from-sky-500/20 to-transparent" },
  gold:    { ring: "ring-amber-500/20",   text: "text-amber-300",   glow: "from-amber-500/20 to-transparent" },
  emerald: { ring: "ring-emerald-500/20", text: "text-emerald-300", glow: "from-emerald-500/20 to-transparent" },
  rose:    { ring: "ring-rose-500/20",    text: "text-rose-300",    glow: "from-rose-500/20 to-transparent" },
  violet:  { ring: "ring-violet-500/20",  text: "text-violet-300",  glow: "from-violet-500/20 to-transparent" },
};

const KpiTile = ({
  icon: Icon, label, value, sub, accent = "sky",
}: { icon: any; label: string; value: number; sub?: string; accent?: Accent }) => {
  const a = ACCENT_MAP[accent];
  return (
    <div className={`card-elevated relative overflow-hidden p-4 ring-1 ${a.ring}`}>
      <div className={`absolute -top-12 -right-12 w-32 h-32 rounded-full bg-gradient-to-br ${a.glow} blur-2xl pointer-events-none`} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
          <p className={`text-2xl font-bold tabular-nums mt-1 ${a.text}`}>{value.toLocaleString("pt-BR")}</p>
          {sub && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</p>}
        </div>
        <div className={`w-9 h-9 rounded-lg bg-card/60 border border-border/60 flex items-center justify-center ${a.text}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  );
};
