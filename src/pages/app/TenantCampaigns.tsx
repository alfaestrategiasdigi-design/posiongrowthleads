import { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, RefreshCw, TrendingUp, Users, DollarSign, Target,
  Activity, AlertCircle, Megaphone, Star,
} from "lucide-react";

const BRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
const NUM = (v: number) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));

interface Campaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective?: string;
  daily_budget?: string;
  ad_account_id: string;
  ad_account_label?: string | null;
  insights: null | {
    spend: number; impressions: number; clicks: number;
    ctr: number; cpc: number; cpm: number;
    leads: number; cpl: number;
    purchases: number; purchase_value: number; roas: number;
  };
}

type LinkedForm = {
  form_id: string;
  label: string;
  total_leads: number;
  last_lead_at: string | null;
};

export default function TenantCampaigns() {
  const { tenant, loading: tLoading } = useTenant();
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crmWins, setCrmWins] = useState<Record<string, { count: number; value: number }>>({});
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [linkedForms, setLinkedForms] = useState<LinkedForm[]>([]);
  const [lastBackfill, setLastBackfill] = useState<Date | null>(null);

  const load = async () => {
    if (!tenant) return;
    setLoading(true); setError(null); setReason(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("tenant-campaigns", {
        body: { tenant_id: tenant.id, active_only: activeOnly },
      });
      if (fnErr) throw fnErr;
      if (!data?.ok) {
        setReason(data?.reason ?? null);
        setError(data?.error ?? null);
        setCampaigns([]);
      } else {
        setCampaigns(data.data ?? []);
        setReason((data.data ?? []).length === 0 ? "no_campaigns" : null);
      }
      // CRM wins do próprio tenant, casados por utm_campaign ao nome
      const { data: wins } = await supabase
        .from("agency_leads")
        .select("nome_clinica,utm_campaign,valor_proposta,tenant_id_criado,stage")
        .eq("stage", "ganho");
      const winsL = (wins ?? []).filter((w: any) => w.tenant_id_criado === tenant.id);
      const { data: winsLeads } = await supabase
        .from("leads")
        .select("utm_campaign,facebook_campaign,valor_proposta")
        .eq("status", "ganho").eq("tenant_id", tenant.id);
      const map: Record<string, { count: number; value: number }> = {};
      const attribute = (name: string | null | undefined, valor: number) => {
        if (!name) return;
        const key = name.trim().toLowerCase();
        if (!key) return;
        map[key] = map[key] || { count: 0, value: 0 };
        map[key].count += 1; map[key].value += Number(valor) || 0;
      };
      winsL.forEach((w: any) => attribute(w.utm_campaign, w.valor_proposta));
      (winsLeads ?? []).forEach((w: any) => attribute(w.utm_campaign || w.facebook_campaign, w.valor_proposta));
      setCrmWins(map);
      setLastSync(new Date());
    } catch (e: any) {
      setError(e?.message ?? "Erro ao carregar campanhas");
      setCampaigns([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { if (tenant) load(); /* eslint-disable-next-line */ }, [tenant?.id, activeOnly]);

  const kpis = useMemo(() => {
    const s = campaigns.reduce((acc, c) => {
      if (!c.insights) return acc;
      acc.spend += c.insights.spend;
      acc.leads += c.insights.leads;
      acc.impressions += c.insights.impressions;
      acc.clicks += c.insights.clicks;
      acc.revenue += c.insights.purchase_value;
      return acc;
    }, { spend: 0, leads: 0, impressions: 0, clicks: 0, revenue: 0 });
    // adiciona wins do CRM ao faturamento
    const crmTotal = Object.values(crmWins).reduce((sum, v) => sum + v.value, 0);
    const crmCount = Object.values(crmWins).reduce((sum, v) => sum + v.count, 0);
    const totalRev = s.revenue + crmTotal;
    return {
      spend: s.spend, leads: s.leads, revenue: totalRev,
      cpl: s.leads ? s.spend / s.leads : 0,
      roas: s.spend ? totalRev / s.spend : 0,
      active: campaigns.filter((c) => c.effective_status === "ACTIVE" || c.status === "ACTIVE").length,
      total: campaigns.length, crmWins: crmCount,
      ctr: s.impressions ? (s.clicks / s.impressions) * 100 : 0,
    };
  }, [campaigns, crmWins]);

  if (tLoading || !tenant) {
    return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Marketing · Meta Ads</div>
          <h1 className="font-display text-2xl md:text-3xl mt-1 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-primary" /> Campanhas
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tenant.name} · últimos 30 dias {lastSync && <span className="text-xs opacity-60">· sync {lastSync.toLocaleTimeString("pt-BR")}</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={activeOnly} onCheckedChange={setActiveOnly} /> Apenas ativas
          </label>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <Kpi icon={Activity} label="Ativas" value={`${kpis.active}/${kpis.total}`} tone="primary" />
        <Kpi icon={DollarSign} label="Investido" value={BRL(kpis.spend)} tone="amber" />
        <Kpi icon={Users} label="Leads" value={NUM(kpis.leads)} tone="cyan" />
        <Kpi icon={Target} label="CPL" value={BRL(kpis.cpl)} tone="violet" />
        <Kpi icon={TrendingUp} label="Faturamento" value={BRL(kpis.revenue)} tone="emerald" />
        <Kpi icon={Star} label="ROAS" value={`${kpis.roas.toFixed(2)}x`} tone="rose" />
      </div>

      {/* States */}
      {error && (
        <Card className="p-4 border-destructive/40 bg-destructive/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">{error}</div>
        </Card>
      )}

      {!error && reason === "no_mapping" && (
        <Card className="p-6 text-center">
          <Megaphone className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
          <div className="font-medium mb-1">Nenhuma conta de anúncio conectada</div>
          <div className="text-sm text-muted-foreground">
            Peça à Posion para vincular sua conta Meta Ads (ad account) ao seu tenant para ver as campanhas aqui.
          </div>
        </Card>
      )}

      {!error && reason === "no_campaigns" && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Nenhuma campanha {activeOnly ? "ativa" : ""} encontrada no período.
        </Card>
      )}

      {/* Cards */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {campaigns.map((c) => {
          const key = c.name.trim().toLowerCase();
          const win = crmWins[key];
          const revenue = (c.insights?.purchase_value || 0) + (win?.value || 0);
          const roas = c.insights?.spend ? revenue / c.insights.spend : 0;
          const isActive = c.effective_status === "ACTIVE" || c.status === "ACTIVE";
          return (
            <Card key={c.id} className="p-4 flex flex-col gap-3 hover:border-primary/40 transition-colors">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
                    {c.ad_account_label || c.ad_account_id}
                  </div>
                  <div className="font-medium truncate" title={c.name}>{c.name}</div>
                </div>
                <Badge variant={isActive ? "default" : "secondary"} className="shrink-0 text-[10px]">
                  {isActive ? "Ativa" : c.effective_status || c.status}
                </Badge>
              </div>

              {c.insights ? (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Metric label="Gasto" value={BRL(c.insights.spend)} />
                  <Metric label="Leads" value={NUM(c.insights.leads)} />
                  <Metric label="CPL" value={BRL(c.insights.cpl)} />
                  <Metric label="CTR" value={`${(c.insights.ctr).toFixed(2)}%`} />
                  <Metric label="CPC" value={BRL(c.insights.cpc)} />
                  <Metric label="Impr." value={NUM(c.insights.impressions)} />
                </div>
              ) : (
                <div className="text-xs text-muted-foreground italic">Sem dados de insights no período.</div>
              )}

              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex items-center justify-between">
                <div className="text-[10px] uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                  <Star className="w-3 h-3" /> Ganhos + Receita
                </div>
                <div className="text-right leading-tight">
                  <div className="text-sm font-bold tabular-nums text-emerald-400">{BRL(revenue)}</div>
                  <div className="text-[10px] text-muted-foreground">ROAS {roas.toFixed(2)}x{win?.count ? ` · ${win.count} venda${win.count > 1 ? "s" : ""}` : ""}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: string }) {
  const toneMap: Record<string, string> = {
    primary: "text-primary border-primary/20 bg-primary/5",
    amber: "text-amber-400 border-amber-500/20 bg-amber-500/5",
    cyan: "text-cyan-400 border-cyan-500/20 bg-cyan-500/5",
    violet: "text-violet-400 border-violet-500/20 bg-violet-500/5",
    emerald: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
    rose: "text-rose-400 border-rose-500/20 bg-rose-500/5",
  };
  return (
    <Card className={`p-3 border ${toneMap[tone]}`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="text-lg font-bold tabular-nums mt-1">{value}</div>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums text-[11px] mt-0.5">{value}</div>
    </div>
  );
}
