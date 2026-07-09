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
  const toLocalInput = (iso: string | null | undefined) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 16);
  };

  const [stage, setStage] = useState(lead.stage);
  const [valor, setValor] = useState(lead.proposalValue != null ? String(lead.proposalValue) : "");
  const [notes, setNotes] = useState(lead.notes || "");
  const [reuniaoAt, setReuniaoAt] = useState(
    toLocalInput(lead.source === "lead" ? lead.raw.reuniao_agendada_em : lead.raw.proximo_followup)
  );
  const [propostaAt, setPropostaAt] = useState(
    toLocalInput(lead.source === "lead" ? lead.raw.proposta_enviada_em : lead.raw.proposta_enviada_em)
  );
  const [saving, setSaving] = useState(false);


  useEffect(() => {
    setStage(lead.stage);
    setValor(lead.proposalValue != null ? String(lead.proposalValue) : "");
    setNotes(lead.notes || "");
    setReuniaoAt(toLocalInput(lead.source === "lead" ? lead.raw.reuniao_agendada_em : lead.raw.proximo_followup));
    setPropostaAt(toLocalInput(lead.raw.proposta_enviada_em));
  }, [lead.id]);

  const stagesForSource = lead.source === "lead"
    ? PIPELINE_STAGES.map((s) => ({ id: s.id, title: s.title }))
    : AGENCY_STAGES;

  const stageField = lead.source === "lead" ? "status" : "stage";
  const valorField = "valor_proposta";
  const notesField = lead.source === "lead" ? "observacoes" : "notas";

  const showReuniaoField = lead.source === "lead"
    ? ["reuniao_agendada", "compareceu", "negociacao", "ganho", "perdido"].includes(stage)
    : ["reuniao", "proposta", "negociacao", "ganho", "perdido"].includes(stage);
  const showPropostaField = lead.source === "lead"
    ? ["negociacao", "ganho", "perdido"].includes(stage)
    : ["proposta", "negociacao", "ganho", "perdido"].includes(stage);

  const handleSave = async () => {
    setSaving(true);
    const patch: Record<string, any> = {
      [stageField]: stage,
      [valorField]: valor !== "" ? Number(valor) : null,
      [notesField]: notes || null,
    };
    const reuniaoIso = reuniaoAt ? new Date(reuniaoAt).toISOString() : null;
    const propostaIso = propostaAt ? new Date(propostaAt).toISOString() : null;
    if (lead.source === "lead") {
      const now = new Date().toISOString();
      if (stage === "qualificado") { patch.mql = true; patch.sql_qualified = true; }
      if (showReuniaoField) {
        patch.reuniao_agendada_em = reuniaoIso ?? (lead.raw.reuniao_agendada_em || now);
      }
      if (stage === "compareceu" && !lead.raw.reuniao_realizada_em) patch.reuniao_realizada_em = now;
      if (showPropostaField) {
        patch.proposta_enviada_em = propostaIso ?? (lead.raw.proposta_enviada_em || now);
      }
      if ((stage === "ganho" || stage === "perdido") && !lead.raw.fechado_em) patch.fechado_em = now;
    } else {
      if (showReuniaoField && reuniaoIso) patch.proximo_followup = reuniaoIso;
      if (showPropostaField) patch.proposta_enviada_em = propostaIso ?? new Date().toISOString();
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

      {(showReuniaoField || showPropostaField) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {showReuniaoField && (
            <div>
              <Label className="text-xs">Data da reunião</Label>
              <Input
                type="datetime-local"
                value={reuniaoAt}
                onChange={(e) => setReuniaoAt(e.target.value)}
                className="mt-1"
              />
            </div>
          )}
          {showPropostaField && (
            <div>
              <Label className="text-xs">Data da proposta</Label>
              <Input
                type="datetime-local"
                value={propostaAt}
                onChange={(e) => setPropostaAt(e.target.value)}
                className="mt-1"
              />
            </div>
          )}
        </div>
      )}

      <div>
        <Label className="text-xs">Observações comerciais</Label>
        <Textarea rows={10} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 min-h-[220px]" placeholder="Notas internas..." />
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full gap-2">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar alterações
      </Button>

      {isTenantContext && lead.source === "lead" && lead.tenantId && (
        <LeadAppointmentsSection
          tenantId={lead.tenantId}
          leadId={lead.id}
          leadName={lead.name}
          leadPhone={lead.whatsapp}
        />
      )}

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

        {lead.source === "lead" && lead.raw.reuniao_agendada_em && (
          <Field
            label="Reunião agendada"
            value={format(new Date(lead.raw.reuniao_agendada_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          />
        )}
        {lead.source === "lead" && lead.raw.reuniao_realizada_em && (
          <Field
            label="Reunião realizada"
            value={format(new Date(lead.raw.reuniao_realizada_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          />
        )}
        {lead.source === "agency_lead" && lead.raw.proximo_followup && (
          <Field
            label="Próxima reunião"
            value={format(new Date(lead.raw.proximo_followup), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
          />
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
