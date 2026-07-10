import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import KanbanColumn from "./KanbanColumn";
import LeadCard from "./LeadCard";
import LeadDetailModal from "./LeadDetailModal";
import { PIPELINE_STAGES } from "@/types/admin";
import type { Lead } from "@/types/admin";
import {
  Inbox, Filter, Calendar, UserCheck, Handshake, Trophy, XCircle, CalendarX,
} from "lucide-react";

const iconMap: Record<string, any> = {
  lead: Inbox,
  qualificado: Filter,
  reuniao_agendada: Calendar,
  compareceu: UserCheck,
  negociacao: Handshake,
  ganho: Trophy,
  perdido: XCircle,
  no_show: CalendarX,
};

interface KanbanBoardProps {
  leads: Lead[];
  onLeadsChange: () => void;
  nextAppointmentByLead?: Record<string, string>;
}

const KanbanBoard = ({ leads, onLeadsChange }: KanbanBoardProps) => {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, leadId: string) => {
    setDraggedLeadId(leadId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, newStatus: string) => {
    e.preventDefault();
    if (!draggedLeadId) return;
    const lead = leads.find((l) => l.id === draggedLeadId);
    if (!lead || lead.status === newStatus) { setDraggedLeadId(null); return; }

    const patch: Record<string, any> = { status: newStatus };
    const now = new Date().toISOString();
    if (newStatus === "qualificado") { patch.mql = true; patch.sql_qualified = true; }
    if (newStatus === "reuniao_agendada" && !lead.reuniao_agendada_em) patch.reuniao_agendada_em = now;
    if (newStatus === "compareceu" && !lead.reuniao_realizada_em) patch.reuniao_realizada_em = now;
    if (newStatus === "negociacao" && !lead.proposta_enviada_em) patch.proposta_enviada_em = now;
    if (newStatus === "ganho" && !lead.fechado_em) patch.fechado_em = now;
    if (newStatus === "perdido" && !lead.fechado_em) patch.fechado_em = now;

    try {
      const { error } = await supabase.from("leads").update(patch as any).eq("id", draggedLeadId);
      if (error) throw error;
      toast.success(`Lead movido para "${PIPELINE_STAGES.find(c => c.id === newStatus)?.title}"`);

      // Fire Facebook CAPI when a lead is marked as won (fire-and-forget)
      if (newStatus === "ganho" && lead.tenant_id) {
        supabase.functions.invoke("facebook-capi-event", {
          body: {
            tenant_id: lead.tenant_id,
            lead_id: lead.id,
            event_name: "Purchase",
          },
        }).then(({ error: capiErr }) => {
          if (capiErr) console.warn("[CAPI] erro ao enviar evento:", capiErr.message);
        });
      }

      onLeadsChange();
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
      toast.error("Erro ao mover lead");
    } finally {
      setDraggedLeadId(null);
    }
  };

  const getLeadsByStatus = (status: string) => leads.filter((lead) => lead.status === status);

  return (
    <>
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4">
        {PIPELINE_STAGES.map((column) => {
          const columnLeads = getLeadsByStatus(column.id);
          const Icon = iconMap[column.id] || Inbox;
          const totalValor = columnLeads.reduce((s, l) => s + (Number(l.valor_proposta) || 0), 0);
          return (
            <KanbanColumn
              key={column.id}
              title={column.short}
              count={columnLeads.length}
              icon={Icon}
              color={`bg-gradient-to-r ${column.color}`.replace("bg-", "")}
              bgColor={`bg-gradient-to-r ${column.color}`}
              subtitle={totalValor > 0 ? `R$ ${totalValor.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}` : undefined}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, column.id)}
            >
              {columnLeads.length === 0 ? (
                <div className="text-center py-6 text-muted-foreground text-xs">
                  Nenhum lead
                </div>
              ) : (
                columnLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    onClick={() => setSelectedLead(lead)}
                    onDragStart={handleDragStart}
                  />
                ))
              )}
            </KanbanColumn>
          );
        })}
      </div>

      <LeadDetailModal
        lead={selectedLead}
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        onUpdated={() => { onLeadsChange(); setSelectedLead(null); }}
      />
    </>
  );
};

export default KanbanBoard;
