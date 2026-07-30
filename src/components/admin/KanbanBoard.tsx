import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import KanbanColumn from "./KanbanColumn";
import LeadCard from "./LeadCard";
import LeadDetailModal from "./LeadDetailModal";
import LossReasonDialog from "./LossReasonDialog";
import AppointmentDialog from "@/components/tenant/AppointmentDialog";
import { CLIENT_PIPELINE_STAGES } from "@/types/admin";
type StageDef = { id: string; title: string; short: string; color: string; hex: string };
import type { Lead } from "@/types/admin";
import { celebrateSale } from "@/lib/sale-celebration";
import { LOSS_REASONS, getLossReasonLabel } from "@/lib/loss-reasons";
import {
  Inbox, PlayCircle, PhoneCall, Calendar, CalendarCheck, CalendarX,
  FileText, Handshake, Trophy, XCircle, UserCheck, ChevronDown, ChevronRight,
} from "lucide-react";

const iconMap: Record<string, any> = {
  lead: Inbox,
  qualificado: PlayCircle,       // Início de Atendimento
  agendar_reuniao: PhoneCall,
  reuniao_agendada: Calendar,
  compareceu: CalendarCheck,
  proposta: FileText,
  negociacao: Handshake,
  ganho: Trophy,
  ativo: UserCheck,
  no_show: CalendarX,
  perdido: XCircle,
};

interface KanbanBoardProps {
  leads: Lead[];
  onLeadsChange: () => void;
  nextAppointmentByLead?: Record<string, string>;
  density?: import("@/components/kanban/types").KanbanDensity;
  stages?: readonly StageDef[];
}

