import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Loader2, Plus, Trash2, ListChecks, X, ChevronUp, ChevronDown, Eye, Save, GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import QualificationForm from "@/components/forms/QualificationForm";

type FieldType = "text" | "tel" | "choice" | "email";

type Field = {
  id: string;
  position: number;
  key: string;
  label: string;
  question: string;
  type: FieldType;
  placeholder: string | null;
  options: string[];
  required: boolean;
  active: boolean;
  disqualify_values: string[];
  db_column: string | null;
};

const TYPE_LABELS: Record<FieldType, string> = {
  text: "Texto curto",
  tel: "Telefone (WhatsApp)",
  choice: "Múltipla escolha",
  email: "E-mail",
};

const slugify = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ").trim()
    .split(/\s+/).map((w, i) => i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join("");

const QualificacaoPage = () => {
  const [items, setItems] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newQuestion, setNewQuestion] = useState("");
  const [newType, setNewType] = useState<FieldType>("text");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("qualification_fields" as any)
      .select("*")
      .order("position", { ascending: true });
    if (error) toast.error("Erro ao carregar campos");
    setItems(((data ?? []) as unknown as Field[]).map((f) => ({
      ...f,
      options: Array.isArray(f.options) ? f.options : [],
      disqualify_values: Array.isArray(f.disqualify_values) ? f.disqualify_values : [],
    })));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    if (!newLabel.trim() || !newQuestion.trim()) {
      toast.error("Preencha rótulo e pergunta");
      return;
    }
    const key = slugify(newLabel) || `campo_${Date.now()}`;
    const maxPos = items.reduce((m, x) => Math.max(m, x.position), 0);
    const { error } = await supabase.from("qualification_fields" as any).insert({
      key, label: newLabel.trim(), question: newQuestion.trim(),
      type: newType, position: maxPos + 1, options: [], disqualify_values: [],
      required: true, active: true,
    });
    if (error) { toast.error("Erro ao criar"); return; }
    toast.success("Campo criado");
    setNewLabel(""); setNewQuestion(""); setNewType("text"); setNewOpen(false);
    load();
  };

  const patch = async (id: string, patchData: Partial<Field>) => {
    setItems((prev) => prev.map((p) => p.id === id ? { ...p, ...patchData } : p));
    const { error } = await supabase.from("qualification_fields" as any).update(patchData as any).eq("id", id);
    if (error) { toast.error("Erro ao salvar"); load(); }
  };

  const move = async (id: string, dir: -1 | 1) => {
    const sorted = [...items].sort((a, b) => a.position - b.position);
    const idx = sorted.findIndex((x) => x.id === id);
    const swap = sorted[idx + dir];
    if (!swap) return;
    const a = sorted[idx];
    await Promise.all([
      supabase.from("qualification_fields" as any).update({ position: swap.position }).eq("id", a.id),
      supabase.from("qualification_fields" as any).update({ position: a.position }).eq("id", swap.id),
    ]);
    load();
  };

  const remove = async (c: Field) => {
    if (!confirm(`Excluir o campo "${c.label}"?`)) return;
    const { error } = await supabase.from("qualification_fields" as any).delete().eq("id", c.id);
    if (error) { toast.error("Erro ao excluir"); return; }
    toast.success("Campo excluído");
    load();
  };

  const toggleOption = (f: Field, opt: string) => {
    const set = new Set(f.options);
    if (set.has(opt)) set.delete(opt); else set.add(opt);
    patch(f.id, { options: Array.from(set) });
  };
  const toggleDisqualify = (f: Field, opt: string) => {
    const set = new Set(f.disqualify_values);
    if (set.has(opt)) set.delete(opt); else set.add(opt);
    patch(f.id, { disqualify_values: Array.from(set) });
  };

  const previewFields = items
    .filter((i) => i.active)
    .sort((a, b) => a.position - b.position)
    .map((i) => ({
      key: i.key, label: i.label, question: i.question, type: i.type,
      placeholder: i.placeholder, options: i.options, required: i.required,
      disqualify_values: i.disqualify_values, db_column: i.db_column,
    }));

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-3 mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/30 flex items-center justify-center">
            <ListChecks className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl text-foreground">Formulário de Qualificação</h1>
            <p className="text-sm text-muted-foreground">Construa, ordene e regule cada etapa do diagnóstico exibido na landing page.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="gap-2 border-primary/30 text-primary hover:bg-primary/10">
                <Eye className="w-4 h-4" /> Pré-visualizar
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl bg-card border-border">
              <DialogHeader>
                <DialogTitle>Pré-visualização do formulário</DialogTitle>
              </DialogHeader>
              {previewOpen && <QualificationForm fields={previewFields} preview />}
            </DialogContent>
          </Dialog>
          <Dialog open={newOpen} onOpenChange={setNewOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-gradient-to-r from-primary to-violet-500 text-primary-foreground">
                <Plus className="w-4 h-4" /> Novo campo
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-card border-border">
              <DialogHeader><DialogTitle>Novo campo</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Rótulo</label>
                  <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Ex.: Faturamento" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Pergunta</label>
                  <Textarea value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Ex.: Qual o faturamento mensal atual?" />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Tipo</label>
                  <Select value={newType} onValueChange={(v) => setNewType(v as FieldType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(TYPE_LABELS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={create} className="bg-gradient-to-r from-primary to-violet-500 text-primary-foreground gap-2">
                  <Plus className="w-4 h-4" /> Criar campo
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl mt-6">
          Nenhum campo cadastrado.
        </div>
      ) : (
        <div className="space-y-4 mt-6">
          {items.map((f, idx) => (
            <FieldCard
              key={f.id}
              f={f}
              first={idx === 0}
              last={idx === items.length - 1}
              onPatch={(p) => patch(f.id, p)}
              onMove={(dir) => move(f.id, dir)}
              onRemove={() => remove(f)}
              onToggleOption={(o) => toggleOption(f, o)}
              onToggleDisqualify={(o) => toggleDisqualify(f, o)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

function FieldCard({
  f, first, last, onPatch, onMove, onRemove, onToggleOption, onToggleDisqualify,
}: {
  f: Field; first: boolean; last: boolean;
  onPatch: (p: Partial<Field>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onToggleOption: (opt: string) => void;
  onToggleDisqualify: (opt: string) => void;
}) {
  const [draft, setDraft] = useState<Field>(f);
  const [newOpt, setNewOpt] = useState("");
  useEffect(() => setDraft(f), [f]);

  const dirty =
    draft.label !== f.label || draft.question !== f.question ||
    draft.placeholder !== f.placeholder || draft.type !== f.type ||
    draft.db_column !== f.db_column;

  return (
    <div className="rounded-2xl border border-border bg-card/60 backdrop-blur p-5">
      <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <div className="flex flex-col gap-1 pt-1">
            <button disabled={first} onClick={() => onMove(-1)} className="text-muted-foreground hover:text-primary disabled:opacity-30">
              <ChevronUp className="w-4 h-4" />
            </button>
            <GripVertical className="w-4 h-4 text-muted-foreground/50" />
            <button disabled={last} onClick={() => onMove(1)} className="text-muted-foreground hover:text-primary disabled:opacity-30">
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] uppercase tracking-wider text-primary border border-primary/30 bg-primary/5 rounded px-1.5 py-0.5">{TYPE_LABELS[f.type]}</span>
              <code className="text-[11px] text-muted-foreground">{f.key}</code>
              {f.db_column && <span className="text-[10px] text-muted-foreground/70">→ leads.{f.db_column}</span>}
            </div>
            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="text-base font-semibold" />
            <Textarea value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} className="text-sm" rows={2} />
            {f.type !== "choice" && (
              <Input value={draft.placeholder ?? ""} onChange={(e) => setDraft({ ...draft, placeholder: e.target.value })} placeholder="Placeholder" className="text-sm" />
            )}
            <Input value={draft.db_column ?? ""} onChange={(e) => setDraft({ ...draft, db_column: e.target.value || null })} placeholder="Coluna em leads (opcional, ex.: nome_completo)" className="text-xs text-muted-foreground" />
            {dirty && (
              <Button size="sm" onClick={() => onPatch({
                label: draft.label, question: draft.question, type: draft.type,
                placeholder: draft.placeholder, db_column: draft.db_column,
              })} className="gap-2 bg-primary text-primary-foreground">
                <Save className="w-3.5 h-3.5" /> Salvar alterações
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Obrigatório</span>
            <Switch checked={f.required} onCheckedChange={(v) => onPatch({ required: v })} />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{f.active ? "Ativo" : "Inativo"}</span>
            <Switch checked={f.active} onCheckedChange={(v) => onPatch({ active: v })} />
          </div>
          <Button variant="ghost" size="icon" onClick={onRemove} className="text-destructive hover:text-destructive">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {f.type === "choice" && (
        <div className="space-y-3 pt-3 border-t border-border/40">
          <div>
            <p className="text-xs text-muted-foreground mb-2">Opções de resposta</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {f.options.map((opt) => {
                const dq = f.disqualify_values.includes(opt);
                return (
                  <div key={opt} className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border ${
                    dq ? "bg-destructive/15 border-destructive/50 text-destructive" : "bg-secondary/60 border-border text-foreground/85"
                  }`}>
                    <button onClick={() => onToggleDisqualify(opt)} title={dq ? "Remover desqualificação" : "Marcar como desqualificadora"}>
                      {dq ? <X className="w-3 h-3" /> : <span className="w-2 h-2 rounded-full bg-primary/50 inline-block" />}
                    </button>
                    <span>{opt}</span>
                    <button onClick={() => onToggleOption(opt)} className="text-muted-foreground hover:text-destructive ml-1">
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
              {f.options.length === 0 && <span className="text-xs text-muted-foreground">Nenhuma opção. Adicione abaixo.</span>}
            </div>
            <div className="flex gap-2">
              <Input value={newOpt} onChange={(e) => setNewOpt(e.target.value)} placeholder="Nova opção" className="text-sm"
                onKeyDown={(e) => { if (e.key === "Enter" && newOpt.trim()) { onToggleOption(newOpt.trim()); setNewOpt(""); } }} />
              <Button size="sm" onClick={() => { if (newOpt.trim()) { onToggleOption(newOpt.trim()); setNewOpt(""); } }}>
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/70 mt-2">
              Clique no marcador para alternar entre <span className="text-primary">resposta válida</span> e <span className="text-destructive">resposta que desqualifica</span>.
            </p>
          </div>
          {f.disqualify_values.length > 0 && (
            <Badge variant="outline" className="text-xs border-destructive/40 text-destructive">
              {f.disqualify_values.length} resposta(s) desqualificam
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

export default QualificacaoPage;
