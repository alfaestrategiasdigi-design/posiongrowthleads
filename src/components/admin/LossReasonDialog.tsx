import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LOSS_REASONS } from "@/lib/loss-reasons";
import { XCircle } from "lucide-react";

interface Props {
  open: boolean;
  leadName?: string | null;
  initialValue?: string | null;
  onConfirm: (reason: string) => Promise<void> | void;
  onCancel: () => void;
}

export default function LossReasonDialog({ open, leadName, initialValue, onConfirm, onCancel }: Props) {
  const [reasonId, setReasonId] = useState<string>("");
  const [custom, setCustom] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initialValue) {
      const match = LOSS_REASONS.find((r) => r.label === initialValue);
      if (match) {
        setReasonId(match.id);
        setCustom("");
      } else {
        setReasonId("outro");
        setCustom(initialValue);
      }
    } else {
      setReasonId("");
      setCustom("");
    }
  }, [open, initialValue]);

  const isOutro = reasonId === "outro";
  const canSubmit = reasonId && (!isOutro || custom.trim().length > 0);

  const handleConfirm = async () => {
    if (!canSubmit) return;
    const opt = LOSS_REASONS.find((r) => r.id === reasonId);
    const value = isOutro ? custom.trim() : (opt?.label ?? reasonId);
    setSaving(true);
    try {
      await onConfirm(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <XCircle className="w-5 h-5 text-rose-400" /> Motivo da perda
          </DialogTitle>
          <DialogDescription>
            {leadName ? <>Selecione o motivo pelo qual o lead <strong>{leadName}</strong> foi perdido.</> : "Selecione o motivo da perda."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs">Motivo</Label>
            <Select value={reasonId} onValueChange={setReasonId}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione um motivo" /></SelectTrigger>
              <SelectContent>
                {LOSS_REASONS.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {isOutro && (
            <div>
              <Label className="text-xs">Descreva</Label>
              <Textarea
                rows={3}
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Ex: fora da área de atendimento, precisava de plano de saúde…"
                className="mt-1"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={saving}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={!canSubmit || saving} className="bg-rose-500 hover:bg-rose-600">
            {saving ? "Salvando…" : "Marcar como perdido"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
