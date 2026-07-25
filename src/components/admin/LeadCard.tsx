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
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onClick={onClick}
      title={lead.nome_completo}
      className={`${base} p-2.5`}
    >
      <div className="flex items-start gap-2">
        <div className="w-6 h-6 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center border border-primary/20">
          {initials(lead.nome_completo) || <User className="w-3 h-3" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground truncate leading-tight">
            {lead.nome_completo}
          </div>
          {lead.nome_empresa && (
            <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1 mt-0.5">
              <Building2 className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.nome_empresa}</span>
            </div>
          )}

          {spacious && (
            <div className="mt-1.5 space-y-0.5">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                <Phone className="w-3 h-3 shrink-0" /> {lead.whatsapp}
              </div>
              {lead.cidade_estado && (
                <div className="text-[11px] text-muted-foreground flex items-center gap-1 truncate">
                  <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{lead.cidade_estado}</span>
                </div>
              )}
              {(() => {
                const info = ORIGEM_LABELS[lead.origem ?? "site"] ?? ORIGEM_LABELS.outro;
                return (
                  <div className="mt-1 inline-flex items-center gap-1">
                    <span className="text-[9.5px] px-1.5 py-[1px] rounded-sm bg-muted text-foreground/70 uppercase tracking-wide">
                      {info.label}
                    </span>
                  </div>
                );
              })()}
              {lossLabel && (
                <div className="text-[11px] text-destructive flex items-center gap-1 truncate">
                  <XCircle className="w-3 h-3 shrink-0" /> <span className="truncate">{lossLabel}</span>
                </div>
              )}
              {nextAppointmentAt && (
                <div className="mt-1 inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-primary/10 text-primary border border-primary/20 truncate">
                  <Calendar className="w-3 h-3 shrink-0" />
                  {format(new Date(nextAppointmentAt), "dd/MM HH:mm", { locale: ptBR })}
                </div>
              )}
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-2">
            {val && <span className="text-[12px] font-semibold tabular-nums text-primary">{val}</span>}
            <span className="ml-auto text-[10px] text-muted-foreground tabular-nums flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              {format(new Date(lead.created_at), "dd/MM", { locale: ptBR })}
            </span>
            <button
              onClick={handleWhatsAppClick}
              className="w-5 h-5 rounded-full bg-[hsl(var(--whatsapp)/0.12)] hover:bg-[hsl(var(--whatsapp)/0.22)] flex items-center justify-center transition-colors"
              title="Abrir WhatsApp"
            >
              <MessageCircle className="w-3 h-3 text-[hsl(var(--whatsapp))]" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LeadCard;
