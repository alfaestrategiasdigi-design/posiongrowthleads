import { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, RefreshCw, TrendingUp, Users, DollarSign, Target, Download,
  Activity, AlertCircle, Megaphone, Star, ExternalLink, Copy, Eye, MousePointerClick,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, Tooltip as RTooltip } from "recharts";

const BRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
const NUM = (v: number) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));
const daysAgoISO = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

interface DailyPoint { date: string; spend: number; leads: number; clicks: number; impressions: number }
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
    messaging?: number; link_clicks?: number;
    result_kind?: "messaging" | "leads" | "purchases" | "link_clicks";
    result_label?: string;
    result_value?: number;
    cost_per_result?: number;
    purchases: number; purchase_value: number; roas: number;
  };
  daily?: DailyPoint[];
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
  const [period, setPeriod] = useState<7 | 14 | 30 | 90>(30);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crmWins, setCrmWins] = useState<Record<string, { count: number; value: number }>>({});
  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [linkedForms, setLinkedForms] = useState<LinkedForm[]>([]);
  const [lastBackfill, setLastBackfill] = useState<Date | null>(null);
  const [detail, setDetail] = useState<Campaign | null>(null);

  const load = async () => {
    if (!tenant) return;
    setLoading(true); setError(null); setReason(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("tenant-campaigns", {
        body: { tenant_id: tenant.id, active_only: activeOnly, since: daysAgoISO(period), until: todayISO() },
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
      // CRM wins do próprio tenant (agency_leads promovidos para este tenant).
      // RLS já bloqueia leitura cross-tenant, mas filtramos explicitamente por segurança.
      const { data: wins } = await supabase
        .from("agency_leads")
        .select("nome_clinica,utm_campaign,valor_proposta,tenant_id_criado,stage")
        .eq("stage", "ganho")
        .eq("tenant_id_criado", tenant.id);
      const winsL = wins ?? [];

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

  useEffect(() => { if (tenant) { load(); loadLinkedForms(); } /* eslint-disable-next-line */ }, [tenant?.id, activeOnly, period]);

  const loadLinkedForms = async () => {
    if (!tenant) return;
    const { data: rules } = await supabase
      .from("lead_routing_rules")
      .select("match_value,match_label")
      .eq("tenant_id", tenant.id).eq("match_type", "form_id").eq("active", true);
    const ruleList = (rules ?? []) as Array<{ match_value: string; match_label: string | null }>;
    if (ruleList.length === 0) { setLinkedForms([]); setLastBackfill(null); return; }
    const ids = ruleList.map((r) => r.match_value);
    const { data: leads } = await supabase
      .from("agency_leads")
      .select("form_id,created_at")
      .eq("tenant_id_criado", tenant.id)
      .in("form_id", ids);
    const rows = ((leads ?? []) as unknown) as Array<{ form_id: string; created_at: string }>;
    const byForm: Record<string, { total: number; last: string | null }> = {};
    let globalLast: string | null = null;
    for (const l of rows) {
      const k = l.form_id;
      byForm[k] = byForm[k] || { total: 0, last: null };
      byForm[k].total += 1;
      if (!byForm[k].last || l.created_at > byForm[k].last!) byForm[k].last = l.created_at;
      if (!globalLast || l.created_at > globalLast) globalLast = l.created_at;
    }
    setLinkedForms(ruleList.map((r) => ({
      form_id: r.match_value,
      label: r.match_label || `Form ${r.match_value}`,
      total_leads: byForm[r.match_value]?.total ?? 0,
      last_lead_at: byForm[r.match_value]?.last ?? null,
    })));
    setLastBackfill(globalLast ? new Date(globalLast) : null);
  };

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

  // Agrega séries diárias de todas as campanhas para os sparklines dos KPIs
  const dailyTotals = useMemo(() => {
    const map = new Map<string, { date: string; spend: number; leads: number; clicks: number; impressions: number }>();
    for (const c of campaigns) {
      for (const d of c.daily ?? []) {
        if (!d.date) continue;
        const prev = map.get(d.date) ?? { date: d.date, spend: 0, leads: 0, clicks: 0, impressions: 0 };
        prev.spend += d.spend || 0; prev.leads += d.leads || 0;
        prev.clicks += d.clicks || 0; prev.impressions += d.impressions || 0;
        map.set(d.date, prev);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [campaigns]);

  const periodLabel = period === 7 ? "últimos 7 dias" : period === 14 ? "últimos 14 dias" : period === 30 ? "últimos 30 dias" : "últimos 90 dias";

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
            {tenant.name} · {periodLabel} {lastSync && <span className="text-xs opacity-60">· sync {lastSync.toLocaleTimeString("pt-BR")}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <div className="inline-flex rounded-md border border-white/10 bg-background/40 p-0.5">
            {[7, 14, 30, 90].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p as any)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-sm tabular-nums transition-colors ${
                  period === p ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}d
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={activeOnly} onCheckedChange={setActiveOnly} /> Apenas ativas
          </label>
          <Button variant="outline" size="sm" onClick={() => exportCsv(campaigns, crmWins)} disabled={!campaigns.length} className="gap-2" aria-label="Exportar CSV">
            <Download className="w-4 h-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      {/* KPIs com sparkline */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon={Activity} label="Ativas" value={`${kpis.active}/${kpis.total}`} tone="primary" />
        <Kpi icon={DollarSign} label="Investido" value={BRL(kpis.spend)} tone="amber"
             series={dailyTotals} dataKey="spend" formatter={(v) => BRL(v)} />
        <Kpi icon={Users} label="Leads" value={NUM(kpis.leads)} tone="cyan"
             series={dailyTotals} dataKey="leads" formatter={(v) => NUM(v)} />
        <Kpi icon={Target} label="CPL" value={BRL(kpis.cpl)} tone="violet" />
        <Kpi icon={TrendingUp} label="Faturamento" value={BRL(kpis.revenue)} tone="emerald" />
        <Kpi icon={Star} label="ROAS" value={`${kpis.roas.toFixed(2)}x`} tone="rose" />
      </div>


      {/* Linked Lead Forms */}
      <Card className="p-4 bg-gradient-to-br from-card to-background/60 border-primary/10">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80 flex items-center gap-1.5">
              <Target className="w-3 h-3" /> Formulários Meta vinculados
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {linkedForms.length === 0
                ? "Nenhum formulário Meta Lead Ads vinculado a esta clínica ainda. Peça à Posion para conectar."
                : `${linkedForms.length} formulário(s) puxando leads automaticamente a cada 15 min.`}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Último lead recebido</div>
            <div className="text-sm font-mono tabular-nums text-emerald-400 mt-0.5">
              {lastBackfill
                ? lastBackfill.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                : "—"}
            </div>
          </div>
        </div>
        {linkedForms.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {linkedForms.map((f) => (
              <div key={f.form_id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-background/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate" title={f.label}>{f.label}</div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">{f.form_id}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold tabular-nums text-primary">{NUM(f.total_leads)}</div>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    {f.last_lead_at ? new Date(f.last_lead_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "sem leads"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>



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

      {/* Cards compactos */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {campaigns.map((c) => {
          const key = c.name.trim().toLowerCase();
          const win = crmWins[key];
          const revenue = (c.insights?.purchase_value || 0) + (win?.value || 0);
          const roas = c.insights?.spend ? revenue / c.insights.spend : 0;
          const isActive = c.effective_status === "ACTIVE" || c.status === "ACTIVE";
          const metaUrl = `https://business.facebook.com/adsmanager/manage/campaigns?act=${(c.ad_account_id || "").replace(/^act_/, "")}&selected_campaign_ids=${c.id}`;
          const copyId = async () => {
            await navigator.clipboard.writeText(c.id);
            toast.success("ID da campanha copiado");
          };
          return (
            <Card key={c.id} className="relative p-3.5 flex flex-col gap-2.5 hover:border-primary/40 transition-colors overflow-hidden group">
              {/* status strip */}
              <div className={`absolute left-0 top-0 h-full w-[3px] ${isActive ? "bg-emerald-400 shadow-[0_0_12px_hsl(var(--primary))]" : "bg-muted"}`} />

              <div className="flex items-start justify-between gap-2 pl-1">
                <div className="min-w-0 flex-1">
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground truncate">
                    {c.ad_account_label || c.ad_account_id}
                  </div>
                  <div className="text-sm font-medium truncate leading-tight mt-0.5" title={c.name}>{c.name}</div>
                </div>
                <Badge variant={isActive ? "default" : "secondary"} className="shrink-0 text-[9px] px-1.5 py-0 h-4">
                  {isActive ? "ATIVA" : (c.effective_status || c.status || "").slice(0, 8)}
                </Badge>
              </div>

              {c.insights ? (
                <div className="grid grid-cols-4 gap-1.5 text-xs pl-1">
                  <Metric label="Gasto" value={BRL(c.insights.spend)} />
                  <Metric label="Leads" value={NUM(c.insights.leads)} />
                  <Metric label="CPL" value={BRL(c.insights.cpl)} />
                  <Metric label="CTR" value={`${c.insights.ctr.toFixed(1)}%`} />
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground italic pl-1">Sem dados no período.</div>
              )}

              {c.daily && c.daily.length > 1 && (
                <div className="pl-1">
                  <div className="flex items-center justify-between text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                    <span>Tendência de leads · {period}d</span>
                    <span className="tabular-nums text-cyan-400">{NUM(c.daily.reduce((a, d) => a + (d.leads || 0), 0))}</span>
                  </div>
                  <Sparkline data={c.daily} dataKey="leads" color="#22d3ee" />
                </div>
              )}


              <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 flex items-center justify-between ml-1">
                <div className="text-[9px] uppercase tracking-wider text-emerald-400 flex items-center gap-1">
                  <Star className="w-3 h-3" /> Receita
                </div>
                <div className="text-right leading-tight">
                  <div className="text-xs font-bold tabular-nums text-emerald-400">{BRL(revenue)}</div>
                  <div className="text-[9px] text-muted-foreground">
                    ROAS {roas.toFixed(2)}x{win?.count ? ` · ${win.count} venda${win.count > 1 ? "s" : ""}` : ""}
                  </div>
                </div>
              </div>

              {/* Ações rápidas */}
              <div className="flex items-center gap-1 pl-1 pt-0.5 opacity-70 group-hover:opacity-100 transition-opacity">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] gap-1" onClick={() => setDetail(c)}>
                  <Eye className="w-3 h-3" /> Detalhes
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] gap-1" onClick={() => window.open(metaUrl, "_blank")}>
                  <ExternalLink className="w-3 h-3" /> Meta
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] gap-1" onClick={copyId}>
                  <Copy className="w-3 h-3" /> ID
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="pr-6">{detail?.name}</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              {detail?.ad_account_label || detail?.ad_account_id} · {detail?.id}
            </DialogDescription>
          </DialogHeader>
          {detail?.insights ? (
            <div className="grid grid-cols-3 gap-2 text-xs">
              <Metric label="Gasto" value={BRL(detail.insights.spend)} />
              <Metric label="Impr." value={NUM(detail.insights.impressions)} />
              <Metric label="Cliques" value={NUM(detail.insights.clicks)} />
              <Metric label="CTR" value={`${detail.insights.ctr.toFixed(2)}%`} />
              <Metric label="CPC" value={BRL(detail.insights.cpc)} />
              <Metric label="CPM" value={BRL(detail.insights.cpm)} />
              <Metric label="Leads" value={NUM(detail.insights.leads)} />
              <Metric label="CPL" value={BRL(detail.insights.cpl)} />
              <Metric label="ROAS" value={`${detail.insights.roas.toFixed(2)}x`} />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground italic">Sem insights no período.</div>
          )}
          <div className="flex items-center gap-2 pt-2">
            <Badge variant="outline" className="text-[10px]">{detail?.objective || "—"}</Badge>
            <Badge variant="outline" className="text-[10px]">Status: {detail?.effective_status || detail?.status}</Badge>
            {detail?.daily_budget && (
              <Badge variant="outline" className="text-[10px]">
                Diário: {BRL(Number(detail.daily_budget) / 100)}
              </Badge>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => detail && navigator.clipboard.writeText(detail.id).then(() => toast.success("ID copiado"))}>
              <Copy className="w-3.5 h-3.5" /> Copiar ID
            </Button>
            <Button size="sm" className="gap-1" onClick={() => {
              if (!detail) return;
              const url = `https://business.facebook.com/adsmanager/manage/campaigns?act=${(detail.ad_account_id || "").replace(/^act_/, "")}&selected_campaign_ids=${detail.id}`;
              window.open(url, "_blank");
            }}>
              <ExternalLink className="w-3.5 h-3.5" /> Abrir no Meta
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const TONE_HSL: Record<string, string> = {
  primary: "hsl(var(--primary))",
  amber: "#f59e0b",
  cyan: "#22d3ee",
  violet: "#8b5cf6",
  emerald: "#34d399",
  rose: "#fb7185",
};

function Kpi({
  icon: Icon, label, value, tone,
  series, dataKey, formatter,
}: {
  icon: any; label: string; value: string; tone: string;
  series?: Array<Record<string, any>>; dataKey?: string;
  formatter?: (v: number) => string;
}) {
  const toneMap: Record<string, string> = {
    primary: "text-primary border-primary/20 bg-primary/5",
    amber: "text-amber-400 border-amber-500/20 bg-amber-500/5",
    cyan: "text-cyan-400 border-cyan-500/20 bg-cyan-500/5",
    violet: "text-violet-400 border-violet-500/20 bg-violet-500/5",
    emerald: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
    rose: "text-rose-400 border-rose-500/20 bg-rose-500/5",
  };
  const showSpark = !!(series && series.length > 1 && dataKey);
  const color = TONE_HSL[tone] ?? "currentColor";
  const gid = `spark-${tone}-${label}`.replace(/\s+/g, "-");
  return (
    <Card className={`p-3 border ${toneMap[tone]} relative overflow-hidden`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="text-lg font-bold tabular-nums mt-1">{value}</div>
      {showSpark && (
        <div className="h-8 -mx-1 -mb-1 mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <RTooltip
                cursor={{ stroke: color, strokeOpacity: 0.3 }}
                contentStyle={{ background: "hsl(var(--card))", border: `1px solid ${color}`, borderRadius: 6, fontSize: 11, padding: "4px 8px" }}
                labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: 10 }}
                formatter={(v: any) => [formatter ? formatter(Number(v)) : v, label]}
              />
              <Area type="monotone" dataKey={dataKey!} stroke={color} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Sparkline({ data, dataKey, color = "hsl(var(--primary))" }: { data: Array<Record<string, any>>; dataKey: string; color?: string }) {
  if (!data || data.length < 2) return null;
  return (
    <div className="h-6 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 1, right: 1, bottom: 1, left: 1 }}>
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
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

function exportCsv(campaigns: any[], crmWins: Record<string, { count: number; value: number }>) {
  const header = ["campaign_id","name","status","spend","leads","cpl","impressions","clicks","ctr","cpc","crm_wins","crm_revenue"];
  const rows = campaigns.map((c) => {
    const ins = c.insights || {};
    const spend = Number(ins.spend || 0);
    const leads = Number(ins.leads || 0);
    const wins = crmWins[c.id] || { count: 0, value: 0 };
    return [
      c.id,
      `"${String(c.name || "").replace(/"/g, '""')}"`,
      c.effective_status || c.status || "",
      spend.toFixed(2),
      leads,
      leads > 0 ? (spend / leads).toFixed(2) : "",
      ins.impressions || 0,
      ins.clicks || 0,
      ins.ctr || "",
      ins.cpc || "",
      wins.count,
      wins.value.toFixed(2),
    ].join(",");
  });
  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `campanhas_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
