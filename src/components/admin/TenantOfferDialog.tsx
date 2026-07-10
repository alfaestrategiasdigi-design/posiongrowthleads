import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";

interface Tenant { id: string; name: string; slug: string }

interface Offer {
  id: string;
  tenant_id: string;
  label: string;
  kind: "custom" | "founder" | "standard";
  entry_amount_cents: number;
  entry_cycles: number;
  interval: "month" | "quarter" | "semester";
  recurring_amount_cents: number;
  description: string | null;
  active: boolean;
  expires_at: string | null;
}

export function TenantOfferDialog({
  tenant, open, onClose,
}: { tenant: Tenant | null; open: boolean; onClose: () => void }) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<Offer | null>(null);
  const [form, setForm] = useState({
    label: "Oferta especial",
    kind: "custom" as Offer["kind"],
    entry_reais: "100",
    entry_cycles: "3",
    interval: "month" as Offer["interval"],
    recurring_reais: "389",
    description: "",
    active: true,
    expires_at: "",
  });

  useEffect(() => {
    if (!open || !tenant) return;
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any).from("tenant_custom_offers")
        .select("*").eq("tenant_id", tenant.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      setLoading(false);
      if (data) {
        setExisting(data);
        setForm({
          label: data.label,
          kind: data.kind,
          entry_reais: (data.entry_amount_cents / 100).toString(),
          entry_cycles: String(data.entry_cycles),
          interval: data.interval,
          recurring_reais: (data.recurring_amount_cents / 100).toString(),
          description: data.description ?? "",
          active: data.active,
          expires_at: data.expires_at ? data.expires_at.slice(0, 10) : "",
        });
      } else {
        setExisting(null);
        setForm((f) => ({ ...f, label: "Oferta especial", kind: "custom" }));
      }
    })();
  }, [open, tenant]);

  const save = async () => {
    if (!tenant) return;
    const entry = Number(form.entry_reais.replace(",", "."));
    const rec = Number(form.recurring_reais.replace(",", "."));
    const cycles = Number(form.entry_cycles);
    if (!isFinite(entry) || entry <= 0) return toast.error("Valor de entrada inválido");
    if (!isFinite(rec) || rec <= 0) return toast.error("Valor recorrente inválido");
    if (!Number.isInteger(cycles) || cycles < 1) return toast.error("Ciclos inválidos");

    setSaving(true);
    const payload = {
      tenant_id: tenant.id,
      label: form.label.trim() || "Oferta especial",
      kind: form.kind,
      entry_amount_cents: Math.round(entry * 100),
      entry_cycles: cycles,
      interval: form.interval,
      recurring_amount_cents: Math.round(rec * 100),
      description: form.description.trim() || null,
      active: form.active,
      expires_at: form.expires_at ? new Date(form.expires_at + "T23:59:59").toISOString() : null,
    };

    let err;
    if (existing) {
      const r = await (supabase as any).from("tenant_custom_offers")
        .update(payload).eq("id", existing.id);
      err = r.error;
    } else {
      const r = await (supabase as any).from("tenant_custom_offers")
        .insert(payload);
      err = r.error;
    }
    setSaving(false);
    if (err) return toast.error(err.message);
    toast.success("Oferta salva. A clínica já visualiza no painel de Planos.");
    onClose();
  };

  const remove = async () => {
    if (!existing) return;
    if (!confirm("Remover esta oferta?")) return;
    setSaving(true);
    const { error } = await (supabase as any).from("tenant_custom_offers")
      .delete().eq("id", existing.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Oferta removida");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg bg-[#0B1220] border-primary/30">
        <DialogHeader>
          <DialogTitle>Configurar oferta — {tenant?.name}</DialogTitle>
          <DialogDescription>
            Define o valor de entrada (Pix), quantos ciclos ficam nesse valor e o valor recorrente depois.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Rótulo</Label>
                <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </div>
              <div>
                <Label>Tipo</Label>
                <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Personalizada</SelectItem>
                    <SelectItem value="founder">Fundador POSION</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Entrada (R$)</Label>
                <Input value={form.entry_reais} onChange={(e) => setForm({ ...form, entry_reais: e.target.value })} />
              </div>
              <div>
                <Label>Ciclos nessa entrada</Label>
                <Input value={form.entry_cycles} onChange={(e) => setForm({ ...form, entry_cycles: e.target.value })} />
              </div>
              <div>
                <Label>Intervalo</Label>
                <Select value={form.interval} onValueChange={(v) => setForm({ ...form, interval: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Mensal</SelectItem>
                    <SelectItem value="quarter">Trimestral</SelectItem>
                    <SelectItem value="semester">Semestral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Valor recorrente após (R$/{form.interval === "month" ? "mês" : form.interval === "quarter" ? "trimestre" : "semestre"})</Label>
                <Input value={form.recurring_reais} onChange={(e) => setForm({ ...form, recurring_reais: e.target.value })} />
              </div>
              <div>
                <Label>Expira em (opcional)</Label>
                <Input type="date" value={form.expires_at} onChange={(e) => setForm({ ...form, expires_at: e.target.value })} />
              </div>
            </div>

            <div>
              <Label>Descrição (mostrada no card e no Pix)</Label>
              <Input
                value={form.description}
                placeholder={`Ex.: ${form.entry_cycles} ${form.interval === "month" ? "meses" : "ciclos"} por R$ ${form.entry_reais} · depois R$ ${form.recurring_reais}/mês`}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-2">
              <div>
                <div className="text-sm font-medium">Oferta ativa</div>
                <div className="text-xs text-muted-foreground">Quando ativa, aparece como card destaque na página de Planos da clínica.</div>
              </div>
              <Switch checked={form.active} onCheckedChange={(v) => setForm({ ...form, active: v })} />
            </div>

            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-primary/90">
              Prévia: <b>{form.entry_cycles}× {form.interval === "month" ? "mês" : form.interval === "quarter" ? "trimestre" : "semestre"} por R$ {form.entry_reais}</b> · depois R$ {form.recurring_reais}/{form.interval === "month" ? "mês" : form.interval === "quarter" ? "trimestre" : "semestre"}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          {existing && (
            <Button variant="ghost" onClick={remove} disabled={saving} className="text-rose-300 hover:text-rose-200 mr-auto">
              <Trash2 className="w-4 h-4 mr-1" /> Remover
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar oferta"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
