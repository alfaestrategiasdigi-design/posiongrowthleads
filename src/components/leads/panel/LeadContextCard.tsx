import { Building2, Phone, DollarSign, User, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUnifiedLead, type LeadSource } from "@/hooks/useUnifiedLead";

const fmt = (v: number | null) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

interface Props {
  source: LeadSource;
  leadId: string;
  onOpenPanel: () => void;
}

export default function LeadContextCard({ source, leadId, onOpenPanel }: Props) {
  const { data: lead, loading } = useUnifiedLead(source, leadId);

  if (loading) return <div className="text-xs text-muted-foreground p-3">Carregando contexto do lead…</div>;
  if (!lead) return null;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-wider text-primary/80 flex items-center gap-1">
          <User className="w-3 h-3" /> Contexto do lead
        </div>
        <Button size="sm" variant="ghost" onClick={onOpenPanel} className="h-6 text-[11px] gap-1 text-primary hover:text-primary">
          Abrir painel <ExternalLink className="w-3 h-3" />
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Item icon={User} label="Nome" value={lead.contactName || lead.name} />
        <Item icon={Phone} label="WhatsApp" value={lead.whatsapp || "—"} />
        <Item icon={Building2} label="Empresa" value={lead.company || "—"} />
        <Item icon={DollarSign} label={lead.volumeLabel} value={lead.volume || fmt(lead.proposalValue)} />
      </div>
      {lead.sdr?.score != null && (
        <div className="text-[11px] text-muted-foreground">
          Score SDR: <span className="font-semibold text-foreground">{lead.sdr.score}/100</span>
          {lead.sdr.timeline && <> · Timeline: {lead.sdr.timeline}</>}
        </div>
      )}
    </div>
  );
}

function Item({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-primary/70 mt-0.5" />
      <div className="min-w-0">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-xs font-medium truncate">{value}</div>
      </div>
    </div>
  );
}
