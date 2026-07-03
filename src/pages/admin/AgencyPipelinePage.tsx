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
  Plus, Loader2, MapPin, DollarSign, Calendar, Trophy, Building2, Trash2, Phone, Mail, Sparkles,
} from "lucide-react";

const STAGES = [
  { id: "lead", title: "LEAD", color: "from-slate-500 to-slate-600", hex: "#64748b" },
  { id: "qualificado", title: "QUALIFICADO", color: "from-cyan-500 to-cyan-600", hex: "#06b6d4" },
  { id: "reuniao", title: "REUNIÃO", color: "from-indigo-500 to-indigo-600", hex: "#6366f1" },
  { id: "proposta", title: "PROPOSTA", color: "from-violet-500 to-violet-600", hex: "#8b5cf6" },
  { id: "negociacao", title: "NEGOCIAÇÃO", color: "from-amber-500 to-amber-600", hex: "#f59e0b" },
  { id: "ganho", title: "GANHO", color: "from-emerald-500 to-emerald-600", hex: "#10b981" },
  { id: "perdido", title: "PERDIDO", color: "from-rose-500 to-rose-600", hex: "#f43f5e" },
] as const;

type Stage = typeof STAGES[number]["id"];

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
  const [promoteOpen, setPromoteOpen] = useState<AgencyLead | null>(null);
  const [promoteSlug, setPromoteSlug] = useState("");
  const [promotePlano, setPromotePlano] = useState("starter");
  const [promoting, setPromoting] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);

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
    const { data, error } = await supabase
      .from("agency_leads")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setLeads((data || []) as AgencyLead[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const g: Record<Stage, AgencyLead[]> = {
      lead: [], qualificado: [], reuniao: [], proposta: [], negociacao: [], ganho: [], perdido: [],
    };
    for (const l of leads) g[l.stage]?.push(l);
    return g;
  }, [leads]);

  const kpis = useMemo(() => {
    const active = leads.filter((l) => l.stage !== "ganho" && l.stage !== "perdido");
    const wonMonth = leads.filter((l) => l.stage === "ganho");
    const emNeg = leads.filter((l) => ["proposta", "negociacao"].includes(l.stage));
    const totalPipeline = emNeg.reduce((s, l) => s + (l.valor_proposta || 0), 0);
    const wonValue = wonMonth.reduce((s, l) => s + (l.valor_proposta || 0), 0);
    const convRate = leads.length ? (wonMonth.length / leads.length) * 100 : 0;
    return {
      active: active.length,
      won: wonMonth.length,
      pipeline: totalPipeline,
      wonValue,
      convRate,
    };
  }, [leads]);

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
        <Button onClick={() => { setEditing(null); setNewOpen(true); }} className="gap-2">
          <Plus className="w-4 h-4" /> Novo Lead
        </Button>
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
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
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
                    <div className="text-center text-[11px] text-muted-foreground/60 py-8">Vazio</div>
                  )}
                  {items.map((l) => (
                    <div
                      key={l.id}
                      draggable
                      onDragStart={() => setDragged(l.id)}
                      onClick={() => setEditing(l)}
                      className="group cursor-grab active:cursor-grabbing rounded-lg border border-border/60 bg-background/60 p-3 hover:border-primary/40 hover:shadow-lg transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-sm truncate flex-1">{l.nome_clinica}</div>
                        {l.plano_interesse && (
                          <Badge variant="outline" className="text-[9px] uppercase h-4">{l.plano_interesse}</Badge>
                        )}
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
  open, onOpenChange, lead, onSaved, onDelete,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lead: AgencyLead | null;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    nome_clinica: "", responsavel: "", whatsapp: "", email: "",
    cidade: "", estado: "", origem: "inbound", stage: "lead" as Stage,
    valor_proposta: 0, plano_interesse: "", notas: "",
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
      });
    } else {
      setForm({
        nome_clinica: "", responsavel: "", whatsapp: "", email: "",
        cidade: "", estado: "", origem: "inbound", stage: "lead",
        valor_proposta: 0, plano_interesse: "", notas: "",
      });
    }
  }, [lead, open]);

  const save = async () => {
    if (!form.nome_clinica.trim()) { toast.error("Nome da clínica é obrigatório"); return; }
    setSaving(true);
    const payload = { ...form, valor_proposta: Number(form.valor_proposta) || 0 };
    const { error } = lead
      ? await supabase.from("agency_leads").update(payload).eq("id", lead.id)
      : await supabase.from("agency_leads").insert(payload);
    setSaving(false);
    if (error) toast.error(error.message);
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
