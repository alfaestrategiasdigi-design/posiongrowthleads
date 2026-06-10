import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Bell, Plus, Loader2, MessageSquareHeart } from "lucide-react";
import { toast } from "sonner";

interface Campaign {
  id: string; name: string; trigger_type: string; trigger_days: number;
  message_template: string; active: boolean;
}

const TRIGGERS = [
  { v: "pos_procedimento", l: "Pós-procedimento" },
  { v: "aniversario", l: "Aniversário" },
  { v: "inativo_90d", l: "Paciente inativo (90d)" },
  { v: "retorno", l: "Retorno agendado" },
  { v: "no_show", l: "No-show / reagendamento" },
];

export default function TenantRecall() {
  const { tenant } = useTenant();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({ trigger_type: "pos_procedimento", trigger_days: 15, active: true });

  const load = async () => {
    if (!tenant) return;
    setLoading(true);
    const { data } = await supabase.from("recall_campaigns").select("*").eq("tenant_id", tenant.id).order("created_at");
    setCampaigns((data || []) as Campaign[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, [tenant]);

  const toggle = async (c: Campaign) => {
    await supabase.from("recall_campaigns").update({ active: !c.active }).eq("id", c.id);
    load();
  };

  const save = async () => {
    if (!tenant || !form.name || !form.message_template) { toast.error("Preencha nome e mensagem"); return; }
    setSaving(true);
    const { error } = await supabase.from("recall_campaigns").insert({ tenant_id: tenant.id, ...form });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Campanha criada");
    setOpen(false); setForm({ trigger_type: "pos_procedimento", trigger_days: 15, active: true }); load();
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Recall automático</h1>
          <p className="text-muted-foreground">Mensagens automáticas de reativação via WhatsApp — {tenant?.name}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2"><Plus className="w-4 h-4" /> Nova campanha</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nova campanha de recall</DialogTitle></DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1"><Label>Nome</Label><Input value={form.name || ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Reativação 60 dias" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Gatilho</Label>
                  <Select value={form.trigger_type} onValueChange={(v) => setForm({ ...form, trigger_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TRIGGERS.map((t) => <SelectItem key={t.v} value={t.v}>{t.l}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Dias após gatilho</Label>
                  <Input type="number" value={form.trigger_days} onChange={(e) => setForm({ ...form, trigger_days: Number(e.target.value) })} />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Mensagem (use {"{{nome}}"} e {"{{clinica}}"})</Label>
                <Textarea rows={4} value={form.message_template || ""} onChange={(e) => setForm({ ...form, message_template: e.target.value })}
                  placeholder="Oi {{nome}}, aqui é da {{clinica}}..." />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={save} disabled={saving} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Salvar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? <div className="p-12 text-center"><Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" /></div> : (
        <div className="grid md:grid-cols-2 gap-4">
          {campaigns.map((c) => (
            <Card key={c.id} className={c.active ? "border-primary/30" : "opacity-70"}>
              <CardHeader className="pb-2 flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-base flex items-center gap-2"><MessageSquareHeart className="w-4 h-4 text-primary" /> {c.name}</CardTitle>
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant="outline">{TRIGGERS.find((t) => t.v === c.trigger_type)?.l}</Badge>
                    <Badge variant="outline">{c.trigger_days}d</Badge>
                    {c.active && <Badge className="bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20">Ativa</Badge>}
                  </div>
                </div>
                <Switch checked={c.active} onCheckedChange={() => toggle(c)} />
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{c.message_template}</p>
              </CardContent>
            </Card>
          ))}
          {campaigns.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-12">Nenhuma campanha criada ainda.</p>}
        </div>
      )}

      <Card className="border-dashed">
        <CardContent className="p-4 flex items-start gap-3 text-sm text-muted-foreground">
          <Bell className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="text-foreground font-medium mb-1">Como funciona</p>
            O sistema verifica diariamente os gatilhos (pós-procedimento, aniversário, inatividade, no-show) e dispara automaticamente
            as mensagens via WhatsApp Z-API configurada em <strong>Configurações</strong>. Cada disparo fica registrado para auditoria.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
