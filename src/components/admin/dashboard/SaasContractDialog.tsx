import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type SaasContract = {
  id?: string;
  tenant_id: string;
  plan: string;
  status: "active" | "trial" | "past_due" | "canceled";
  mrr: number;
  billing_cycle: "monthly" | "yearly";
  started_at: string;
  renews_at?: string | null;
  canceled_at?: string | null;
  notes?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  tenants: { id: string; name: string }[];
  initial?: Partial<SaasContract> | null;
  onSaved: () => void;
};

export default function SaasContractDialog({ open, onOpenChange, tenants, initial, onSaved }: Props) {
  const [form, setForm] = useState<SaasContract>({
    tenant_id: tenants[0]?.id ?? "",
    plan: "starter",
    status: "active",
    mrr: 0,
    billing_cycle: "monthly",
    started_at: new Date().toISOString().slice(0, 10),
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({
        tenant_id: initial?.tenant_id ?? tenants[0]?.id ?? "",
        plan: initial?.plan ?? "starter",
        status: (initial?.status as any) ?? "active",
        mrr: Number(initial?.mrr ?? 0),
        billing_cycle: (initial?.billing_cycle as any) ?? "monthly",
        started_at: initial?.started_at ?? new Date().toISOString().slice(0, 10),
        renews_at: initial?.renews_at ?? null,
        canceled_at: initial?.canceled_at ?? null,
        notes: initial?.notes ?? "",
        id: initial?.id,
      });
    }
  }, [open, initial, tenants]);

  const save = async () => {
    if (!form.tenant_id) return toast.error("Selecione um cliente");
    setSaving(true);
    const payload: any = { ...form };
    if (!payload.renews_at) delete payload.renews_at;
    if (!payload.canceled_at) delete payload.canceled_at;
    const { error } = form.id
      ? await supabase.from("saas_contracts").update(payload).eq("id", form.id)
      : await supabase.from("saas_contracts").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(form.id ? "Contrato atualizado" : "Contrato criado");
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{form.id ? "Editar contrato" : "Novo contrato SaaS"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Cliente</Label>
            <select
              value={form.tenant_id}
              onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
              className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm"
            >
              {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Plano</Label>
              <Input value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} placeholder="starter / growth / scale" />
            </div>
            <div>
              <Label>Status</Label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as any })}
                className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="active">Ativo</option>
                <option value="trial">Trial</option>
                <option value="past_due">Inadimplente</option>
                <option value="canceled">Cancelado</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>MRR (R$)</Label>
              <Input type="number" step="0.01" value={form.mrr} onChange={(e) => setForm({ ...form, mrr: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Ciclo</Label>
              <select
                value={form.billing_cycle}
                onChange={(e) => setForm({ ...form, billing_cycle: e.target.value as any })}
                className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm"
              >
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Início</Label>
              <Input type="date" value={form.started_at} onChange={(e) => setForm({ ...form, started_at: e.target.value })} />
            </div>
            <div>
              <Label>Renova em</Label>
              <Input type="date" value={form.renews_at ?? ""} onChange={(e) => setForm({ ...form, renews_at: e.target.value || null })} />
            </div>
          </div>
          <div>
            <Label>Observações</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
