import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { PIPELINE_STAGES, type PipelineStage } from "@/types/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Loader2, Search, Filter, Download, MessageCircle, Phone, Globe2,
  Users as UsersIcon, Kanban as KanbanIcon, Calendar, Flame, Trophy, Sparkles, X,
} from "lucide-react";
import { toast } from "sonner";

type ClinicLead = {
  id: string;
  tenant_id: string;
  full_name: string;
  whatsapp: string | null;
  email: string | null;
  channel: string | null;
  seller_name: string | null;
  procedure_interest: string | null;
  product: string | null;
  stage: PipelineStage;
  sale_amount: number | null;
  negotiation_value: number | null;
  notes: string | null;
  international: boolean;
  first_contact_date: string | null;
  last_contact_at: string | null;
  contact_count: number | null;
  created_at: string;
  responsible_user_id: string | null;
  facebook_campaign_id: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  lead_type: string | null;
  metadata: any;
};

type Seller = { id: string; name: string };

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
const fmtDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

const stageInfo = (id: string) => PIPELINE_STAGES.find(s => s.id === id) ?? PIPELINE_STAGES[0];

function whatsappLink(phone?: string | null) {
  if (!phone) return null;
  const digits = phone.replace(/\D+/g, "");
  if (digits.length < 8) return null;
  return `https://wa.me/${digits.startsWith("55") ? digits : "55" + digits}`;
}

const RANGES: { id: string; label: string; days: number }[] = [
  { id: "7", label: "7 dias", days: 7 },
  { id: "30", label: "30 dias", days: 30 },
  { id: "90", label: "90 dias", days: 90 },
  { id: "all", label: "Tudo", days: 10000 },
];

