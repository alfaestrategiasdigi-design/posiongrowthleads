import { FileText, Megaphone } from "lucide-react";
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

const prettifyValue = (raw: any): string => {
  if (raw == null) return "—";
  if (Array.isArray(raw)) return raw.map(prettifyValue).filter(Boolean).join(", ") || "—";
  if (typeof raw === "object") {
    try {
      return JSON.stringify(raw);
    } catch {
      return String(raw);
    }
  }
  const s = String(raw)
    .replace(/^→[_\s]*/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "—";
  // Sentence-case: first char up
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// Fields already surfaced at the top of the panel — hide from the form list.
const HIDDEN_NAMES = new Set([
  "full_name",
  "nome_completo",
  "nome",
  "name",
  "phone_number",
  "phone",
  "telefone",
  "whatsapp",
  "celular",
  "email",
  "e_mail",
  "e-mail",
]);

const isHiddenField = (f: any) => {
  const n = String(f?.name || f?.label || "").toLowerCase().replace(/\s+/g, "_");
  return HIDDEN_NAMES.has(n);
};

export default function LeadFormAnswersTab({ lead }: { lead: UnifiedLeadView }) {
  const allFields: any[] = lead.formFields || [];
  const questionFields = allFields.filter((f) => !isHiddenField(f));
  const contactFields = allFields.filter(isHiddenField);
  const fb = lead.facebookMeta || {};

  const hasMeta =
    fb.form_id || fb.form_name || fb.campaign_name || fb.ad_name || fb.adset_name || lead.raw.facebook_campaign;

  if (allFields.length === 0 && !hasMeta) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground">
        <FileText className="w-8 h-8 mx-auto mb-2 opacity-40" />
        Nenhuma resposta de formulário registrada para este lead.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hasMeta && (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2">
          <div className="text-xs font-semibold flex items-center gap-2">
            <Megaphone className="w-3.5 h-3.5 text-primary" /> Meta Lead Ads
            {fb.form_name && (
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary truncate max-w-[60%]">
                {fb.form_name}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {fb.form_id && <Cell label="Form ID" value={String(fb.form_id)} mono />}
            {fb.created_time && (
              <Cell
                label="Enviado em"
                value={format(new Date(fb.created_time), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
              />
            )}
            {(fb.campaign_name || lead.raw.facebook_campaign) && (
              <Cell label="Campanha" value={fb.campaign_name || lead.raw.facebook_campaign} />
            )}
            {fb.adset_name && <Cell label="Conjunto de anúncios" value={fb.adset_name} />}
            {fb.ad_name && <Cell label="Anúncio" value={fb.ad_name} />}
            {fb.lead_id && <Cell label="Lead ID (Meta)" value={String(fb.lead_id)} mono />}
            {lead.raw.utm_source && <Cell label="UTM Source" value={lead.raw.utm_source} />}
            {lead.raw.utm_medium && <Cell label="UTM Medium" value={lead.raw.utm_medium} />}
            {lead.raw.utm_campaign && <Cell label="UTM Campaign" value={lead.raw.utm_campaign} />}
            {lead.raw.utm_content && <Cell label="UTM Content" value={lead.raw.utm_content} />}
            {lead.raw.utm_term && <Cell label="UTM Term" value={lead.raw.utm_term} />}
          </div>
        </div>
      )}

      {questionFields.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-2">
          <div className="text-xs font-semibold flex items-center gap-2">
            <FileText className="w-3.5 h-3.5" /> Respostas do formulário
            <span className="ml-auto text-[10px] text-muted-foreground">
              {questionFields.length} {questionFields.length === 1 ? "pergunta" : "perguntas"}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {questionFields.map((f: any, i: number) => (
              <Cell
                key={i}
                label={prettifyLabel(f.label || f.name)}
                value={prettifyValue(f.value)}
                stack
              />
            ))}
          </div>
        </div>
      )}

      {contactFields.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2">
          <div className="text-xs font-semibold flex items-center gap-2">
            <FileText className="w-3.5 h-3.5 opacity-60" /> Dados de contato enviados
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {contactFields.map((f: any, i: number) => (
              <Cell
                key={i}
                label={prettifyLabel(f.label || f.name)}
                value={prettifyValue(f.value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({
  label,
  value,
  mono,
  stack,
}: {
  label: string;
  value: string;
  mono?: boolean;
  stack?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/40 bg-background/40 p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={`text-sm break-words ${mono ? "font-mono" : ""} ${
          stack ? "mt-1 leading-snug" : "mt-0.5"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
