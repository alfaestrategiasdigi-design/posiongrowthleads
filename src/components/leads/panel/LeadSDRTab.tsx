import { useEffect, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, Target, TrendingUp, Flame, Snowflake } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { UnifiedLeadView, SDRQualification } from "@/hooks/useUnifiedLead";

const TIMELINES = [
  { v: "imediato", label: "Imediato" },
  { v: "30d", label: "Em 30 dias" },
  { v: "60_90d", label: "60-90 dias" },
  { v: "90d+", label: "Mais de 90 dias" },
  { v: "indefinido", label: "Indefinido" },
];

const scoreBadge = (score: number) => {
  if (score >= 70) return { label: "Quente", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/40", icon: Flame };
  if (score >= 40) return { label: "Morno", cls: "bg-amber-500/15 text-amber-500 border-amber-500/40", icon: TrendingUp };
  return { label: "Frio", cls: "bg-sky-500/15 text-sky-500 border-sky-500/40", icon: Snowflake };
};

interface Props {
  lead: UnifiedLeadView;
  onSave: (sdr: SDRQualification) => Promise<void> | void;
}

export default function LeadSDRTab({ lead, onSave }: Props) {
  const initial = lead.sdr || {};
  const [goals, setGoals] = useState(initial.goals || "");
  const [plans, setPlans] = useState(initial.plans || "");
  const [challenges, setChallenges] = useState(initial.challenges || "");
  const [timeline, setTimeline] = useState(initial.timeline || "indefinido");
  const [score, setScore] = useState<number>(initial.score ?? 50);
  const [notes, setNotes] = useState(initial.notes || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const s = lead.sdr || {};
    setGoals(s.goals || "");
    setPlans(s.plans || "");
    setChallenges(s.challenges || "");
    setTimeline(s.timeline || "indefinido");
    setScore(s.score ?? 50);
    setNotes(s.notes || "");
  }, [lead.id]);

  const badge = scoreBadge(score);
  const Icon = badge.icon;

  const handleSave = async () => {
    setSaving(true);
    await onSave({ goals, plans, challenges, timeline, score, notes });
    toast.success("Qualificação SDR salva");
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center">
          <Target className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold">Qualificação SDR — GPCT</div>
          <div className="text-[11px] text-muted-foreground">
            Goals · Plans · Challenges · Timeline
            {lead.sdr?.updated_at && (
              <> · atualizado {format(new Date(lead.sdr.updated_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}</>
            )}
          </div>
        </div>
        <Badge variant="outline" className={`gap-1 ${badge.cls}`}><Icon className="w-3 h-3" /> {badge.label} · {score}</Badge>
      </div>

      <div className="space-y-4">
        <div>
          <Label className="text-xs">Goals — Objetivos do lead</Label>
          <Textarea rows={3} value={goals} onChange={(e) => setGoals(e.target.value)} className="mt-1"
            placeholder="Ex: aumentar volume de pacientes em 30% em 6 meses" />
        </div>
        <div>
          <Label className="text-xs">Plans — Planos atuais</Label>
          <Textarea rows={3} value={plans} onChange={(e) => setPlans(e.target.value)} className="mt-1"
            placeholder="O que está fazendo hoje para chegar lá?" />
        </div>
        <div>
          <Label className="text-xs">Challenges — Desafios / dores</Label>
          <Textarea rows={3} value={challenges} onChange={(e) => setChallenges(e.target.value)} className="mt-1"
            placeholder="Bloqueios, gargalos, frustrações" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Timeline</Label>
            <Select value={timeline} onValueChange={setTimeline}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMELINES.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label className="text-xs">Score SDR</Label>
              <span className="text-xs font-bold tabular-nums">{score}/100</span>
            </div>
            <Slider value={[score]} onValueChange={(v) => setScore(v[0])} min={0} max={100} step={5} className="mt-2" />
          </div>
        </div>

        <div>
          <Label className="text-xs">Notas do SDR</Label>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1"
            placeholder="Contexto extra, próximos passos, observações..." />
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar qualificação
      </Button>
    </div>
  );
}
