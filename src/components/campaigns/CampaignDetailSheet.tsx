import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, ExternalLink, Copy, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import CreativeCard from "./CreativeCard";
import CampaignFunnel from "./CampaignFunnel";
import AlertsPanel, { Alert } from "./AlertsPanel";

const BRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
const NUM = (v: number) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));
const dateBR = (s: string | null) => s ? new Date(s).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";

interface Props {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  campaign: {
    id: string;
    name: string;
    ad_account_id?: string;
    ad_account_label?: string | null;
    effective_status?: string;
    status?: string;
    objective?: string;
    insights?: any;
  } | null;
  since: string;
  until: string;
  labels?: {
    appointments?: string;
    showed?: string;
    sales?: string;
    appointmentCost?: string;
    showedCost?: string;
    cac?: string;
    title?: string;
  };
}

export default function CampaignDetailSheet({ open, onClose, tenantId, campaign, since, until, labels }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !campaign) { setData(null); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: r, error } = await supabase.functions.invoke("tenant-campaign-detail", {
        body: { tenant_id: tenantId, campaign_id: campaign.id, since, until },
      });
      if (cancelled) return;
      if (error) { toast.error("Falha ao carregar detalhes"); setLoading(false); return; }
      setData(r);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, campaign, tenantId, since, until]);

  const alerts: Alert[] = useMemo(() => {
    if (!data) return [];
    const out: Alert[] = [];
    const ci = campaign?.insights;
    if (ci?.frequency > 3.5) {
      out.push({ id: "freq", severity: "warn", title: "Frequência alta", description: `Frequência ${ci.frequency.toFixed(1)} — considere refrescar criativos para evitar fadiga.`, scope: campaign?.name });
    }
    for (const ad of data.ads ?? []) {
      if (!ad.insights) continue;
      if (ad.insights.frequency > 4 && ad.insights.ctr < 1) {
        out.push({ id: `fad-${ad.id}`, severity: "critical", title: "Criativo fadigado", description: `${ad.name}: Freq ${ad.insights.frequency.toFixed(1)}, CTR ${ad.insights.ctr.toFixed(2)}%.`, scope: "Criativo" });
      }
      if (ad.insights.hook_rate > 0 && ad.insights.hook_rate < 15) {
        out.push({ id: `hook-${ad.id}`, severity: "warn", title: "Hook fraco", description: `${ad.name}: Hook Rate ${ad.insights.hook_rate.toFixed(0)}% (< 15%). Repense os primeiros 3 segundos.`, scope: "Criativo" });
      }
    }
    // Adsets ociosos
    for (const as of data.adsets ?? []) {
      const spend = as.insights?.spend ?? 0;
      const daily = Number(as.daily_budget ?? 0) / 100;
      if (daily > 0 && spend / Math.max(1, daysBetween(since, until)) < daily * 0.2) {
        out.push({ id: `idle-${as.id}`, severity: "info", title: "AdSet subutilizando budget", description: `${as.name}: gasto médio bem abaixo do orçamento diário (${BRL(daily)}). Público restritivo?`, scope: "AdSet" });
      }
    }
    return out;
  }, [data, campaign, since, until]);

  const leadsAgg = useMemo(() => {
    const leads = data?.leads ?? [];
    const appts = data?.appointments ?? [];
    const apptByLead: Record<string, any[]> = {};
    for (const a of appts) {
      apptByLead[a.lead_id] = apptByLead[a.lead_id] || [];
      apptByLead[a.lead_id].push(a);
    }
    let scheduled = 0, showed = 0, sales = 0, revenue = 0, contacts = 0;
    for (const l of leads) {
      const la = apptByLead[l.id] ?? [];
      if (la.length) scheduled++;
      if (la.some((a) => ["compareceu","realizado","fechado","confirmado"].includes(a.status))) showed++;
      if (l.status === "ganho") { sales++; revenue += Number(l.valor_proposta || 0); }
      if (l.status && !["lead","perdido"].includes(l.status)) contacts++;
    }
    return { total: leads.length, scheduled, showed, sales, revenue, contacts };
  }, [data]);

  const badgesForAd = (ad: any, list: any[]) => {
    if (!ad.insights) return {};
    const ctrs = list.map((a) => a.insights?.ctr ?? 0).filter(Boolean);
    const maxCtr = Math.max(...ctrs, 0);
    return {
      top: ctrs.length > 1 && ad.insights.ctr === maxCtr && ad.insights.leads > 0,
      fadigado: ad.insights.frequency > 4 && ad.insights.ctr < 1,
      caindo: ad.insights.ctr > 0 && ad.insights.ctr < 0.8,
    };
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-5xl overflow-y-auto">
        <SheetHeader className="pb-3 border-b">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>{campaign?.ad_account_label ?? campaign?.ad_account_id}</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-primary">Campanha</span>
          </div>
          <SheetTitle className="text-xl">{campaign?.name}</SheetTitle>
          <SheetDescription className="font-mono text-[11px] flex items-center gap-2">
            {campaign?.id}
            <button onClick={() => { if (campaign) navigator.clipboard.writeText(campaign.id).then(() => toast.success("ID copiado")); }} className="hover:text-primary"><Copy className="w-3 h-3" /></button>
            {campaign?.objective && <Badge variant="outline" className="ml-2 text-[10px]">{campaign.objective}</Badge>}
            <Badge variant={(campaign?.effective_status ?? campaign?.status) === "ACTIVE" ? "default" : "secondary"} className="text-[10px]">
              {campaign?.effective_status ?? campaign?.status}
            </Badge>
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="p-10 flex items-center justify-center text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Carregando adsets, criativos e leads…
          </div>
        ) : (
          <Tabs defaultValue="overview" className="mt-4">
            <TabsList className="grid grid-cols-5 w-full">
              <TabsTrigger value="overview">Visão Geral</TabsTrigger>
              <TabsTrigger value="adsets">AdSets ({data?.adsets?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="creatives">Criativos ({data?.ads?.length ?? 0})</TabsTrigger>
              <TabsTrigger value="leads">Leads ({leadsAgg.total})</TabsTrigger>
              <TabsTrigger value="insights">Insights ({alerts.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-3 mt-4">
              {campaign?.insights && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <KPI label="Gasto" value={BRL(campaign.insights.spend)} />
                  <KPI label="Impr." value={NUM(campaign.insights.impressions)} />
                  <KPI label="CTR" value={`${campaign.insights.ctr.toFixed(2)}%`} />
                  <KPI label="CPM" value={BRL(campaign.insights.cpm)} />
                  <KPI label="Frequência" value={campaign.insights.frequency?.toFixed(2) ?? "—"} />
                  <KPI label="Leads (Meta)" value={NUM(campaign.insights.leads)} />
                  <KPI label="CPL" value={campaign.insights.leads ? BRL(campaign.insights.cpl) : "—"} />
                  <KPI label="Hook Rate" value={`${(campaign.insights.hook_rate ?? 0).toFixed(1)}%`} />
                </div>
              )}
              <CampaignFunnel
                spend={campaign?.insights?.spend ?? 0}
                leads={leadsAgg.total || (campaign?.insights?.leads ?? 0)}
                contacts={leadsAgg.contacts}
                appointments={leadsAgg.scheduled}
                showed={leadsAgg.showed}
                sales={leadsAgg.sales}
                labels={labels}
              />
            </TabsContent>

            <TabsContent value="adsets" className="space-y-2 mt-4">
              {(data?.adsets ?? []).map((as: any) => (
                <Card key={as.id} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{as.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">{as.id}</div>
                      <div className="text-[10px] text-primary/70 mt-0.5">{as.optimization_goal} · {as.billing_event}</div>
                    </div>
                    <Badge variant={(as.effective_status ?? as.status) === "ACTIVE" ? "default" : "secondary"} className="text-[9px]">
                      {as.effective_status ?? as.status}
                    </Badge>
                  </div>
                  {as.insights && (
                    <div className="grid grid-cols-6 gap-1.5 text-[11px] mt-2">
                      <KPI label="Gasto" value={BRL(as.insights.spend)} compact />
                      <KPI label="Impr." value={NUM(as.insights.impressions)} compact />
                      <KPI label="CTR" value={`${as.insights.ctr.toFixed(1)}%`} compact />
                      <KPI label="CPM" value={BRL(as.insights.cpm)} compact />
                      <KPI label="Leads" value={NUM(as.insights.leads)} compact />
                      <KPI label="CPL" value={as.insights.leads ? BRL(as.insights.cpl) : "—"} compact />
                    </div>
                  )}
                  {as.ads?.length > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t">
                      {as.ads.length} anúncio(s) neste conjunto
                    </div>
                  )}
                </Card>
              ))}
              {(data?.adsets ?? []).length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-6">Nenhum AdSet retornado no período.</div>
              )}
            </TabsContent>

            <TabsContent value="creatives" className="mt-4">
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
                {(data?.ads ?? []).map((ad: any) => (
                  <CreativeCard key={ad.id} ad={ad} badges={badgesForAd(ad, data.ads)} />
                ))}
              </div>
              {(data?.ads ?? []).length === 0 && (
                <div className="text-center text-sm text-muted-foreground py-6">Nenhum criativo retornado no período.</div>
              )}
            </TabsContent>

            <TabsContent value="leads" className="mt-4">
              <div className="grid grid-cols-4 gap-2 mb-3">
                <KPI label="Leads" value={NUM(leadsAgg.total)} />
                <KPI label={labels?.appointments ?? "Agendados"} value={NUM(leadsAgg.scheduled)} />
                <KPI label={labels?.showed ?? "Compareceram"} value={NUM(leadsAgg.showed)} />
                <KPI label={`${labels?.sales ?? "Vendas"} / Receita`} value={`${leadsAgg.sales} · ${BRL(leadsAgg.revenue)}`} />
              </div>
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2.5 py-2 font-medium">Lead</th>
                      <th className="text-left px-2.5 py-2 font-medium">WhatsApp</th>
                      <th className="text-left px-2.5 py-2 font-medium">Formulário</th>
                      <th className="text-left px-2.5 py-2 font-medium">Criativo</th>
                      <th className="text-left px-2.5 py-2 font-medium">Status</th>
                      <th className="text-right px-2.5 py-2 font-medium">Valor</th>
                      <th className="text-left px-2.5 py-2 font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.leads ?? []).map((l: any) => (
                      <tr key={l.id} className="border-t hover:bg-muted/20">
                        <td className="px-2.5 py-1.5">{l.nome_completo}</td>
                        <td className="px-2.5 py-1.5 font-mono">{l.whatsapp}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{l.facebook_form_name ?? "—"}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{l.facebook_ad_name ?? "—"}</td>
                        <td className="px-2.5 py-1.5">
                          <Badge variant={l.status === "ganho" ? "default" : "outline"} className="text-[9px]">{l.status}</Badge>
                        </td>
                        <td className="px-2.5 py-1.5 text-right tabular-nums">{l.valor_proposta ? BRL(Number(l.valor_proposta)) : "—"}</td>
                        <td className="px-2.5 py-1.5 text-muted-foreground">{dateBR(l.created_at)}</td>
                      </tr>
                    ))}
                    {(data?.leads ?? []).length === 0 && (
                      <tr><td colSpan={7} className="px-3 py-4 text-center text-muted-foreground">Nenhum lead atribuído a esta campanha.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </TabsContent>

            <TabsContent value="insights" className="mt-4">
              <AlertsPanel alerts={alerts} />
            </TabsContent>
          </Tabs>
        )}

        <div className="mt-4 flex justify-end pt-3 border-t">
          <Button size="sm" variant="outline" className="gap-2" onClick={() => {
            if (!campaign) return;
            const url = `https://business.facebook.com/adsmanager/manage/campaigns?act=${(campaign.ad_account_id || "").replace(/^act_/, "")}&selected_campaign_ids=${campaign.id}`;
            window.open(url, "_blank");
          }}>
            <ExternalLink className="w-3.5 h-3.5" /> Abrir no Ads Manager
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function KPI({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-md bg-muted/30 border border-white/5 ${compact ? "px-2 py-1" : "px-2.5 py-1.5"}`}>
      <div className={`text-muted-foreground uppercase tracking-wider ${compact ? "text-[8px]" : "text-[9px]"}`}>{label}</div>
      <div className={`font-semibold tabular-nums ${compact ? "text-[11px]" : "text-sm"}`}>{value}</div>
    </div>
  );
}

function daysBetween(a: string, b: string) {
  const ms = new Date(b + "T23:59:59").getTime() - new Date(a + "T00:00:00").getTime();
  return Math.max(1, Math.round(ms / 86400000));
}
