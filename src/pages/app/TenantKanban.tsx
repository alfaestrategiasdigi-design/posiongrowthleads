import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Phone, Globe2, Search, AlertTriangle, Facebook, Instagram, MessageCircle, Users2, Zap } from "lucide-react";
import { toast } from "sonner";

import { PIPELINE_STAGES, type PipelineStage } from "@/types/admin";

type Stage = PipelineStage;

// Ordem e labels vêm de PIPELINE_STAGES (fonte única — igual ao Dashboard).
const STAGES: { id: Stage; title: string; accent: string; bg: string }[] = PIPELINE_STAGES.map((s) => ({
  id: s.id as Stage,
  title: s.title,
  accent: s.hex,
  bg: `${s.hex}22`,
}));

const STALE_DAYS = 3;

function daysIn(date: string | null) {
  if (!date) return 0;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function channelIcon(ch: string | null) {
  if (!ch) return null;
  const s = ch.toLowerCase();
  if (s.includes("facebook") || s.includes("meta") || s.includes("tráfego")) return Facebook;
  if (s.includes("instagram") || s.includes("orgânico") || s.includes("organico")) return Instagram;
  if (s.includes("whats")) return MessageCircle;
  if (s.includes("indicação") || s.includes("paciente")) return Users2;
  return null;
}

type Lead = {
  id: string; full_name: string; whatsapp: string; channel: string | null;
  seller_name: string | null; procedure_interest: string | null; stage: Stage;
  sale_amount: number | null; international: boolean; notes: string | null;
  first_contact_date: string | null; created_at: string;
  updated_at: string | null; last_contact_at: string | null;
};

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PRODUCTS = [
  "GOLD + Remodelação","GOLD + Harmonize","GOLD + LINNEA SAFE","Avaliação Gold","Consulta Nutro",
  "Vitaminas + Hormônio","Bioestimulador","Implante Hormonal","Toxina Botulínica","Contour Emagrecimento",
  "Ampola Tirezepatida","Peptídeos","Goldincision","Nutrologia","Contur 360",
];
const SELLERS = ["Dr Matheus","Aline","Mayara","Isabelle","Tamara"];
const CHANNELS = ["Instagram Orgânico","Tráfego Pago","Paciente","Indicação","TikTok","Anúncio","Emanuele","Clínica São Caetano"];

export default function TenantKanban() {
  const { tenant } = useTenant();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);
  const [winLead, setWinLead] = useState<Lead | null>(null);
  const [filterProduct, setFilterProduct] = useState("all");
  const [filterChannel, setFilterChannel] = useState("all");
  const [search, setSearch] = useState("");

  async function loadAll() {
    if (!tenant) return;
    setLoading(true);
    const { data } = await supabase.from("clinic_leads").select("*")
      .eq("tenant_id", tenant.id).order("created_at", { ascending: false });
    setLeads((data || []) as Lead[]);
    setLoading(false);
  }
  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [tenant?.id]);

  // Realtime: outros usuários veem mudanças instantaneamente
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`clinic_leads_${tenant.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "clinic_leads", filter: `tenant_id=eq.${tenant.id}` },
        () => loadAll())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line
  }, [tenant?.id]);

  async function moveLead(id: string, stage: Stage) {
    const lead = leads.find((l) => l.id === id);
    if (!lead || lead.stage === stage) return;
    if (stage === "ganho") { setWinLead(lead); setDragId(null); return; }
    const prev = leads;
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, stage } : l)));
    const { error } = await supabase.from("clinic_leads").update({ stage }).eq("id", id);
    if (error) { setLeads(prev); toast.error("Não foi possível mover o lead."); }
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return leads.filter((l) =>
      (filterProduct === "all" || l.procedure_interest === filterProduct) &&
      (filterChannel === "all" || l.channel === filterChannel) &&
      (!q || l.full_name.toLowerCase().includes(q) || l.whatsapp.includes(q))
    );
  }, [leads, filterProduct, filterChannel, search]);

  const columns = useMemo(
    () => STAGES.map((s) => {
      const rows = filtered.filter((l) => l.stage === s.id);
      return { ...s, rows, total: rows.reduce((a, b) => a + Number(b.sale_amount || 0), 0) };
    }), [filtered]);

  if (!tenant || loading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1800px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kanban de Leads</h1>
          <p className="text-muted-foreground">{filtered.length} leads · arraste cards entre etapas</p>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> Novo Lead</Button></DialogTrigger>
          <NewLeadDialog tenantId={tenant.id} onCreated={() => { setOpenNew(false); loadAll(); }} />
        </Dialog>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <Select value={filterProduct} onValueChange={setFilterProduct}>
          <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="Produto" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os produtos</SelectItem>{PRODUCTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={filterChannel} onValueChange={setFilterChannel}>
          <SelectTrigger className="w-[180px] h-9"><SelectValue placeholder="Canal" /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os canais</SelectItem>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
        </Select>
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar nome ou telefone..." className="pl-9 h-9" />
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4">
        {columns.map((col) => (
          <div
            key={col.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (dragId) { moveLead(dragId, col.id); setDragId(null); } }}
            className="flex flex-col rounded-xl min-w-[280px] max-w-[300px] flex-shrink-0"
            style={{ background: "#0B1224", border: "1px solid rgba(255,255,255,0.05)" }}
          >
            <div className="px-3 py-2.5 rounded-t-xl" style={{ background: col.bg, borderBottom: `2px solid ${col.accent}` }}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-wider uppercase" style={{ color: col.accent }}>{col.title}</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${col.accent}22`, color: col.accent }}>{col.rows.length}</span>
              </div>
              {col.total > 0 && <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">{BRL(col.total)}</div>}
            </div>
            <div className="flex-1 p-2.5 space-y-2 overflow-y-auto max-h-[calc(100vh-280px)] min-h-[180px]">
              {col.rows.map((l) => {
                const stageDays = daysIn(l.updated_at || l.created_at);
                const stalled = stageDays >= STALE_DAYS && !["ganho", "perdido", "no_show"].includes(l.stage);
                const CIcon = channelIcon(l.channel);
                const initials = (l.full_name || "?").trim().slice(0, 2).toUpperCase();
                return (
                <Card
                  key={l.id}
                  draggable
                  onDragStart={() => setDragId(l.id)}
                  onDragEnd={() => setDragId(null)}
                  className="p-3 cursor-grab active:cursor-grabbing transition border bg-[#0B1224] relative"
                  style={{ borderColor: stalled ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.07)" }}
                  onMouseEnter={(e) => e.currentTarget.style.borderColor = "rgba(212,175,55,0.4)"}
                  onMouseLeave={(e) => e.currentTarget.style.borderColor = stalled ? "rgba(239,68,68,0.35)" : "rgba(255,255,255,0.07)"}
                >
                  {stalled && (
                    <div
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-rose-500 flex items-center justify-center border-2 border-[#0B1224]"
                      title={`Parado há ${stageDays} dias neste estágio`}
                    >
                      <AlertTriangle className="w-3 h-3 text-white" />
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                      style={{ background: `${col.accent}22`, color: col.accent }}
                    >
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <div className="text-sm font-semibold truncate flex-1">{l.full_name}</div>
                        {l.international && <Globe2 className="w-3 h-3 shrink-0" style={{ color: "#D4AF37" }} />}
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Phone className="w-2.5 h-2.5" /> {l.whatsapp}
                      </div>
                    </div>
                  </div>

                  {(l.procedure_interest || l.channel || l.seller_name) && (
                    <div className="text-[10px] mt-2 flex flex-wrap gap-1">
                      {l.procedure_interest && (
                        <span className="px-1.5 py-0.5 rounded truncate max-w-[130px]" style={{ background: "rgba(212,175,55,0.12)", color: "#D4AF37" }}>
                          {l.procedure_interest}
                        </span>
                      )}
                      {l.channel && (
                        <span className="px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground flex items-center gap-1">
                          {CIcon && <CIcon className="w-2.5 h-2.5" />}
                          <span className="truncate max-w-[100px]">{l.channel}</span>
                        </span>
                      )}
                      {l.seller_name && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300 truncate max-w-[110px]">
                          {l.seller_name}
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/5 text-[10px] text-muted-foreground">
                    <span title="Último contato">
                      {l.last_contact_at
                        ? `📞 ${new Date(l.last_contact_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`
                        : l.first_contact_date
                          ? new Date(l.first_contact_date + "T00:00:00").toLocaleDateString("pt-BR")
                          : "—"}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className="px-1.5 py-0.5 rounded font-mono tabular-nums"
                        style={{
                          background: stalled ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)",
                          color: stalled ? "#F87171" : undefined,
                        }}
                        title={`${stageDays} dias neste estágio`}
                      >
                        {stageDays}d
                      </span>
                      {l.sale_amount ? <span className="font-semibold text-foreground">{BRL(Number(l.sale_amount))}</span> : null}
                    </div>
                  </div>
                </Card>
              );
              })}
              {col.rows.length === 0 && (
                <div className="text-[11px] text-muted-foreground text-center py-6 border border-dashed border-white/5 rounded-md">
                  Arraste aqui
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <WinSaleDialog
        lead={winLead}
        tenantId={tenant.id}
        onClose={() => setWinLead(null)}
        onSaved={() => { setWinLead(null); loadAll(); }}
      />
    </div>
  );
}

function NewLeadDialog({ tenantId, onCreated }: { tenantId: string; onCreated: () => void }) {
  const [form, setForm] = useState({
    full_name: "", whatsapp: "", channel: "", seller_name: "", procedure_interest: "",
    stage: "lead" as Stage,
    first_contact_date: new Date().toISOString().slice(0, 10),
    notes: "", international: false,
  });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.full_name || !form.whatsapp) { toast.error("Nome e WhatsApp são obrigatórios"); return; }
    setSaving(true);
    const { error } = await supabase.from("clinic_leads").insert({
      tenant_id: tenantId, full_name: form.full_name, whatsapp: form.whatsapp,
      channel: form.channel || null, seller_name: form.seller_name || null,
      procedure_interest: form.procedure_interest || null, stage: form.stage,
      first_contact_date: form.first_contact_date || null, notes: form.notes || null,
      international: form.international,
    });
    setSaving(false);
    if (error) { toast.error("Erro: " + error.message); return; }
    toast.success("Lead criado"); onCreated();
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Novo Lead</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Nome completo *</Label><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
        <div><Label>WhatsApp *</Label><Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="(11) 99999-9999" /></div>
        <div><Label>1º contato</Label><Input type="date" value={form.first_contact_date} onChange={(e) => setForm({ ...form, first_contact_date: e.target.value })} /></div>
        <div>
          <Label>Produto</Label>
          <Select value={form.procedure_interest} onValueChange={(v) => setForm({ ...form, procedure_interest: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{PRODUCTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Canal</Label>
          <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{CHANNELS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Vendedor</Label>
          <Select value={form.seller_name} onValueChange={(v) => setForm({ ...form, seller_name: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{SELLERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Etapa inicial</Label>
          <Select value={form.stage} onValueChange={(v) => setForm({ ...form, stage: v as Stage })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input id="intl" type="checkbox" checked={form.international} onChange={(e) => setForm({ ...form, international: e.target.checked })} />
          <Label htmlFor="intl" className="cursor-pointer">Paciente internacional</Label>
        </div>
        <div className="col-span-2"><Label>Observação</Label><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} /></div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function WinSaleDialog({ lead, tenantId, onClose, onSaved }: {
  lead: Lead | null; tenantId: string; onClose: () => void; onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [product, setProduct] = useState("");
  const [seller, setSeller] = useState("");
  const [payment, setPayment] = useState("PIX");
  const [scheduled, setScheduled] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (lead) {
      setAmount(lead.sale_amount ? String(lead.sale_amount) : "");
      setProduct(lead.procedure_interest || "");
      setSeller(lead.seller_name || "");
      setPayment("PIX");
      setScheduled("");
      setNotes("");
    }
  }, [lead]);

  async function save() {
    if (!lead) return;
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("Informe um valor válido (> 0)"); return; }
    if (!product) { toast.error("Selecione o procedimento"); return; }

    // evita venda duplicada
    const { data: dup } = await supabase
      .from("sales").select("id").eq("clinic_lead_id", lead.id).limit(1).maybeSingle();
    if (dup) { toast.error("Já existe uma venda registrada para este lead"); return; }

    setSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const [u1, u2] = await Promise.all([
      supabase.from("clinic_leads").update({ stage: "ganho", sale_amount: amt }).eq("id", lead.id),
      supabase.from("sales").insert({
        tenant_id: tenantId,
        clinic_lead_id: lead.id,
        patient_name: lead.full_name,
        product, procedure_name: product,
        seller_name: seller || "—",
        channel: lead.channel, channel_origin: lead.channel,
        amount: amt, sale_date: today,
        scheduled_date: scheduled || null,
        payment_method: payment,
        first_contact_date: lead.first_contact_date,
        attended: "SIM", international: lead.international,
        notes: notes || null,
      }),
    ]);
    setSaving(false);
    if (u1.error || u2.error) { toast.error("Erro ao registrar venda"); return; }
    toast.success("Venda registrada"); onSaved();
  }

  return (
    <Dialog open={!!lead} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Registrar venda — {lead?.full_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Valor (R$) *</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0,00" /></div>
            <div>
              <Label>Forma pagto</Label>
              <Select value={payment} onValueChange={setPayment}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["PIX","Cartão","Boleto","Dinheiro","Crédito Recorrente","Outros"].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Procedimento *</Label>
            <Select value={product} onValueChange={setProduct}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>{PRODUCTS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vendedor</Label>
              <Select value={seller} onValueChange={setSeller}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{SELLERS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Data procedimento</Label><Input type="date" value={scheduled} onChange={(e) => setScheduled(e.target.value)} /></div>
          </div>
          <div><Label>Notas</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações..." /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar venda"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