export default function TenantLeads() {
  const { tenant } = useTenant();
  const [leads, setLeads] = useState<ClinicLead[]>([]);
  const [sellers, setSellers] = useState<Seller[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stageF, setStageF] = useState<string>("all");
  const [sellerF, setSellerF] = useState<string>("all");
  const [channelF, setChannelF] = useState<string>("all");
  const [productF, setProductF] = useState<string>("all");
  const [rangeId, setRangeId] = useState<string>("30");
  const [detail, setDetail] = useState<ClinicLead | null>(null);

  function mapRow(r: any): ClinicLead {
    const ex = (r.extras ?? {}) as any;
    const originRaw = String(r.origem ?? "").toLowerCase();
    const channel =
      originRaw.includes("facebook") ? "Facebook Ads" :
      originRaw.includes("whatsapp") ? "WhatsApp" :
      originRaw === "site" ? "Site" :
      r.origem ?? null;
    return {
      id: r.id,
      tenant_id: r.tenant_id,
      full_name: r.nome_completo ?? "—",
      whatsapp: r.whatsapp ?? null,
      email: r.email ?? null,
      channel,
      seller_name: ex.seller_name ?? null,
      procedure_interest: r.especialidade ?? null,
      product: ex.product ?? r.facebook_form_name ?? null,
      stage: (r.status ?? "lead") as PipelineStage,
      sale_amount: r.status === "ganho" ? Number(r.valor_proposta ?? 0) : null,
      negotiation_value: r.valor_proposta != null ? Number(r.valor_proposta) : null,
      notes: r.observacoes ?? null,
      international: false,
      first_contact_date: null,
      last_contact_at: ex.last_contact_at ?? null,
      contact_count: ex.contact_count ?? null,
      created_at: r.created_at,
      responsible_user_id: null,
      facebook_campaign_id: r.facebook_campaign ?? null,
      utm_source: r.utm_source ?? null,
      utm_medium: r.utm_medium ?? null,
      utm_campaign: r.utm_campaign ?? null,
      lead_type: r.origem ?? null,
      metadata: r,
    };
  }

  async function loadAll() {
    if (!tenant?.id) return;
    setLoading(true);
    const [{ data: l }, { data: s }] = await Promise.all([
      supabase.from("leads").select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }),
      supabase.from("sellers").select("id,name").eq("tenant_id", tenant.id).order("name"),
    ]);
    setLeads((l ?? []).map(mapRow));
    setSellers((s ?? []) as Seller[]);
    setLoading(false);
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [tenant?.id]);

  // Realtime updates
  useEffect(() => {
    if (!tenant?.id) return;
    const ch = supabase
      .channel(`tenant_leads_${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `tenant_id=eq.${tenant.id}` },
        () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [tenant?.id]);


  const options = useMemo(() => {
    const sellersSet = new Set<string>(); const channelsSet = new Set<string>(); const productsSet = new Set<string>();
    for (const l of leads) {
      if (l.seller_name) sellersSet.add(l.seller_name);
      if (l.channel) channelsSet.add(l.channel);
      const p = l.product || l.procedure_interest;
      if (p) productsSet.add(p);
    }
    return {
      sellers: Array.from(sellersSet).sort(),
      channels: Array.from(channelsSet).sort(),
      products: Array.from(productsSet).sort(),
    };
  }, [leads]);

  const cutoff = useMemo(() => {
    const r = RANGES.find(r => r.id === rangeId)!;
    return Date.now() - r.days * 86400000;
  }, [rangeId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (new Date(l.created_at).getTime() < cutoff) return false;
      if (stageF !== "all" && l.stage !== stageF) return false;
      if (sellerF !== "all" && l.seller_name !== sellerF) return false;
      if (channelF !== "all" && l.channel !== channelF) return false;
      if (productF !== "all" && (l.product || l.procedure_interest) !== productF) return false;
      if (q) {
        const bag = [l.full_name, l.whatsapp, l.email, l.notes, l.channel, l.seller_name, l.utm_campaign]
          .filter(Boolean).join(" ").toLowerCase();
        if (!bag.includes(q)) return false;
      }
      return true;
    });
  }, [leads, search, stageF, sellerF, channelF, productF, cutoff]);

  const kpis = useMemo(() => {
    const now = Date.now();
    const novos24h = filtered.filter(l => now - new Date(l.created_at).getTime() < 86400000).length;
    const ganho = filtered.filter(l => l.stage === "ganho");
    const revenue = ganho.reduce((a, b) => a + Number(b.sale_amount || b.negotiation_value || 0), 0);
    const pipeline = filtered
      .filter(l => !["ganho", "perdido", "no_show"].includes(l.stage))
      .reduce((a, b) => a + Number(b.negotiation_value || 0), 0);
    return { total: filtered.length, novos24h, wins: ganho.length, revenue, pipeline };
  }, [filtered]);

  const exportCsv = () => {
    const rows = [
      ["Nome","WhatsApp","Email","Etapa","Vendedor","Produto","Canal","Valor","Criado em","UTM Campaign"],
      ...filtered.map(l => [
        l.full_name, l.whatsapp || "", l.email || "", stageInfo(l.stage).title,
        l.seller_name || "", l.product || l.procedure_interest || "", l.channel || "",
        String(l.sale_amount || l.negotiation_value || 0),
        new Date(l.created_at).toISOString(), l.utm_campaign || "",
      ]),
    ];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `leads-${tenant?.slug}-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  async function updateLead(id: string, patch: Partial<ClinicLead>) {
    const prev = leads;
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, ...patch } as ClinicLead : l)));
    if (detail?.id === id) setDetail((d) => (d ? { ...d, ...patch } as ClinicLead : d));

    // Map ClinicLead patch → leads columns
    const dbPatch: Record<string, any> = {};
    if (patch.stage !== undefined) dbPatch.status = patch.stage;
    if (patch.notes !== undefined) dbPatch.observacoes = patch.notes;
    if (patch.negotiation_value !== undefined) dbPatch.valor_proposta = patch.negotiation_value;
    if (patch.sale_amount !== undefined) dbPatch.valor_proposta = patch.sale_amount;
    // extras-backed fields (seller_name, product)
    const needsExtras = patch.seller_name !== undefined || patch.product !== undefined || patch.channel !== undefined;
    if (needsExtras) {
      const cur = leads.find(l => l.id === id);
      const currentExtras = (cur?.metadata?.extras ?? {}) as Record<string, any>;
      const nextExtras = { ...currentExtras };
      if (patch.seller_name !== undefined) nextExtras.seller_name = patch.seller_name ?? null;
      if (patch.product !== undefined) nextExtras.product = patch.product ?? null;
      dbPatch.extras = nextExtras;
    }

    const { error } = await supabase.from("leads").update(dbPatch).eq("id", id);
    if (error) { setLeads(prev); toast.error("Não foi possível salvar", { description: error.message }); }
  }


  if (!tenant) return null;
  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary/80 mb-1">CRM</p>
          <h1 className="text-3xl font-bold tracking-tight font-display flex items-center gap-2">
            <UsersIcon className="w-7 h-7 text-primary" /> Leads
          </h1>
          <p className="text-muted-foreground text-sm">
            {kpis.total} leads no período · filtros por vendedor, canal, etapa e produto
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link to={`/app/${tenant.slug}/kanban`}><KanbanIcon className="w-4 h-4 mr-1" /> Ver Kanban</Link>
          </Button>
          <Button variant="outline" onClick={exportCsv}><Download className="w-4 h-4 mr-1" /> Exportar CSV</Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: "Leads no período", value: kpis.total, icon: UsersIcon, cls: "text-foreground" },
          { label: "Últimas 24h", value: kpis.novos24h, icon: Flame, cls: "text-rose-400" },
          { label: "Ganhos", value: kpis.wins, icon: Trophy, cls: "text-emerald-400" },
          { label: "Receita ganha", value: BRL(kpis.revenue), icon: Sparkles, cls: "text-amber-400" },
          { label: "Pipeline em aberto", value: BRL(kpis.pipeline), icon: Calendar, cls: "text-sky-400" },
        ].map((k) => (
          <Card key={k.label} className="card-elevated">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{k.label}</span>
                <k.icon className={`w-4 h-4 ${k.cls}`} />
              </div>
              <div className={`text-2xl font-bold tabular-nums ${k.cls}`}>{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filtros */}
      <Card className="card-elevated">
        <CardContent className="p-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs mr-1"><Filter className="w-3.5 h-3.5" /> Filtros</div>
          <Select value={rangeId} onValueChange={setRangeId}>
            <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{RANGES.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={stageF} onValueChange={setStageF}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Etapa" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as etapas</SelectItem>
              {PIPELINE_STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sellerF} onValueChange={setSellerF}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Vendedor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os vendedores</SelectItem>
              {options.sellers.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={channelF} onValueChange={setChannelF}>
            <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Canal" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os canais</SelectItem>
              {options.channels.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={productF} onValueChange={setProductF}>
            <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Produto" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os produtos</SelectItem>
              {options.products.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome, WhatsApp, email, campanha…" className="pl-9 h-9" />
          </div>
          {(stageF !== "all" || sellerF !== "all" || channelF !== "all" || productF !== "all" || search) && (
            <Button variant="ghost" size="sm" onClick={() => { setStageF("all"); setSellerF("all"); setChannelF("all"); setProductF("all"); setSearch(""); }}>
              <X className="w-3.5 h-3.5 mr-1" /> Limpar
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card className="card-elevated">
        <CardHeader className="py-3"><CardTitle className="text-sm">{filtered.length} lead(s)</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Etapa</TableHead>
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Criado</TableHead>
                  <TableHead className="text-right w-[130px]">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">Nenhum lead encontrado nesse filtro.</TableCell></TableRow>
                )}
                {filtered.map((l) => {
                  const si = stageInfo(l.stage);
                  const value = Number(l.sale_amount || l.negotiation_value || 0);
                  const wa = whatsappLink(l.whatsapp);
                  return (
                    <TableRow key={l.id} className="cursor-pointer hover:bg-white/[0.02]" onClick={() => setDetail(l)}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
                               style={{ background: `${si.hex}22`, color: si.hex }}>
                            {(l.full_name || "?").trim().slice(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium truncate max-w-[220px] flex items-center gap-1.5">
                              {l.full_name || "—"}
                              {l.international && <Globe2 className="w-3 h-3 text-amber-400" />}
                            </div>
                            <div className="text-[11px] text-muted-foreground flex items-center gap-1">
                              <Phone className="w-3 h-3" />{l.whatsapp || "—"}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" style={{ background: `${si.hex}16`, color: si.hex, borderColor: `${si.hex}44` }}>
                          {si.title}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">{l.seller_name || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm">{l.product || l.procedure_interest || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-sm">{l.channel || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{value > 0 ? BRL(value) : <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-[11px] text-muted-foreground whitespace-nowrap">{fmtDate(l.created_at)}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1">
                          {wa && (
                            <Button size="sm" variant="ghost" asChild>
                              <a href={wa} target="_blank" rel="noreferrer" title="Abrir WhatsApp">
                                <MessageCircle className="w-4 h-4 text-emerald-400" />
                              </a>
                            </Button>
                          )}
                          <Button size="sm" variant="outline" onClick={() => setDetail(l)}>Abrir</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <LeadDrawer
        lead={detail}
        sellers={sellers}
        onClose={() => setDetail(null)}
        onChange={(patch) => detail && updateLead(detail.id, patch)}
      />
    </div>
  );
}

function LeadDrawer({
  lead, sellers, onClose, onChange,
}: {
  lead: ClinicLead | null;
  sellers: Seller[];
  onClose: () => void;
  onChange: (patch: Partial<ClinicLead>) => void;
}) {
  const [notes, setNotes] = useState("");
  const [value, setValue] = useState("");
  useEffect(() => {
    setNotes(lead?.notes ?? "");
    setValue(String(lead?.negotiation_value ?? lead?.sale_amount ?? ""));
  }, [lead?.id]);

  if (!lead) return null;
  const si = stageInfo(lead.stage);
  const wa = whatsappLink(lead.whatsapp);
  const utms = [lead.utm_source, lead.utm_medium, lead.utm_campaign].filter(Boolean);

  return (
    <Sheet open={!!lead} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-xl">{lead.full_name}</SheetTitle>
          <SheetDescription className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" style={{ background: `${si.hex}16`, color: si.hex, borderColor: `${si.hex}44` }}>{si.title}</Badge>
            <span className="text-[11px] text-muted-foreground">Criado em {fmtDateTime(lead.created_at)}</span>
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 mt-5">
          {/* Mini funnel — jornada visual do lead */}
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Jornada no funil</div>
            <div className="flex items-stretch gap-1">
              {PIPELINE_STAGES.map((s, i) => {
                const currentIdx = PIPELINE_STAGES.findIndex(x => x.id === lead.stage);
                const isTerminal = ["perdido", "no_show"].includes(lead.stage);
                const reached = !isTerminal && i <= currentIdx;
                const isCurrent = s.id === lead.stage;
                return (
                  <div
                    key={s.id}
                    className="flex-1 h-8 rounded flex items-center justify-center text-[9px] font-bold uppercase tracking-wider transition-all relative"
                    style={{
                      background: reached ? `${s.hex}22` : "rgba(255,255,255,0.04)",
                      color: reached ? s.hex : "hsl(var(--muted-foreground))",
                      borderBottom: isCurrent ? `2px solid ${s.hex}` : "2px solid transparent",
                      boxShadow: isCurrent ? `0 0 12px ${s.hex}66` : undefined,
                    }}
                    title={s.title}
                  >
                    {isCurrent ? "●" : reached ? "✓" : i + 1}
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-muted-foreground">
              Etapa atual: <span style={{ color: si.hex }} className="font-semibold">{si.title}</span>
              {lead.contact_count ? ` · ${lead.contact_count} interação(ões)` : ""}
            </div>
          </section>

          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Contato</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><div className="text-[11px] text-muted-foreground">WhatsApp</div>{lead.whatsapp || "—"}</div>
              <div><div className="text-[11px] text-muted-foreground">Email</div>{lead.email || "—"}</div>
              <div><div className="text-[11px] text-muted-foreground">Último contato</div>{fmtDateTime(lead.last_contact_at)}</div>
              <div><div className="text-[11px] text-muted-foreground">Interações</div>{lead.contact_count ?? 0}</div>
            </div>
            {wa && (
              <Button asChild className="w-full mt-1"><a href={wa} target="_blank" rel="noreferrer">
                <MessageCircle className="w-4 h-4 mr-2" /> Abrir conversa no WhatsApp
              </a></Button>
            )}
          </section>

          {/* Atribuição */}
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Atribuição</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Etapa</Label>
                <Select value={lead.stage} onValueChange={(v) => onChange({ stage: v as PipelineStage })}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>{PIPELINE_STAGES.map(s => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Vendedor</Label>
                <Select value={lead.seller_name ?? ""} onValueChange={(v) => onChange({ seller_name: v || null })}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>
                    {sellers.length === 0 && <SelectItem value="—" disabled>Cadastre vendedores</SelectItem>}
                    {sellers.map(s => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Produto</Label>
                <Input className="h-9" value={lead.product ?? lead.procedure_interest ?? ""} onChange={(e) => onChange({ product: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Canal</Label>
                <Input className="h-9" value={lead.channel ?? ""} onChange={(e) => onChange({ channel: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Valor da negociação (R$)</Label>
                <div className="flex gap-2">
                  <Input className="h-9" type="number" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} />
                  <Button variant="outline" onClick={() => onChange({ negotiation_value: Number(value) || 0 })}>Salvar</Button>
                </div>
              </div>
            </div>
          </section>

          {/* Origem / marketing */}
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Origem</div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><div className="text-[11px] text-muted-foreground">Tipo</div>{lead.lead_type || "—"}</div>
              <div><div className="text-[11px] text-muted-foreground">Campanha (Meta)</div>{lead.facebook_campaign_id || "—"}</div>
              <div className="col-span-2">
                <div className="text-[11px] text-muted-foreground">UTMs</div>
                {utms.length === 0 ? "—" : <div className="flex flex-wrap gap-1 mt-1">{utms.map((u, i) => <Badge key={i} variant="outline">{u}</Badge>)}</div>}
              </div>
            </div>
          </section>

          {/* Notas */}
          <section className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Notas</div>
            <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações sobre este lead…" />
            <Button size="sm" variant="outline" onClick={() => onChange({ notes })}>Salvar notas</Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
