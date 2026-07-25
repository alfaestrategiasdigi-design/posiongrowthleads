import { User, Phone, Building2, MapPin, Calendar, MessageCircle, XCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ORIGEM_LABELS } from "@/types/admin";
import { getLossReasonLabel } from "@/lib/loss-reasons";
import type { Lead } from "@/types/admin";
import type { KanbanDensity } from "@/components/kanban/types";

interface LeadCardProps {
  lead: Lead;
  onClick: () => void;
  onDragStart: (e: React.DragEvent, leadId: string) => void;
  nextAppointmentAt?: string;
  density?: KanbanDensity;
}

const BRL = (n: number | null | undefined) =>
  n && Number(n) > 0
    ? new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(n))
    : "";

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

const LeadCard = ({ lead, onClick, onDragStart, nextAppointmentAt, density = "comfortable" }: LeadCardProps) => {
  const whatsappNumber = lead.whatsapp.replace(/\D/g, "");
  const whatsappLink = `https://wa.me/55${whatsappNumber}?text=Olá ${lead.nome_completo.split(" ")[0]}, aqui é da Posion Growth!`;
  const handleWhatsAppClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(whatsappLink, "_blank");
  };
  const val = BRL(lead.valor_proposta as any);
  const lossLabel = lead.status === "perdido" ? getLossReasonLabel(lead.motivo_perda) : null;

  const base =
    "lead-card bg-card border border-border rounded-md cursor-grab active:cursor-grabbing " +
    "hover:border-primary/40 hover:shadow-sm transition-all";

  // COMPACT — 1 linha
  if (density === "compact") {
    return (
      <div
        draggable
        onDragStart={(e) => onDragStart(e, lead.id)}
        onClick={onClick}
        title={lead.nome_completo}
        className={`${base} px-2.5 py-1.5 flex items-center gap-2`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" aria-hidden />
        <span className="text-[12.5px] font-medium text-foreground truncate flex-1">{lead.nome_completo}</span>
        {val && <span className="text-[11px] font-semibold tabular-nums text-primary">{val}</span>}
      </div>
    );
  }

  // COMFORTABLE / SPACIOUS
  const spacious = density === "spacious";
  const origem = ORIGEM_LABELS[lead.origem ?? "site"] ?? ORIGEM_LABELS.outro;
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onClick={onClick}
      title={lead.nome_completo}
      className={`${base} p-3.5 relative`}
    >
      {/* Data no canto superior direito */}
      <span className="absolute top-2.5 right-3 text-[10px] font-medium text-muted-foreground/80 tabular-nums pointer-events-none">
        {format(new Date(lead.created_at), "dd/MM", { locale: ptBR })}
      </span>

      <div className="flex items-start gap-2.5 pr-9">
        <div className="w-8 h-8 shrink-0 rounded-full bg-primary/10 text-primary text-[11px] font-semibold flex items-center justify-center border border-primary/20">
          {initials(lead.nome_completo) || <User className="w-3.5 h-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-foreground truncate leading-tight">
            {lead.nome_completo}
          </div>

          <div className="text-[12px] text-muted-foreground truncate flex items-center gap-1.5 mt-1">
            <Phone className="w-3 h-3 shrink-0" />
            <span className="truncate">{lead.whatsapp}</span>
          </div>

          <div className="mt-2 inline-flex items-center">
            <span className="text-[10px] px-1.5 py-[2px] rounded-sm bg-muted text-foreground/70 uppercase tracking-wide font-medium">
              {origem.label}
            </span>
          </div>

          {spacious && lead.cidade_estado && (
            <div className="text-[11px] text-muted-foreground flex items-center gap-1 truncate mt-1.5">
              <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.cidade_estado}</span>
            </div>
          )}

          {lossLabel && (
            <div className="text-[11px] text-destructive flex items-center gap-1 truncate mt-1.5">
              <XCircle className="w-3 h-3 shrink-0" /> <span className="truncate">{lossLabel}</span>
            </div>
          )}

          {nextAppointmentAt && (
            <div className="mt-1.5 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary border border-primary/20 truncate">
              <Calendar className="w-3 h-3 shrink-0" />
              {format(new Date(nextAppointmentAt), "dd/MM HH:mm", { locale: ptBR })}
            </div>
          )}

          {val && (
            <div className="mt-2 text-[12.5px] font-semibold tabular-nums text-primary">{val}</div>
          )}
        </div>
      </div>

      {/* Botão WhatsApp verde sólido no canto inferior direito */}
      <button
        onClick={handleWhatsAppClick}
        className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-[hsl(var(--whatsapp))] hover:bg-[hsl(var(--whatsapp))]/90 flex items-center justify-center shadow-sm transition-colors"
        title="Abrir WhatsApp"
      >
        <MessageCircle className="w-4 h-4 text-white fill-white" />
      </button>
    </div>
  );
};


export default LeadCard;
