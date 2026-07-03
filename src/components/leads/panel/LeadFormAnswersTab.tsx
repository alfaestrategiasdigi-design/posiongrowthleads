import { FileText } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import type { UnifiedLeadView } from "@/hooks/useUnifiedLead";

const prettifyLabel = (s: string) =>
  String(s || "")
    .replace(/_/g, " ")
    .replace(/\?+$/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const prettifyValue = (s: string) =>
  String(s || "")
    .replace(/^→[_\s]*/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export default function LeadFormAnswersTab({ lead }: { lead: UnifiedLeadView }) {
  const fields = lead.formFields || [];
  const fb = lead.facebookMeta || {};

  if (fields.length === 0 && !fb.form_id && !lead.raw.facebook_campaign) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
        Nenhuma resposta de formulário registrada para este lead.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(fb.form_id || fb.form_name || fb.campaign_name || lead.raw.facebook_campaign) && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div className="text-xs font-semibold flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 text-primary" /> Meta Lead Ads
            {fb.form_name && <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary">{fb.form_name}</span>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {fb.form_id && <Cell label="Formulário" value={fb.form_id} mono />}
            {fb.created_time && (
              <Cell
                label="Enviado em"
                value={format(new Date(fb.created_time), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              />
            )}
            {(fb.campaign_name || lead.raw.facebook_campaign) && (
              <Cell label="Campanha" value={fb.campaign_name || lead.raw.facebook_campaign} />
            )}
            {lead.raw.utm_source && <Cell label="UTM Source" value={lead.raw.utm_source} />}
            {lead.raw.utm_campaign && <Cell label="UTM Campaign" value={lead.raw.utm_campaign} />}
          </div>
        </div>
      )}

      {fields.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
          <div className="text-xs font-semibold flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" /> Respostas do formulário
            <span className="ml-auto text-[10px] text-muted-foreground">{fields.length} campo(s)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {fields.map((f: any, i: number) => (
              <Cell key={i} label={prettifyLabel(f.label || f.name)} value={prettifyValue(f.value) || "—"} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm break-words ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
