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
import { Loader2, Plus, Phone, Globe2 } from "lucide-react";
import { toast } from "sonner";

type Stage =
  | "contato_iniciado" | "qualificando" | "avaliacao_agendada" | "avaliacao_realizada"
  | "proposta_enviada" | "negociando" | "fechado_ganho" | "fechado_perdido"
  | "futuro" | "no_show";

const STAGES: { id: Stage; title: string; color: string }[] = [
  { id: "contato_iniciado",   title: "Contato Iniciado",   color: "from-slate-500 to-slate-600" },
  { id: "qualificando",       title: "Qualificando",       color: "from-blue-500 to-blue-600" },
  { id: "avaliacao_agendada", title: "Avaliação Agendada", color: "from-sky-500 to-sky-600" },
  { id: "avaliacao_realizada",title: "Avaliação Realizada",color: "from-indigo-500 to-indigo-600" },
  { id: "proposta_enviada",   title: "Proposta Enviada",   color: "from-violet-500 to-violet-600" },
  { id: "negociando",         title: "Negociando",         color: "from-fuchsia-500 to-fuchsia-600" },
  { id: "fechado_ganho",      title: "Fechado — Ganho",    color: "from-emerald-500 to-emerald-600" },
  { id: "fechado_perdido",    title: "Fechado — Perdido",  color: "from-rose-500 to-rose-600" },
  { id: "futuro",             title: "Futuro",             color: "from-amber-500 to-amber-600" },
  { id: "no_show",            title: "No-show",            color: "from-zinc-500 to-zinc-600" },
];

type Lead = {
  id: string;
  full_name: string;
  whatsapp: string;
  channel: string | null;
  seller_name: string | null;
  procedure_interest: string | null;
  stage: Stage;
  sale_amount: number | null;
  international: boolean;
  notes: string | null;
  first_contact_date: string | null;
};

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

