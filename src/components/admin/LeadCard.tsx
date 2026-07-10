import { User, Phone, Building2, MapPin, Calendar, MessageCircle, DollarSign } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ORIGEM_LABELS } from "@/types/admin";
import type { Lead } from "@/types/admin";

interface LeadCardProps {
  lead: Lead;
  onClick: () => void;
  onDragStart: (e: React.DragEvent, leadId: string) => void;
  nextAppointmentAt?: string;
}

const LeadCard = ({ lead, onClick, onDragStart, nextAppointmentAt }: LeadCardProps) => {
  const whatsappNumber = lead.whatsapp.replace(/\D/g, "");
  const whatsappLink = `https://wa.me/55${whatsappNumber}?text=Olá ${lead.nome_completo.split(" ")[0]}, aqui é da Posion Growth!`;

  const handleWhatsAppClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(whatsappLink, "_blank");
  };

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, lead.id)}
      onClick={onClick}
      className="bg-card border border-border/50 rounded-xl p-4 cursor-grab active:cursor-grabbing hover:shadow-lg hover:border-primary/30 transition-all duration-200 group"
    >
      {/* Nome */}
      <div className="flex items-start gap-2 mb-3">
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-foreground truncate text-sm">
            {lead.nome_completo}
          </h4>
          {lead.nome_empresa && (
            <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
              <Building2 className="w-3 h-3" />
              {lead.nome_empresa}
            </p>
          )}
        </div>
      </div>

      {/* Origem badge */}
      <div className="flex items-center gap-1.5 mb-2">
        {(() => {
          const info = ORIGEM_LABELS[lead.origem ?? "site"] ?? ORIGEM_LABELS.outro;
          return <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${info.color}`}>{info.label}</span>;
        })()}
        {lead.valor_proposta != null && Number(lead.valor_proposta) > 0 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-semibold flex items-center gap-0.5">
            <DollarSign className="w-2.5 h-2.5" />
            {Number(lead.valor_proposta).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="space-y-1 mb-3">
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Phone className="w-3 h-3" /> {lead.whatsapp}
        </p>
        {lead.cidade_estado && (
          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <MapPin className="w-3 h-3" /> {lead.cidade_estado}
          </p>
        )}
      </div>

      {/* Próxima consulta */}
      {nextAppointmentAt && (
        <div className="mb-2 flex items-center gap-1.5 text-[10px] px-2 py-1 rounded-md bg-blue-500/10 text-blue-300 border border-blue-500/20">
          <Calendar className="w-3 h-3" />
          <span className="font-semibold">Consulta:</span>
          <span>{format(new Date(nextAppointmentAt), "dd/MM/yy HH:mm", { locale: ptBR })}</span>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border/50">
        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          {format(new Date(lead.created_at), "dd/MM", { locale: ptBR })}
        </span>
        <button
          onClick={handleWhatsAppClick}
          className="w-6 h-6 rounded-full bg-green-500/10 hover:bg-green-500/20 flex items-center justify-center transition-colors"
          title="Abrir WhatsApp"
        >
          <MessageCircle className="w-3 h-3 text-green-500" />
        </button>
      </div>
    </div>
  );
};

export default LeadCard;