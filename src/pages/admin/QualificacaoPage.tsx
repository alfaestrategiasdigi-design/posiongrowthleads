import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Trash2, ListChecks, X } from "lucide-react";
import { toast } from "sonner";

type Criterion = {
  id: string;
  field: string;
  label: string;
  disqualify_values: string[];
  active: boolean;
};

const fieldChoices: Record<string, { label: string; options: string[] }> = {
  faturamento_mensal: {
    label: "Faturamento mensal",
    options: [
      "Abaixo de R$10 mil",
      "R$10 mil a R$30 mil",
      "R$31 mil a R$50 mil",
      "R$51 mil a R$100 mil",
      "R$101 mil a R$300 mil",
      "Acima de R$300 mil",
    ],
  },
  investiuTrafego: {
    label: "Já investiu em tráfego pago",
    options: [
      "Nunca investi",
      "Já investi por conta própria",
      "Já contratei uma agência no passado",
      "Faço tráfego internamente",
      "Tenho agência atualmente",
    ],
  },
  numProfissionais: {
    label: "Número de profissionais",
    options: ["1", "2 a 5", "6 a 10", "Acima de 10"],
  },
  especialidade: {
    label: "Especialidade",
    options: [
      "Odontologia", "Estética", "Dermatologia", "Cirurgia Plástica",
      "Transplante Capilar", "Fisioterapia", "Oftalmologia", "Nutrição", "Outro",
    ],
  },
};

// Form field names used by the quiz
const fieldOptions = [
  { value: "faturamentoMensal", dbKey: "faturamento_mensal" },
  { value: "investiuTrafego", dbKey: "investiuTrafego" },
  { value: "numProfissionais", dbKey: "numProfissionais" },
  { value: "especialidade", dbKey: "especialidade" },
];

// Map quiz field -> options bank
const optionsFor = (field: string): string[] => {
  if (field === "faturamentoMensal") return fieldChoices.faturamento_mensal.options;
  if (field === "investiuTrafego") return fieldChoices.investiuTrafego.options;
  if (field === "numProfissionais") return fieldChoices.numProfissionais.options;
  if (field === "especialidade") return fieldChoices.especialidade.options;
  return [];
};

const QualificacaoPage = () => {
  const [items, setItems] = useState<Criterion[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newField, setNewField] = useState<string>("faturamentoMensal");
  const [newLabel, setNewLabel] = useState<string>("Faturamento mensal");

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("qualification_criteria")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) toast.error("Erro ao carregar critérios");
    setItems((data as unknown as Criterion[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const create = async () => {
    setCreating(true);
    const { error } = await supabase.from("qualification_criteria").insert({
      field: newField,
      label: newLabel,
      disqualify_values: [],
      active: true,
    });
    setCreating(false);
    if (error) { toast.error("Erro ao criar critério"); return; }
    toast.success("Critério criado");
    load();
  };

  const toggleValue = async (c: Criterion, value: string) => {
    const set = new Set(c.disqualify_values ?? []);
    if (set.has(value)) set.delete(value); else set.add(value);
    const updated = Array.from(set);
    setItems((prev) => prev.map((p) => p.id === c.id ? { ...p, disqualify_values: updated } : p));
    const { error } = await supabase.from("qualification_criteria").update({ disqualify_values: updated }).eq("id", c.id);
    if (error) { toast.error("Erro ao salvar"); load(); }
  };

  const toggleActive = async (c: Criterion) => {
    const next = !c.active;
    setItems((prev) => prev.map((p) => p.id === c.id ? { ...p, active: next } : p));
    const { error } = await supabase.from("qualification_criteria").update({ active: next }).eq("id", c.id);
    if (error) { toast.error("Erro ao atualizar"); load(); }
  };

  const remove = async (c: Criterion) => {
    if (!confirm(`Excluir critério "${c.label}"?`)) return;
    const { error } = await supabase.from("qualification_criteria").delete().eq("id", c.id);
    if (error) { toast.error("Erro ao excluir"); return; }
    toast.success("Critério excluído");
    load();
  };

  return (
    <div className="p-6 md:p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center">
          <ListChecks className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="font-display text-2xl text-foreground">Critérios de Qualificação</h1>
          <p className="text-sm text-muted-foreground">Defina quais respostas do quiz desqualificam um lead automaticamente.</p>
        </div>
      </div>

      {/* Criar novo */}
      <div className="card-elevated p-5 mt-6 mb-8">
        <p className="text-sm font-medium text-foreground mb-4">Novo critério</p>
        <div className="grid md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="form-label">Campo avaliado</label>
            <Select value={newField} onValueChange={(v) => {
              setNewField(v);
              const found = fieldOptions.find((f) => f.value === v);
              if (found) {
                if (v === "faturamentoMensal") setNewLabel("Faturamento mensal");
                else if (v === "investiuTrafego") setNewLabel("Já investiu em tráfego");
                else if (v === "numProfissionais") setNewLabel("Número de profissionais");
                else if (v === "especialidade") setNewLabel("Especialidade");
              }
            }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {fieldOptions.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.value}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="form-label">Rótulo (exibição)</label>
            <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
          </div>
          <Button onClick={create} disabled={creating} className="gradient-accent text-primary-foreground gap-2">
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Criar
          </Button>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-accent" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground border border-dashed border-border rounded-2xl">
          Nenhum critério cadastrado. Todos os leads serão considerados qualificados.
        </div>
      ) : (
        <div className="space-y-4">
          {items.map((c) => {
            const opts = optionsFor(c.field);
            return (
              <div key={c.id} className="card-tech p-5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div>
                    <p className="font-semibold text-foreground">{c.label}</p>
                    <p className="text-xs text-muted-foreground">Campo: <code className="text-accent">{c.field}</code></p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{c.active ? "Ativo" : "Inativo"}</span>
                      <Switch checked={c.active} onCheckedChange={() => toggleActive(c)} />
                    </div>
                    <Button variant="ghost" size="icon" onClick={() => remove(c)} className="text-destructive hover:text-destructive">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground mb-2">Marque as respostas que DESQUALIFICAM o lead:</p>
                <div className="flex flex-wrap gap-2">
                  {opts.length === 0 && <span className="text-xs text-muted-foreground">Campo sem opções pré-definidas.</span>}
                  {opts.map((opt) => {
                    const selected = (c.disqualify_values ?? []).includes(opt);
                    return (
                      <button
                        key={opt}
                        onClick={() => toggleValue(c, opt)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition ${
                          selected
                            ? "bg-destructive/15 border-destructive/50 text-destructive"
                            : "bg-secondary/60 border-border text-foreground/80 hover:border-accent/40"
                        }`}
                      >
                        {selected && <X className="w-3 h-3 inline mr-1" />}
                        {opt}
                      </button>
                    );
                  })}
                </div>

                {(c.disqualify_values ?? []).length > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <Badge variant="outline" className="text-xs border-destructive/40 text-destructive">
                      {c.disqualify_values.length} resposta(s) desqualificam
                    </Badge>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default QualificacaoPage;