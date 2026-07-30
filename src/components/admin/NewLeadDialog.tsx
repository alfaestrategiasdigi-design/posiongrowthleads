import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

type StageDef = { id: string; title: string };

interface NewLeadDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  tenantId?: string | null;
  stages: readonly StageDef[];
  onCreated: () => void;
}

const ORIGENS = [
  { id: "site", label: "Site" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "indicacao", label: "Indicação" },
  { id: "facebook_ads", label: "Facebook Ads" },
  { id: "outro", label: "Outro" },
];

const maskPhone = (v: string) => {
  const d = v.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d{0,4})(\d{0,4})/, (_, a, b, c) => [a && `(${a})`, b, c && `-${c}`].filter(Boolean).join(" ").trim());
  return d.replace(/(\d{2})(\d{5})(\d{0,4})/, (_, a, b, c) => `(${a}) ${b}${c ? `-${c}` : ""}`);
};

export default function NewLeadDialog({ open, onOpenChange, tenantId, stages, onCreated }: NewLeadDialogProps) {
  const [saving, setSaving] = useState(false);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [cidade, setCidade] = useState("");
  const [origem, setOrigem] = useState("whatsapp");
  const [status, setStatus] = useState(stages[0]?.id ?? "lead");
  const [valor, setValor] = useState("");

  const reset = () => {
    setNome(""); setWhatsapp(""); setEmail(""); setCidade("");
    setOrigem("whatsapp"); setStatus(stages[0]?.id ?? "lead"); setValor("");
  };

  const handleSave = async () => {
    if (!nome.trim() || whatsapp.replace(/\D/g, "").length < 10) {
      toast.error("Informe nome e WhatsApp válido");
      return;
    }
    setSaving(true);
    const payload: any = {
      nome_completo: nome.trim(),
      whatsapp: whatsapp.trim(),
      email: email.trim() || null,
      cidade_estado: cidade.trim() || null,
      origem,
      status,
      tenant_id: tenantId ?? null,
      valor_proposta: valor ? Number(valor.replace(/\./g, "").replace(",", ".")) : null,
    };
    const { error } = await supabase.from("leads").insert(payload);
    setSaving(false);
    if (error) { toast.error("Erro ao criar lead"); return; }
    toast.success("Lead criado");
    reset();
    onOpenChange(false);
    onCreated();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Novo lead</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="nl-nome">Nome completo *</Label>
            <Input id="nl-nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Maria Silva" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nl-wpp">WhatsApp *</Label>
            <Input id="nl-wpp" value={whatsapp} onChange={(e) => setWhatsapp(maskPhone(e.target.value))} placeholder="(11) 99999-9999" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nl-email">E-mail</Label>
            <Input id="nl-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="opcional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nl-cidade">Cidade/Estado</Label>
            <Input id="nl-cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="opcional" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nl-valor">Valor da proposta (R$)</Label>
            <Input id="nl-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="0,00" />
          </div>
          <div className="space-y-1.5">
            <Label>Origem</Label>
            <Select value={origem} onValueChange={setOrigem}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORIGENS.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Etapa</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {stages.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Criar lead
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
