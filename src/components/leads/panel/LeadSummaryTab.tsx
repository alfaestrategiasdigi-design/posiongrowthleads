import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { UnifiedLeadView } from "@/hooks/useUnifiedLead";
import { PIPELINE_STAGES } from "@/types/admin";
import LeadAppointmentsSection from "@/components/tenant/LeadAppointmentsSection";


const AGENCY_STAGES = [
  { id: "lead", title: "Lead" },
  { id: "qualificado", title: "Qualificado" },
  { id: "reuniao", title: "Reunião" },
  { id: "proposta", title: "Proposta" },
  { id: "negociacao", title: "Negociação" },
  { id: "ganho", title: "Ganho" },
  { id: "perdido", title: "Perdido" },
];

interface Props {
  lead: UnifiedLeadView;
  onSave: (patch: Record<string, any>) => Promise<void> | void;
}

export default function LeadSummaryTab({ lead, onSave }: Props) {
  const location = useLocation();
  const isTenantContext = location.pathname.startsWith("/app/");
  const [stage, setStage] = useState(lead.stage);
  const [valor, setValor] = useState(lead.proposalValue ? String(lead.proposalValue) : "");
  const [notes, setNotes] = useState(lead.notes || "");
  const [saving, setSaving] = useState(false);


  useEffect(() => {
    setStage(lead.stage);
    setValor(lead.proposalValue ? String(lead.proposalValue) : "");
    setNotes(lead.notes || "");
  }, [lead.id]);

  const stagesForSource = lead.source === "lead"
    ? PIPELINE_STAGES.map((s) => ({ id: s.id, title: s.title }))
    : AGENCY_STAGES;

  const stageField = lead.source === "lead" ? "status" : "stage";
  const valorField = "valor_proposta";
  const notesField = lead.source === "lead" ? "observacoes" : "notas";

  const handleSave = async () => {
    setSaving(true);
    const patch: Record<string, any> = {
      [stageField]: stage,
      [valorField]: valor ? Number(valor) : null,
      [notesField]: notes || null,
    };
    if (lead.source === "lead") {
      const now = new Date().toISOString();
      if (stage === "qualificado") { patch.mql = true; patch.sql_qualified = true; }
      if (stage === "reuniao_agendada" && !lead.raw.reuniao_agendada_em) patch.reuniao_agendada_em = now;
      if (stage === "compareceu" && !lead.raw.reuniao_realizada_em) patch.reuniao_realizada_em = now;
      if (stage === "negociacao" && !lead.raw.proposta_enviada_em) patch.proposta_enviada_em = now;
      if ((stage === "ganho" || stage === "perdido") && !lead.raw.fechado_em) patch.fechado_em = now;
    }
    await onSave(patch);
    setSaving(false);
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs">Etapa do pipeline</Label>
          <Select value={stage} onValueChange={setStage}>
            <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
            <SelectContent>
              {stagesForSource.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Valor da proposta (R$)</Label>
          <Input type="number" min="0" step="100" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-1" />
        </div>
      </div>

      <div>
        <Label className="text-xs">Observações comerciais</Label>
        <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" placeholder="Notas internas..." />
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar alterações
      </Button>

      {/* Diagnóstico rápido */}
      <div className="grid grid-cols-2 gap-2 pt-3 border-t border-border/40 text-sm">
        {!isTenantContext && <Field label="Empresa" value={lead.company} />}
        {!isTenantContext && <Field label={lead.volumeLabel} value={lead.volume} />}
        <Field label="Cidade" value={lead.city} />
        <Field label="E-mail" value={lead.email} />
        <Field label="WhatsApp" value={lead.whatsapp} />
        <Field label="Origem" value={lead.origem} />
        {lead.source === "lead" && !isTenantContext && (
          <>
            <Field label="Especialidade" value={lead.raw.especialidade} />
            <Field label="Nº profissionais" value={lead.raw.num_profissionais} />
            <Field label="Investiu tráfego" value={lead.raw.investiu_trafego} />
            <Field label="CNPJ" value={lead.raw.cnpj} />
          </>
        )}

        <Field
          label="Criado em"
          value={lead.createdAt ? format(new Date(lead.createdAt), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : null}
        />
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="rounded-md border border-border/40 bg-muted/20 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground truncate">{value || "—"}</div>
    </div>
  );
}
