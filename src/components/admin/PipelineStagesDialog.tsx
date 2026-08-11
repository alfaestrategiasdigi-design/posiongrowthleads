import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowDown, ArrowUp, Loader2, Lock, Plus, Trash2 } from "lucide-react";
import type { StageDef } from "@/hooks/usePipelineStages";

const PALETTE = [
  { color: "from-blue-500 to-blue-600", hex: "#3b82f6" },
  { color: "from-violet-500 to-violet-600", hex: "#8b5cf6" },
  { color: "from-fuchsia-500 to-fuchsia-600", hex: "#d946ef" },
  { color: "from-pink-500 to-pink-600", hex: "#ec4899" },
  { color: "from-red-500 to-red-600", hex: "#ef4444" },
  { color: "from-orange-500 to-orange-600", hex: "#f97316" },
  { color: "from-amber-500 to-amber-600", hex: "#f59e0b" },
  { color: "from-lime-500 to-lime-600", hex: "#84cc16" },
  { color: "from-emerald-500 to-emerald-600", hex: "#10b981" },
  { color: "from-teal-500 to-teal-600", hex: "#14b8a6" },
  { color: "from-cyan-500 to-cyan-600", hex: "#06b6d4" },
  { color: "from-zinc-500 to-zinc-600", hex: "#71717a" },
  { color: "from-rose-500 to-rose-600", hex: "#f43f5e" },
];

interface DraftStage {
  key: string;
  rowId?: string;
  title: string;
  short: string;
  color: string;
  hex: string;
  isSystem: boolean;
}

interface PipelineStagesDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = funil global do POSION Master */
  tenantId: string | null;
  stages: StageDef[];
  /** quantidade de leads por etapa — impede excluir etapa em uso */
  leadCounts: Record<string, number>;
  onSaved: () => void;
}

const newKey = () => `custom_${Math.random().toString(36).slice(2, 10)}`;

export default function PipelineStagesDialog({
  open, onOpenChange, tenantId, stages, leadCounts, onSaved,
}: PipelineStagesDialogProps) {
  const [draft, setDraft] = useState<DraftStage[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDraft(stages.map((s) => ({
        key: s.id, rowId: s.rowId, title: s.title, short: s.short,
        color: s.color, hex: s.hex, isSystem: !!s.isSystem,
      })));
      setRemovedIds([]);
    }
  }, [open, stages]);

  const patch = (idx: number, p: Partial<DraftStage>) =>
    setDraft((d) => d.map((s, i) => (i === idx ? { ...s, ...p } : s)));

  const move = (idx: number, dir: -1 | 1) =>
    setDraft((d) => {
      const j = idx + dir;
      if (j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const cycleColor = (idx: number) =>
    setDraft((d) => {
      const cur = PALETTE.findIndex((p) => p.hex === d[idx].hex);
      const next = PALETTE[(cur + 1) % PALETTE.length];
      return d.map((s, i) => (i === idx ? { ...s, ...next } : s));
    });

  const remove = (idx: number) =>
    setDraft((d) => {
      const s = d[idx];
      if (s.rowId) setRemovedIds((r) => [...r, s.rowId!]);
      return d.filter((_, i) => i !== idx);
    });

  const addStage = () =>
    setDraft((d) => [
      ...d,
      { key: newKey(), title: "Nova etapa", short: "Nova", isSystem: false, ...PALETTE[d.length % PALETTE.length] },
    ]);

  const handleSave = async () => {
    if (draft.some((s) => !s.title.trim() || !s.short.trim())) {
      toast.error("Todas as etapas precisam de nome e abreviação");
      return;
    }
    setSaving(true);
    try {
      if (removedIds.length > 0) {
        const { error } = await (supabase as any).from("pipeline_stages").delete().in("id", removedIds);
        if (error) throw error;
      }
      const existing = draft.filter((s) => s.rowId);
      const fresh = draft.filter((s) => !s.rowId);
      if (existing.length > 0) {
        const { error } = await (supabase as any).from("pipeline_stages").upsert(
          existing.map((s) => ({
            id: s.rowId,
            tenant_id: tenantId,
            stage_key: s.key,
            title: s.title.trim(),
            short: s.short.trim(),
            color: s.color,
            hex: s.hex,
            position: draft.indexOf(s),
            is_system: s.isSystem,
          })),
        );
        if (error) throw error;
      }
      if (fresh.length > 0) {
        const { error } = await (supabase as any).from("pipeline_stages").insert(
          fresh.map((s) => ({
            tenant_id: tenantId,
            stage_key: s.key,
            title: s.title.trim(),
            short: s.short.trim(),
            color: s.color,
            hex: s.hex,
            position: draft.indexOf(s),
            is_system: false,
          })),
        );
        if (error) throw error;
      }
      toast.success("Etapas atualizadas");
      onOpenChange(false);
      onSaved();
    } catch (e: any) {
      console.error(e);
      toast.error("Erro ao salvar etapas", {
        description: e?.message?.includes("row-level security") || e?.code === "42501"
          ? "Apenas o dono ou administradores do cliente podem editar o funil."
          : e?.message || "Tente novamente.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Etapas do funil</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Renomeie, reordene, mude a cor ou crie novas etapas — como no Kommo. Etapas com
          <Lock className="inline w-3 h-3 mx-1 -mt-0.5" />
          alimentam automações e não podem ser excluídas.
        </p>

        <TooltipProvider delayDuration={200}>
          <div className="space-y-1.5 max-h-[52vh] overflow-y-auto pr-1">
            {draft.map((s, idx) => {
              const count = leadCounts[s.key] ?? 0;
              const deleteBlocked = s.isSystem || count > 0;
              const deleteHint = s.isSystem
                ? "Etapa de sistema (automações)"
                : count > 0
                  ? `${count} lead(s) nesta etapa`
                  : "Excluir etapa";
              return (
                <div key={s.key} className="flex items-center gap-1.5 rounded-md border border-border bg-card p-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => cycleColor(idx)}
                        className="w-7 h-7 rounded-md shrink-0 border border-black/10 shadow-inner transition-transform hover:scale-105"
                        style={{ backgroundColor: s.hex }}
                        aria-label="Mudar cor"
                      />
                    </TooltipTrigger>
                    <TooltipContent>Mudar cor</TooltipContent>
                  </Tooltip>

                  <Input
                    value={s.title}
                    onChange={(e) => patch(idx, { title: e.target.value })}
                    className="h-8 text-sm flex-[2] min-w-0"
                    placeholder="Nome da etapa"
                  />
                  <Input
                    value={s.short}
                    onChange={(e) => patch(idx, { short: e.target.value })}
                    className="h-8 text-sm flex-1 min-w-0"
                    placeholder="Abreviação"
                    title="Abreviação exibida no cabeçalho da coluna"
                  />

                  <div className="flex items-center shrink-0">
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(idx, -1)} disabled={idx === 0}>
                      <ArrowUp className="w-3.5 h-3.5" />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => move(idx, 1)} disabled={idx === draft.length - 1}>
                      <ArrowDown className="w-3.5 h-3.5" />
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button
                            type="button" variant="ghost" size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive disabled:opacity-40"
                            onClick={() => remove(idx)}
                            disabled={deleteBlocked}
                          >
                            {s.isSystem ? <Lock className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>{deleteHint}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>
        </TooltipProvider>

        <Button type="button" variant="outline" size="sm" onClick={addStage} className="gap-1.5 self-start">
          <Plus className="w-3.5 h-3.5" /> Adicionar etapa
        </Button>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Salvar etapas
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