const KanbanBoard = ({ leads, onLeadsChange, nextAppointmentByLead, density = "comfortable", stages }: KanbanBoardProps) => {
  const activeStages: readonly StageDef[] = stages ?? CLIENT_PIPELINE_STAGES;
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [draggedLeadId, setDraggedLeadId] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<Lead | null>(null);
  const [pendingLossFor, setPendingLossFor] = useState<Lead | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostTab, setLostTab] = useState<string>("todos");

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
    // Ask for loss reason before persisting when moving to "perdido"
    if (newStatus === "perdido") {
      setPendingLossFor(lead);
      setDraggedLeadId(null);
      return;
    }

    const patch: Record<string, any> = { status: newStatus };
    const now = new Date().toISOString();
    if (newStatus === "qualificado") { patch.mql = true; patch.sql_qualified = true; }
    if (newStatus === "agendar_reuniao") { patch.mql = true; patch.sql_qualified = true; }
    if (newStatus === "reuniao_agendada" && !lead.reuniao_agendada_em) patch.reuniao_agendada_em = now;
    if (newStatus === "proposta" && !lead.proposta_enviada_em) patch.proposta_enviada_em = now;
    if (newStatus === "negociacao" && !lead.proposta_enviada_em) patch.proposta_enviada_em = now;
    if (newStatus === "ganho" && !lead.fechado_em) patch.fechado_em = now;
    if (newStatus === "ativo" && !lead.fechado_em) patch.fechado_em = now;
    if (newStatus === "perdido" && !lead.fechado_em) patch.fechado_em = now;

    try {
      const { error } = await supabase.from("leads").update(patch as any).eq("id", draggedLeadId);
      if (error) throw error;
      toast.success(`Lead movido para "${activeStages.find(c => c.id === newStatus)?.title}"`);

      // Celebrate a won deal
      if (newStatus === "ganho" || newStatus === "ativo") {
        celebrateSale();
      }

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

      // Se moveu para "Consulta Agendada" e não existe appointment futuro, abrir dialog
      if (newStatus === "reuniao_agendada" && lead.tenant_id) {
        const { data: future } = await supabase
          .from("appointments")
          .select("id")
          .eq("lead_id", lead.id)
          .gte("date_time", new Date().toISOString())
          .not("status", "in", "(cancelado,no_show)")
          .limit(1);
        if (!future || future.length === 0) {
          setScheduleFor(lead);
        }
      }
    } catch (error) {
      console.error("Erro ao atualizar status:", error);
      toast.error("Erro ao mover lead");
    } finally {
      setDraggedLeadId(null);
    }
  };

  const getLeadsByStatus = (status: string) => leads.filter((lead) => lead.status === status);

  const pipelineStages = activeStages.filter((s) => s.id !== "perdido");
  const lostLeads = getLeadsByStatus("perdido");
  const lostTotal = lostLeads.reduce((s, l) => s + (Number(l.valor_proposta) || 0), 0);

  const lostGroups = LOSS_REASONS
    .map((r) => ({
      id: r.id,
      label: r.label,
      leads: lostLeads.filter((l) => (l.motivo_perda ?? "") === r.id || getLossReasonLabel(l.motivo_perda) === r.label),
    }))
    .filter((g) => g.leads.length > 0);
  const semMotivo = lostLeads.filter((l) => !l.motivo_perda);
  const allGroups = semMotivo.length
    ? [...lostGroups, { id: "__sem__", label: "Sem motivo", leads: semMotivo }]
    : lostGroups;

  const visibleLost =
    lostTab === "todos" ? lostLeads : (allGroups.find((g) => g.id === lostTab)?.leads ?? []);

  return (
    <>
      <div className="kanban-scroll flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 items-stretch">
        {pipelineStages.map((column) => {
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
                <div className="flex items-center justify-center h-full min-h-[180px] rounded-lg border border-dashed border-border/50 text-muted-foreground/70 text-[11px] uppercase tracking-wider">
                  Vazio
                </div>
              ) : (
                columnLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    nextAppointmentAt={nextAppointmentByLead?.[lead.id]}
                    onClick={() => setSelectedLead(lead)}
                    onDragStart={handleDragStart}
                    density={density}
                  />
                ))
              )}
            </KanbanColumn>
          );
        })}
      </div>

      {/* ===== Painel de Perdidos ===== */}
      <section
        onDragOver={handleDragOver}
        onDrop={(e) => handleDrop(e, "perdido")}
        className="mt-2 rounded-lg border border-border bg-card shadow-sm overflow-hidden"
      >
        <header className="flex flex-wrap items-center gap-3 px-4 h-[58px] border-b border-border/70">
          <button
            type="button"
            onClick={() => setLostOpen((v) => !v)}
            className="flex items-center gap-2 min-w-0"
          >
            {lostOpen ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
            <XCircle className="w-4 h-4 text-destructive shrink-0" />
            <span className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-foreground/85">
              Perdidos
            </span>
            <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full bg-muted text-[10.5px] font-semibold tabular-nums text-foreground/70">
              {lostLeads.length}
            </span>
          </button>
          <span className="text-[10.5px] text-muted-foreground font-mono tabular-nums">
            {lostTotal > 0 ? `R$ ${lostTotal.toLocaleString("pt-BR", { minimumFractionDigits: 0 })} perdidos` : "\u00A0"}
          </span>
          <span className="ml-auto text-[10.5px] text-muted-foreground hidden sm:inline">
            Arraste um card para cá para marcar como perdido
          </span>
        </header>

        {lostOpen && (
          <div className="p-3 space-y-3">
            {/* Abas por motivo */}
            <div className="flex flex-wrap gap-1.5">
              {[{ id: "todos", label: "Todos", count: lostLeads.length }, ...allGroups.map((g) => ({ id: g.id, label: g.label, count: g.leads.length }))].map((t) => {
                const active = lostTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setLostTab(t.id)}
                    className={`h-8 px-3 rounded-md border text-xs font-medium transition inline-flex items-center gap-1.5 ${
                      active
                        ? "bg-destructive/10 border-destructive/40 text-destructive"
                        : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-destructive/30"
                    }`}
                  >
                    {t.label}
                    <span className="text-[10px] tabular-nums opacity-70">{t.count}</span>
                  </button>
                );
              })}
            </div>

            {visibleLost.length === 0 ? (
              <div className="flex items-center justify-center h-[120px] rounded-lg border border-dashed border-border/60 text-muted-foreground/70 text-[11px] uppercase tracking-wider">
                Nenhum lead perdido
              </div>
            ) : (
              <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-stretch max-h-[380px] overflow-y-auto pr-1">
                {visibleLost.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    nextAppointmentAt={nextAppointmentByLead?.[lead.id]}
                    onClick={() => setSelectedLead(lead)}
                    onDragStart={handleDragStart}
                    density={density}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <LeadDetailModal
        lead={selectedLead}
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        onUpdated={() => { onLeadsChange(); setSelectedLead(null); }}
      />

      {scheduleFor && scheduleFor.tenant_id && (
        <AppointmentDialog
          open={!!scheduleFor}
          onOpenChange={(v) => { if (!v) setScheduleFor(null); }}
          tenantId={scheduleFor.tenant_id}
          prefillLead={{ id: scheduleFor.id, name: scheduleFor.nome_completo, phone: scheduleFor.whatsapp }}
          onSaved={() => { setScheduleFor(null); onLeadsChange(); }}
        />
      )}

      <LossReasonDialog
        open={!!pendingLossFor}
        leadName={pendingLossFor?.nome_completo}
        initialValue={pendingLossFor?.motivo_perda ?? null}
        onCancel={() => setPendingLossFor(null)}
        onConfirm={async (reason) => {
          if (!pendingLossFor) return;
          const now = new Date().toISOString();
          const patch: any = {
            status: "perdido",
            motivo_perda: reason,
            fechado_em: pendingLossFor.fechado_em ?? now,
          };
          const { error } = await supabase.from("leads").update(patch).eq("id", pendingLossFor.id);
          if (error) { toast.error("Erro ao mover lead"); return; }
          toast.success("Lead marcado como perdido");
          setPendingLossFor(null);
          onLeadsChange();
        }}
      />
    </>
  );
};

export default KanbanBoard;
