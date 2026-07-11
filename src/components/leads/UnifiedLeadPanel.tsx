import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Loader2, User, Building2, Phone, Mail, MapPin, DollarSign } from "lucide-react";
import { useUnifiedLead, type LeadSource } from "@/hooks/useUnifiedLead";

import LeadSummaryTab from "./panel/LeadSummaryTab";
import LeadFormAnswersTab from "./panel/LeadFormAnswersTab";
import LeadSDRTab from "./panel/LeadSDRTab";
import LeadTasksTab from "./panel/LeadTasksTab";
import { FIELDS_BY_KIND, resolveEntityKindLegacy, type EntityKind } from "@/lib/entity-fields";

interface Props {
  source: LeadSource | null;
  leadId: string | null;
  open: boolean;
  onClose: () => void;
  onUpdated?: () => void;
  /** Opcional: força um tipo de entidade. Se omitido, cai no default legado
   *  (mantém o comportamento atual de todos os call sites existentes). */
  entityKind?: EntityKind;
}

const fmt = (v: number | null) =>
  v == null ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v);

const UnifiedLeadPanel = ({ source, leadId, open, onClose, onUpdated, entityKind }: Props) => {
  const { data: lead, loading, reload, saveSDR, savePatch } = useUnifiedLead(open ? source : null, open ? leadId : null);
  const [tab, setTab] = useState("summary");
  const location = useLocation();
  const isTenantContext = location.pathname.startsWith("/app/");
  const kind: EntityKind = entityKind ?? resolveEntityKindLegacy(source, isTenantContext);
  const cfg = FIELDS_BY_KIND[kind];


  const whatsappLink = lead?.whatsapp
    ? `https://wa.me/55${lead.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${lead.contactName?.split(" ")[0] || ""}`)}`
    : null;

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl p-0 overflow-hidden flex flex-col">
        {loading || !lead ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <SheetHeader className="p-5 border-b border-border/50 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center shrink-0">
                  <User className="w-6 h-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <SheetTitle className="text-xl truncate text-left">{lead.name}</SheetTitle>
                  {lead.contactName && lead.contactName !== lead.name && (
                    <div className="text-sm text-muted-foreground truncate">{lead.contactName}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <Badge variant="outline" className="text-[10px] uppercase">{lead.stage}</Badge>
                    {lead.origem && <Badge variant="secondary" className="text-[10px]">{lead.origem}</Badge>}
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {lead.source === "lead" ? "Formulário" : "Agência"}
                    </Badge>
                  </div>
                </div>
              </div>

              {/* Quick facts strip */}
              <div className={`grid ${cfg.summary.company ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 md:grid-cols-3"} gap-2 text-xs`}>
                <QuickFact icon={Phone} label="WhatsApp" value={lead.whatsapp || "—"} />
                {cfg.summary.company && <QuickFact icon={Building2} label="Empresa" value={lead.company || "—"} />}
                <QuickFact icon={MapPin} label="Local" value={lead.city || "—"} />
                <QuickFact icon={DollarSign} label="Proposta" value={fmt(lead.proposalValue)} />
              </div>


              {whatsappLink && (
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2 bg-green-600/10 border-green-600/30 hover:bg-green-600/20"
                    onClick={() => window.open(whatsappLink, "_blank")}
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-green-500" /> Conversar
                  </Button>
                  {lead.email && (
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => window.open(`mailto:${lead.email}`)}>
                      <Mail className="w-3.5 h-3.5" /> {lead.email}
                    </Button>
                  )}
                </div>
              )}
            </SheetHeader>

            <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
              <TabsList className="w-full justify-start px-5 rounded-none border-b border-border/50 bg-transparent">
                <TabsTrigger value="summary">Resumo</TabsTrigger>
                <TabsTrigger value="form">Formulário</TabsTrigger>
                <TabsTrigger value="sdr">Qualificação SDR</TabsTrigger>
                <TabsTrigger value="tasks">Tarefas</TabsTrigger>
              </TabsList>

              <div className="flex-1 overflow-y-auto p-5">
                <TabsContent value="summary" className="mt-0">
                  <LeadSummaryTab
                    lead={lead}
                    entityKind={kind}
                    onSave={async (patch) => {
                      const { error } = await savePatch(patch);
                      if (!error) onUpdated?.();
                    }}
                  />
                </TabsContent>
                <TabsContent value="form" className="mt-0">
                  <LeadFormAnswersTab lead={lead} />
                </TabsContent>
                <TabsContent value="sdr" className="mt-0">
                  <LeadSDRTab
                    lead={lead}
                    onSave={async (sdr) => {
                      const { error } = await saveSDR(sdr);
                      if (!error) {
                        onUpdated?.();
                        reload();
                      }
                    }}
                  />
                </TabsContent>
                <TabsContent value="tasks" className="mt-0">
                  <LeadTasksTab lead={lead} />
                </TabsContent>
              </div>
            </Tabs>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};

function QuickFact({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/50 bg-muted/30 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-xs font-medium truncate mt-0.5">{value}</div>
    </div>
  );
}

export default UnifiedLeadPanel;
