import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Plus, Loader2, MapPin, DollarSign, Calendar, Trophy, Building2, Trash2, Phone, Mail, Sparkles, Pencil, Search, X,
} from "lucide-react";
import UnifiedLeadPanel from "@/components/leads/UnifiedLeadPanel";
import { PIPELINE_STAGES, type PipelineStage } from "@/types/admin";

const STAGES = PIPELINE_STAGES;

type Stage = PipelineStage;

interface AgencyLead {
  id: string;
  nome_clinica: string;
  responsavel: string | null;
  whatsapp: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  origem: string | null;
  stage: Stage;
  valor_proposta: number | null;
  plano_interesse: string | null;
  proximo_followup: string | null;
  notas: string | null;
  created_at: string;
  tenant_id_criado: string | null;
  utm_campaign: string | null;
  campaign_id_manual: string | null;
}

interface CampaignOption { id: string; name: string; }

const fmt = (v: number | null) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

export default function AgencyPipelinePage() {
  const [leads, setLeads] = useState<AgencyLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragged, setDragged] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [editing, setEditing] = useState<AgencyLead | null>(null);
  const [panelLeadId, setPanelLeadId] = useState<string | null>(null);
  const [promoteOpen, setPromoteOpen] = useState<AgencyLead | null>(null);
  const [promoteSlug, setPromoteSlug] = useState("");
  const [promotePlano, setPromotePlano] = useState("starter");
  const [promoting, setPromoting] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase
      .from("campaign_spend")
      .select("campaign_id, campaign_name")
      .eq("channel", "meta_ads")
      .not("campaign_id", "is", null)
      .order("campaign_name")
      .then(({ data }) => {
        const seen = new Set<string>();
        const opts: CampaignOption[] = [];
        for (const r of data || []) {
          const id = (r as any).campaign_id as string;
          if (!id || seen.has(id)) continue;
          seen.add(id);
          opts.push({ id, name: (r as any).campaign_name || id });
        }
        setCampaigns(opts);
      });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    // Pipeline mostra: (a) agency_leads vinculados aos leads do Meta em regras admin_master
    //                  (b) agency_leads manuais (source_lead_id NULL) criados pelo botão "Novo Lead"
    const { data: masterRules } = await (supabase as any)
      .from("lead_routing_rules")
      .select("match_value")
      .eq("match_type", "form_id")
      .eq("is_admin_master", true)
      .eq("active", true);
    const masterFormIds = (masterRules ?? []).map((r: any) => String(r.match_value)).filter(Boolean);

    let sourceIds: string[] = [];
    if (masterFormIds.length > 0) {
      const { data: srcLeads } = await supabase
        .from("leads")
        .select("id")
        .eq("origem", "facebook_ads")
        .is("tenant_id", null)
        .in("facebook_form_id", masterFormIds);
      sourceIds = (srcLeads ?? []).map((l: any) => l.id);
    }

    const [metaRes, manualRes] = await Promise.all([
      sourceIds.length
        ? supabase.from("agency_leads").select("*").in("source_lead_id", sourceIds)
        : Promise.resolve({ data: [] as any[], error: null } as any),
      supabase.from("agency_leads").select("*").is("source_lead_id", null),
    ]);

    if (metaRes.error) toast.error(metaRes.error.message);
    if (manualRes.error) toast.error(manualRes.error.message);

    const merged = new Map<string, AgencyLead>();
    for (const l of (metaRes.data || []) as AgencyLead[]) merged.set(l.id, l);
    for (const l of (manualRes.data || []) as AgencyLead[]) merged.set(l.id, l);
    const all = Array.from(merged.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setLeads(all);
    setLoading(false);
  }, []);



  useEffect(() => { load(); }, [load]);

  const norm = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const filteredLeads = useMemo(() => {
    const q = norm(search.trim());
    if (!q) return leads;
    return leads.filter((l) => {
      const hay = norm(
        [
          l.nome_clinica, l.responsavel, l.email, l.whatsapp,
          l.cidade, l.estado, l.plano_interesse, l.utm_campaign,
        ].filter(Boolean).join(" ")
      );
      return hay.includes(q);
    });
  }, [leads, search]);

  const grouped = useMemo(() => {
    const g: Record<Stage, AgencyLead[]> = {
      lead: [], qualificado: [], agendar_reuniao: [], reuniao_agendada: [],
      proposta: [], negociacao: [], ganho: [], ativo: [], perdido: [],
    };
    for (const l of filteredLeads) g[l.stage]?.push(l);
    return g;
  }, [filteredLeads]);

  const kpis = useMemo(() => {
    const active = filteredLeads.filter((l) => l.stage !== "ganho" && l.stage !== "perdido");
    const wonMonth = filteredLeads.filter((l) => l.stage === "ganho");
    const emNeg = filteredLeads.filter((l) => ["proposta", "negociacao"].includes(l.stage));
    const totalPipeline = emNeg.reduce((s, l) => s + (l.valor_proposta || 0), 0);
    const wonValue = wonMonth.reduce((s, l) => s + (l.valor_proposta || 0), 0);
    const convRate = filteredLeads.length ? (wonMonth.length / filteredLeads.length) * 100 : 0;
    return {
      active: active.length,
      won: wonMonth.length,
      pipeline: totalPipeline,
      wonValue,
      convRate,
    };
  }, [filteredLeads]);

  const moveStage = async (leadId: string, newStage: Stage) => {
    setLeads((prev) => prev.map((l) => (l.id === leadId ? { ...l, stage: newStage } : l)));
    const patch: Partial<AgencyLead> = { stage: newStage };
    if (newStage === "ganho") (patch as any).ganho_at = new Date().toISOString();
    const { error } = await supabase.from("agency_leads").update(patch).eq("id", leadId);
    if (error) { toast.error(error.message); load(); }
    else toast.success(`Movido para ${STAGES.find((s) => s.id === newStage)?.title}`);
  };

  const removeLead = async (id: string) => {
    if (!confirm("Excluir este lead?")) return;
    const { error } = await supabase.from("agency_leads").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Lead removido"); load(); }
  };

  const promote = async () => {
    if (!promoteOpen) return;
    if (!promoteSlug || promoteSlug.length < 3) {
      toast.error("Informe um slug válido (min 3 chars)");
      return;
    }
    setPromoting(true);
    const { data, error } = await supabase.rpc("promote_agency_lead_to_tenant", {
      p_lead_id: promoteOpen.id,
      p_slug: promoteSlug,
      p_plano: promotePlano,
      p_valor: promoteOpen.valor_proposta,
    });
    setPromoting(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Clínica ${promoteOpen.nome_clinica} promovida! Tenant: ${data}`);
    setPromoteOpen(null);
    setPromoteSlug("");
    load();
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary/70 mb-1">POSION Agência</div>
          <h1 className="text-3xl font-bold">Pipeline de Vendas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Funil de clínicas interessadas em contratar a POSION.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar clínica, responsável, e-mail..."
              className="pl-8 pr-8 w-[280px] h-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <Button onClick={() => { setEditing(null); setNewOpen(true); }} className="gap-2">
            <Plus className="w-4 h-4" /> Novo Lead
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI icon={Building2} label="Ativos no pipeline" value={String(kpis.active)} tint="cyan" />
        <KPI icon={DollarSign} label="Em negociação" value={fmt(kpis.pipeline)} tint="amber" />
        <KPI icon={Trophy} label="Ganhos" value={String(kpis.won)} tint="emerald" />
        <KPI icon={DollarSign} label="Receita ganha" value={fmt(kpis.wonValue)} tint="emerald" />
        <KPI icon={Sparkles} label="Conversão" value={`${kpis.convRate.toFixed(1)}%`} tint="violet" />
      </div>

      {/* Kanban */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          {STAGES.map((stage) => {
            const items = grouped[stage.id];
            const total = items.reduce((s, l) => s + (l.valor_proposta || 0), 0);
            return (
              <div
                key={stage.id}
                className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm overflow-hidden flex flex-col min-h-[320px]"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragged) { moveStage(dragged, stage.id); setDragged(null); } }}
              >
                <div className={`h-1.5 bg-gradient-to-r ${stage.color}`} />
                <div className="p-3 border-b border-border/40 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold tracking-wider">{stage.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{fmt(total)}</div>
                  </div>
                  <span
                    className="text-xs font-bold rounded-full px-2 py-0.5"
                    style={{ background: `${stage.hex}20`, color: stage.hex }}
                  >
                    {items.length}
                  </span>
                </div>
                <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[70vh]">
                  {items.length === 0 && (
                    <div className="text-center text-[11px] text-muted-foreground/60 py-8">{search ? "Nenhum resultado" : "Vazio"}</div>
                  )}
                  {items.map((l) => (
                    <div
                      key={l.id}
                      draggable
                      onDragStart={() => setDragged(l.id)}
                      onClick={() => setPanelLeadId(l.id)}
                      className="group cursor-grab active:cursor-grabbing rounded-lg border border-border/60 bg-background/60 p-3 hover:border-primary/40 hover:shadow-lg transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm truncate flex-1">{l.nome_clinica}</div>
                        {l.plano_interesse && (
                          <Badge variant="outline" className="text-[9px] uppercase h-4">{l.plano_interesse}</Badge>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setEditing(l); }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                          title="Editar campos avançados"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                      {l.responsavel && (
                        <div className="text-[11px] text-muted-foreground truncate mt-0.5">{l.responsavel}</div>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                        {l.cidade && <span className="flex items-center gap-0.5"><MapPin className="w-3 h-3" />{l.cidade}</span>}
                        {l.valor_proposta ? <span className="ml-auto font-semibold text-primary">{fmt(l.valor_proposta)}</span> : null}
                      </div>
                      {stage.id === "ganho" && !l.campaign_id_manual && !l.utm_campaign && (
                        <div className="mt-2 text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-1">
                          ⚠ Sem campanha vinculada — clique para editar e escolha uma no combo.
                        </div>
                      )}
                      {stage.id === "ganho" && !l.tenant_id_criado && (
                        <Button
                          size="sm"
                          className="w-full mt-2 h-7 text-[11px]"
                          onClick={(e) => { e.stopPropagation(); setPromoteOpen(l); setPromoteSlug(slugify(l.nome_clinica)); }}
                        >
                          <Sparkles className="w-3 h-3 mr-1" /> Criar clínica
                        </Button>
                      )}
                      {stage.id === "ganho" && l.tenant_id_criado && (
                        <div className="mt-2 text-[10px] text-emerald-500 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" /> Tenant criado
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LeadDialog
        open={newOpen || !!editing}
        onOpenChange={(o) => { if (!o) { setNewOpen(false); setEditing(null); } }}
        lead={editing}
        campaigns={campaigns}
        onSaved={() => { setNewOpen(false); setEditing(null); load(); }}
        onDelete={editing ? () => { removeLead(editing.id); setEditing(null); } : undefined}
      />

      <UnifiedLeadPanel
        source="agency_lead"
        leadId={panelLeadId}
        open={!!panelLeadId}
        onClose={() => setPanelLeadId(null)}
        onUpdated={load}
      />

      <Dialog open={!!promoteOpen} onOpenChange={(o) => !o && setPromoteOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Promover para Clínica Cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome da clínica</Label>
              <Input value={promoteOpen?.nome_clinica || ""} disabled />
            </div>
            <div>
              <Label>Slug (URL)</Label>
              <Input value={promoteSlug} onChange={(e) => setPromoteSlug(slugify(e.target.value))} placeholder="minha-clinica" />
              <p className="text-[11px] text-muted-foreground mt-1">Acesso em /app/{promoteSlug || "..."}</p>
            </div>
            <div>
              <Label>Plano SaaS</Label>
              <Select value={promotePlano} onValueChange={setPromotePlano}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter</SelectItem>
                  <SelectItem value="growth">Growth</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="text-xs text-muted-foreground bg-muted/40 p-2 rounded">
              Vai criar: <b>Tenant</b>, <b>Contrato de agência</b> ({fmt(promoteOpen?.valor_proposta || null)}) e marcar o lead como ganho.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPromoteOpen(null)}>Cancelar</Button>
            <Button onClick={promote} disabled={promoting}>
              {promoting && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KPI({ icon: Icon, label, value, tint }: { icon: any; label: string; value: string; tint: "cyan" | "amber" | "emerald" | "violet" }) {
  const map = {
    cyan: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/30",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
    violet: "text-violet-400 bg-violet-500/10 border-violet-500/30",
  }[tint];
  return (
    <div className="rounded-xl border border-border/60 bg-card/40 backdrop-blur-sm p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
        <span className={`w-6 h-6 rounded-md border flex items-center justify-center ${map}`}><Icon className="w-3 h-3" /></span>
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function LeadDialog({
  open, onOpenChange, lead, campaigns, onSaved, onDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: AgencyLead | null;
  campaigns: CampaignOption[];
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nome_clinica: "", responsavel: "", whatsapp: "", email: "",
    cidade: "", estado: "", origem: "inbound", stage: "lead" as Stage,
    valor_proposta: 0, plano_interesse: "", notas: "",
    campaign_id_manual: "", utm_campaign: "",
  });

  useEffect(() => {
    if (lead) {
      setForm({
        nome_clinica: lead.nome_clinica || "",
        responsavel: lead.responsavel || "",
        whatsapp: lead.whatsapp || "",
        email: lead.email || "",
        cidade: lead.cidade || "",
        estado: lead.estado || "",
        origem: lead.origem || "inbound",
        stage: lead.stage,
        valor_proposta: Number(lead.valor_proposta || 0),
        plano_interesse: lead.plano_interesse || "",
        notas: lead.notas || "",
        campaign_id_manual: lead.campaign_id_manual || "",
        utm_campaign: lead.utm_campaign || "",
      });
    } else {
      setForm({
        nome_clinica: "", responsavel: "", whatsapp: "", email: "",
        cidade: "", estado: "", origem: "inbound", stage: "lead",
        valor_proposta: 0, plano_interesse: "", notas: "",
        campaign_id_manual: "", utm_campaign: "",
      });
    }
  }, [lead, open]);

  const save = async () => {
    if (!form.nome_clinica.trim()) { toast.error("Nome da clínica é obrigatório"); return; }
    setSaving(true);
    const payload: any = {
      ...form,
      valor_proposta: Number(form.valor_proposta) || 0,
      campaign_id_manual: form.campaign_id_manual || null,
      utm_campaign: form.utm_campaign || null,
    };
    const { error } = lead
      ? await supabase.from("agency_leads").update(payload).eq("id", lead.id)
      : await supabase.from("agency_leads").insert(payload);
    setSaving(false);
    if (error) { console.error("[agency_leads] save error:", error); toast.error(error.message); }
    else { toast.success(lead ? "Atualizado" : "Criado"); onSaved(); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{lead ? "Editar Lead" : "Novo Lead"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Nome da clínica *</Label><Input value={form.nome_clinica} onChange={(e) => setForm({ ...form, nome_clinica: e.target.value })} /></div>
          <div><Label>Responsável</Label><Input value={form.responsavel} onChange={(e) => setForm({ ...form, responsavel: e.target.value })} /></div>
          <div><Label>WhatsApp</Label><Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} /></div>
          <div><Label>E-mail</Label><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><Label>Cidade</Label><Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} /></div>
          <div><Label>Estado (UF)</Label><Input value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value })} maxLength={2} /></div>
          <div>
            <Label>Origem</Label>
            <Select value={form.origem} onValueChange={(v) => setForm({ ...form, origem: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inbound">Inbound</SelectItem>
                <SelectItem value="outbound">Outbound</SelectItem>
                <SelectItem value="indicacao">Indicação</SelectItem>
                <SelectItem value="instagram">Instagram</SelectItem>
                <SelectItem value="facebook">Facebook Ads</SelectItem>
                <SelectItem value="evento">Evento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Estágio</Label>
            <Select value={form.stage} onValueChange={(v) => setForm({ ...form, stage: v as Stage })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Plano de interesse</Label>
            <Select value={form.plano_interesse || "none"} onValueChange={(v) => setForm({ ...form, plano_interesse: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="starter">Starter</SelectItem>
                <SelectItem value="growth">Growth</SelectItem>
                <SelectItem value="premium">Premium</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label>Valor da proposta (R$)</Label><Input type="number" value={form.valor_proposta} onChange={(e) => setForm({ ...form, valor_proposta: Number(e.target.value) })} /></div>
          <div className="col-span-2 border-t border-border/40 pt-3 mt-1">
            <div className="text-[10px] uppercase tracking-[0.18em] text-primary/80 mb-2">Atribuição de campanha</div>
            <Label>Campanha Meta vinculada</Label>
            <Select
              value={form.campaign_id_manual || "none"}
              onValueChange={(v) => setForm({ ...form, campaign_id_manual: v === "none" ? "" : v })}
            >
              <SelectTrigger><SelectValue placeholder="— nenhuma —" /></SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="none">— nenhuma —</SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground mt-1">
              Ao mover para GANHO, o valor da proposta é contabilizado nesta campanha (Receita CRM / ROAS).
            </p>
          </div>
          <div className="col-span-2"><Label>UTM Campaign (opcional)</Label><Input value={form.utm_campaign} onChange={(e) => setForm({ ...form, utm_campaign: e.target.value })} placeholder="nome exato da campanha, se preferir matching por nome" /></div>
          <div className="col-span-2"><Label>Notas</Label><Textarea rows={3} value={form.notas} onChange={(e) => setForm({ ...form, notas: e.target.value })} /></div>
        </div>
        <DialogFooter className="gap-2">
          {onDelete && <Button variant="destructive" onClick={onDelete}><Trash2 className="w-4 h-4 mr-2" />Excluir</Button>}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