export default function TenantKanban() {
  const { tenant } = useTenant();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<string[]>([]);
  const [sellers, setSellers] = useState<string[]>([]);
  const [procedures, setProcedures] = useState<string[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);
  const [openNew, setOpenNew] = useState(false);

  async function loadAll() {
    if (!tenant) return;
    setLoading(true);
    const [{ data: ld }, { data: ch }, { data: sl }, { data: pr }] = await Promise.all([
      supabase.from("clinic_leads").select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }),
      supabase.from("channels").select("name").eq("tenant_id", tenant.id).eq("active", true).order("name"),
      supabase.from("sellers").select("name").eq("tenant_id", tenant.id).eq("active", true).order("name"),
      supabase.from("procedures").select("name").eq("tenant_id", tenant.id).eq("active", true).order("sort_order"),
    ]);
    setLeads((ld || []) as Lead[]);
    setChannels((ch || []).map((x) => x.name));
    setSellers((sl || []).map((x) => x.name));
    setProcedures((pr || []).map((x) => x.name));
    setLoading(false);
  }

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, [tenant?.id]);

  async function moveLead(id: string, stage: Stage) {
    const prev = leads;
    setLeads((cur) => cur.map((l) => (l.id === id ? { ...l, stage } : l)));
    const { error } = await supabase.from("clinic_leads").update({ stage }).eq("id", id);
    if (error) {
      setLeads(prev);
      toast.error("Não foi possível mover o lead. Tente novamente.");
    }
  }

  const columns = useMemo(
    () => STAGES.map((s) => {
      const rows = leads.filter((l) => l.stage === s.id);
      const total = rows.reduce((a, b) => a + Number(b.sale_amount || 0), 0);
      return { ...s, rows, total };
    }),
    [leads]
  );

  if (!tenant || loading)
    return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1800px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kanban de Leads</h1>
          <p className="text-muted-foreground">Funil completo — arraste cards entre etapas</p>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-1" /> Novo Lead</Button>
          </DialogTrigger>
          <NewLeadDialog
            tenantId={tenant.id}
            channels={channels}
            sellers={sellers}
            procedures={procedures}
            onCreated={() => { setOpenNew(false); loadAll(); }}
          />
        </Dialog>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        {columns.map((col) => (
          <div
            key={col.id}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={() => { if (dragId) { moveLead(dragId, col.id); setDragId(null); } }}
            className="bg-card border border-border rounded-xl p-3 flex flex-col min-h-[420px]"
          >
            <div className={`bg-gradient-to-r ${col.color} text-white rounded-lg px-3 py-2 mb-3`}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">{col.title}</span>
                <span className="text-xs bg-white/20 rounded-full px-2 py-0.5">{col.rows.length}</span>
              </div>
              {col.total > 0 && <div className="text-xs opacity-90 mt-0.5">{BRL(col.total)}</div>}
            </div>
            <div className="space-y-2 overflow-auto flex-1 -mx-1 px-1">
              {col.rows.map((l) => (
                <Card
                  key={l.id}
                  draggable
                  onDragStart={() => setDragId(l.id)}
                  onDragEnd={() => setDragId(null)}
                  className="p-3 cursor-grab active:cursor-grabbing hover:border-primary/50 transition"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium truncate">{l.full_name}</div>
                    {l.international && <Globe2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                  </div>
                  {l.procedure_interest && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">{l.procedure_interest}</div>
                  )}
                  <div className="flex items-center justify-between gap-2 mt-2">
                    <span className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                      <Phone className="w-3 h-3" /> {l.whatsapp}
                    </span>
                    {l.sale_amount ? (
                      <span className="text-xs font-semibold">{BRL(Number(l.sale_amount))}</span>
                    ) : l.seller_name ? (
                      <span className="text-[11px] text-muted-foreground">{l.seller_name}</span>
                    ) : null}
                  </div>
                </Card>
              ))}
              {col.rows.length === 0 && (
                <div className="text-xs text-muted-foreground text-center py-6 border border-dashed border-border rounded-md">
                  Arraste aqui
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NewLeadDialog({
  tenantId, channels, sellers, procedures, onCreated,
}: {
  tenantId: string;
  channels: string[]; sellers: string[]; procedures: string[];
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    full_name: "", whatsapp: "", channel: "", seller_name: "",
    procedure_interest: "", stage: "contato_iniciado" as Stage,
    first_contact_date: new Date().toISOString().slice(0, 10),
    notes: "", international: false,
  });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.full_name || !form.whatsapp) {
      toast.error("Nome e WhatsApp são obrigatórios");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("clinic_leads").insert({
      tenant_id: tenantId,
      full_name: form.full_name,
      whatsapp: form.whatsapp,
      channel: form.channel || null,
      seller_name: form.seller_name || null,
      procedure_interest: form.procedure_interest || null,
      stage: form.stage,
      first_contact_date: form.first_contact_date || null,
      notes: form.notes || null,
      international: form.international,
    });
    setSaving(false);
    if (error) { toast.error("Erro ao salvar: " + error.message); return; }
    toast.success("Lead criado");
    onCreated();
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>Novo Lead</DialogTitle></DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label>Nome completo *</Label>
          <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        </div>
        <div>
          <Label>WhatsApp *</Label>
          <Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="(11) 99999-9999" />
        </div>
        <div>
          <Label>1º contato</Label>
          <Input type="date" value={form.first_contact_date} onChange={(e) => setForm({ ...form, first_contact_date: e.target.value })} />
        </div>
        <div>
          <Label>Canal</Label>
          <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{channels.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Vendedor</Label>
          <Select value={form.seller_name} onValueChange={(v) => setForm({ ...form, seller_name: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{sellers.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Procedimento de interesse</Label>
          <Select value={form.procedure_interest} onValueChange={(v) => setForm({ ...form, procedure_interest: v })}>
            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{procedures.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2">
          <Label>Etapa</Label>
          <Select value={form.stage} onValueChange={(v) => setForm({ ...form, stage: v as Stage })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <input id="intl" type="checkbox" checked={form.international} onChange={(e) => setForm({ ...form, international: e.target.checked })} />
          <Label htmlFor="intl" className="cursor-pointer">Paciente internacional</Label>
        </div>
        <div className="col-span-2">
          <Label>Observações</Label>
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
