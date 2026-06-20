import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Plus, Trash2, TrendingUp, DollarSign, Target, Users, MousePointerClick, Activity, Wallet, Percent, RefreshCw, ShieldCheck, ShieldAlert, Loader2, Crown, Star, Play, Pause, ExternalLink, ChevronDown, ChevronRight, Archive, Megaphone } from "lucide-react";
import { Link } from "react-router-dom";
import { requestFacebookReconnect, detectNeedReconnect } from "@/components/facebook/ReconnectFacebookDialog";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, AreaChart, Area,
} from "recharts";

type Tenant = { id: string; name: string; slug: string };
type Spend = {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  channel: string;
  campaign_name: string | null;
  campaign_id: string | null;
  amount_spent: number;
  impressions: number;
  clicks: number;
  leads_generated: number;
  notes: string | null;
  created_at: string;
};

const CHANNELS = [
  { value: "meta_ads", label: "Meta Ads" },
  { value: "google_ads", label: "Google Ads" },
  { value: "tiktok", label: "TikTok Ads" },
  { value: "outros", label: "Outros" },
];

const BRL = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });
const PCT = (n: number) => `${(n * 100).toFixed(1)}%`;

type AdAccount = {
  id: string;            // act_XXXX
  account_id: string;    // XXXX
  name: string;
  account_status?: number;
  currency?: string;
  business_name?: string;
};
type RoutingRule = {
  id: string;
  tenant_id: string;
  match_type: string;
  match_value: string;
  ad_account_id: string | null;
  active: boolean;
};

export default function CampanhasPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  // 'all' = admin master (todas as contas) | act_XXXX
  const [adAccountFilter, setAdAccountFilter] = useState<string>("all");
  const [period, setPeriod] = useState<"30" | "60" | "90" | "all">("30");
  const [spends, setSpends] = useState<Spend[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; account?: AdAccount; tenantId: string }>({
    open: false, tenantId: "",
  });
  const [form, setForm] = useState({
    tenant_id: "",
    period_start: new Date().toISOString().slice(0, 10),
    period_end: new Date().toISOString().slice(0, 10),
    channel: "meta_ads",
    campaign_name: "",
    campaign_id: "",
    amount_spent: "",
    impressions: "",
    clicks: "",
    leads_generated: "",
    notes: "",
  });

  // Facebook Ads sync state
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [adAccountId, setAdAccountId] = useState<string | null>(null);
  const [settingActive, setSettingActive] = useState<string | null>(null);
  const [permState, setPermState] = useState<{ ok: boolean; granted: string[]; missing: string[]; checking: boolean }>({
    ok: false, granted: [], missing: [], checking: true,
  });

  // Live Meta campaigns + insights for the selected ad account
  type MetaCampaign = {
    id: string; name: string; status: string; effective_status: string;
    objective?: string; daily_budget?: string; lifetime_budget?: string;
    insights?: {
      spend: number; impressions: number; clicks: number; ctr: number;
      cpc: number; cpm: number; reach: number; frequency: number;
      leads: number; cpl: number;
      purchases: number; purchase_value: number; roas: number;
    } | null;
  };
  const [metaCampaigns, setMetaCampaigns] = useState<MetaCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaignsAccountId, setCampaignsAccountId] = useState<string | null>(null);
  const [togglingCampaign, setTogglingCampaign] = useState<string | null>(null);

  const isPlaceholderAdAccount = !!adAccountId && /^act_1234/.test(adAccountId);
  const adAccountConfigured = !!adAccountId && !isPlaceholderAdAccount;

  // ad_account_id -> tenant_id (from routing rules)
  const accountTenantMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rules) {
      if (!r.active) continue;
      const key = r.match_type === "ad_account_id" ? r.match_value : r.ad_account_id;
      if (key) m.set(key.startsWith("act_") ? key : `act_${key}`, r.tenant_id);
    }
    return m;
  }, [rules]);

  const selectedTenantId = adAccountFilter === "all" ? null : accountTenantMap.get(adAccountFilter) ?? null;

  const loadAdAccounts = async (opts?: { didReconnect?: boolean }) => {
    setLoadingAccounts(true);
    try {
      let { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
        body: { action: "list_ad_accounts" },
      });
      if (error && !data) {
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === "function") data = await ctx.json();
          else if (ctx && typeof ctx.text === "function") {
            const t = await ctx.text();
            try { data = JSON.parse(t); } catch { data = { error: t }; }
          }
        } catch { /* ignore */ }
      }
      const det = await detectNeedReconnect(data, error);
      if (det.need && !opts?.didReconnect) {
        const ok = await requestFacebookReconnect({ reason: det.reason, missing: det.payload?.missing });
        if (ok) return loadAdAccounts({ didReconnect: true });
        return;
      }
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAdAccounts((data?.data ?? []) as AdAccount[]);
    } catch (e: any) {
      // mantém vazio; UI exibirá CTA para conectar
    } finally {
      setLoadingAccounts(false);
    }
  };


  const loadRules = async () => {
    const { data } = await supabase
      .from("lead_routing_rules")
      .select("id, tenant_id, match_type, match_value, ad_account_id, active")
      .order("priority", { ascending: true });
    setRules((data ?? []) as any);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("tenants").select("id, name, slug").order("name");
      setTenants((data ?? []) as any);
      const { data: cfg } = await supabase.rpc("get_facebook_config_meta" as any);
      const row: any = Array.isArray(cfg) ? cfg[0] : cfg;
      setLastSync(row?.last_campaigns_sync_at ?? null);
      setAdAccountId(row?.ad_account_id ?? null);
      loadRules();
      loadAdAccounts();
    })();
  }, []);


  const checkPermissions = async () => {
    setPermState(s => ({ ...s, checking: true }));
    if (!adAccountConfigured) {
      // Sem ad account real, nem vale chamar — não exibir falso "ads_read ausente"
      setPermState({ ok: false, granted: [], missing: [], checking: false });
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("facebook-campaigns-sync", {
        body: { check_permissions: true },
      });
      if (error) throw error;
      setPermState({
        ok: !!data?.ok,
        granted: data?.granted ?? [],
        missing: data?.missing ?? [],
        checking: false,
      });
    } catch (e: any) {
      setPermState({ ok: false, granted: [], missing: ["ads_read"], checking: false });
    }
  };

  useEffect(() => { checkPermissions(); /* eslint-disable-next-line */ }, [adAccountId]);

  const syncFacebookAds = async (silent = false, didReconnect = false) => {
    setSyncing(true);
    try {
      let { data, error } = await supabase.functions.invoke("facebook-campaigns-sync", { body: { days: 30 } });

      // Edge function returned non-2xx — try to read the JSON body from the error context.
      if (error && !data) {
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === "function") data = await ctx.json();
          else if (ctx && typeof ctx.text === "function") {
            const t = await ctx.text();
            try { data = JSON.parse(t); } catch { data = { error: t }; }
          }
        } catch { /* ignore */ }
      }

      const det = await detectNeedReconnect(data, error);
      if (det.need && !didReconnect) {
        const ok = await requestFacebookReconnect({ reason: det.reason, missing: det.payload?.missing });
        if (ok) {
          await checkPermissions();
          return syncFacebookAds(silent, true);
        }
        return;
      }
      const msg: string = data?.error ?? (error as any)?.message ?? "";

      if (error || data?.error) {
        if (!silent) toast({ title: "Falha ao sincronizar", description: msg || "Erro desconhecido", variant: "destructive" });
        return;
      }

      if (!silent) toast({ title: `Sincronizado: ${data?.results?.length ?? 0} campanhas` });
      setLastSync(new Date().toISOString());
      load();
    } catch (e: any) {
      if (!silent) toast({ title: "Erro ao sincronizar", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };


  // auto-sync if stale (>15min) and permissions ok and ad account real
  useEffect(() => {
    if (!adAccountConfigured || !permState.ok || permState.checking) return;
    const ageMin = lastSync ? (Date.now() - new Date(lastSync).getTime()) / 60000 : 9999;
    if (ageMin > 15) syncFacebookAds(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permState.ok, permState.checking, adAccountConfigured]);

  const load = async () => {
    setLoading(true);
    const cutoff =
      period === "all"
        ? null
        : new Date(Date.now() - Number(period) * 86400000).toISOString();

    let sq = supabase.from("campaign_spend").select("*").order("period_start", { ascending: false });
    let lq = supabase.from("clinic_leads").select("id, tenant_id, stage, created_at, channel, utm_campaign, facebook_campaign_id");
    let saq = supabase.from("sales").select("id, tenant_id, amount, amount_paid, created_at, utm_campaign, facebook_campaign_id");
    if (selectedTenantId) {
      sq = sq.eq("tenant_id", selectedTenantId);
      lq = lq.eq("tenant_id", selectedTenantId);
      saq = saq.eq("tenant_id", selectedTenantId);
    }

    if (cutoff) {
      sq = sq.gte("period_start", cutoff.slice(0, 10));
      lq = lq.gte("created_at", cutoff);
      saq = saq.gte("created_at", cutoff);
    }
    const [{ data: s }, { data: l }, { data: sa }] = await Promise.all([sq, lq, saq]);
    setSpends((s ?? []) as any);
    setLeads((l ?? []) as any);
    setSales((sa ?? []) as any);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId, period]);

  const kpis = useMemo(() => {
    const totalSpent = spends.reduce((s, x) => s + Number(x.amount_spent || 0), 0);
    const totalImpressions = spends.reduce((s, x) => s + Number(x.impressions || 0), 0);
    const totalClicks = spends.reduce((s, x) => s + Number(x.clicks || 0), 0);
    const totalLeadsReported = spends.reduce((s, x) => s + Number(x.leads_generated || 0), 0);
    const totalLeads = leads.length || totalLeadsReported;

    const qualified = leads.filter((l) =>
      ["qualificado", "avaliacao_agendada", "compareceu", "em_negociacao", "fechado_ganho"].includes(l.stage),
    ).length;
    const scheduled = leads.filter((l) =>
      ["avaliacao_agendada", "compareceu", "em_negociacao", "fechado_ganho"].includes(l.stage),
    ).length;
    const attended = leads.filter((l) =>
      ["compareceu", "em_negociacao", "fechado_ganho"].includes(l.stage),
    ).length;
    const won = leads.filter((l) => l.stage === "fechado_ganho").length;

    const revenue = sales.reduce((s, x) => s + Number(x.amount || 0), 0);
    const collected = sales.reduce((s, x) => s + Number(x.amount_paid || 0), 0);
    const ticket = sales.length > 0 ? revenue / sales.length : 0;

    return {
      totalSpent,
      totalImpressions,
      totalClicks,
      totalLeads,
      qualified,
      scheduled,
      attended,
      won,
      revenue,
      collected,
      ticket,
      ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
      cpl: totalLeads > 0 ? totalSpent / totalLeads : 0,
      cac: won > 0 ? totalSpent / won : 0,
      qualifyRate: totalLeads > 0 ? qualified / totalLeads : 0,
      scheduleRate: qualified > 0 ? scheduled / qualified : 0,
      attendRate: scheduled > 0 ? attended / scheduled : 0,
      conversionRate: totalLeads > 0 ? won / totalLeads : 0,
      roi: totalSpent > 0 ? (revenue - totalSpent) / totalSpent : 0,
      ltv: ticket, // proxy: ticket médio (sem recall ainda)
    };
  }, [spends, leads, sales]);

  const perCampaign = useMemo(() => {
    const map = new Map<string, { name: string; spent: number; leads: number; sales: number; revenue: number }>();
    for (const s of spends) {
      const key = s.campaign_name || s.campaign_id || `${s.channel} · ${s.period_start}`;
      const cur = map.get(key) || { name: key, spent: 0, leads: 0, sales: 0, revenue: 0 };
      cur.spent += Number(s.amount_spent || 0);
      cur.leads += Number(s.leads_generated || 0);
      map.set(key, cur);
    }
    for (const l of leads) {
      const key = l.utm_campaign || l.facebook_campaign_id;
      if (!key) continue;
      const cur = map.get(key);
      if (cur) cur.leads += 0; // já vem do spend reportado
    }
    for (const sa of sales) {
      const key = sa.utm_campaign || sa.facebook_campaign_id;
      if (!key) continue;
      const cur = map.get(key);
      if (cur) {
        cur.sales += 1;
        cur.revenue += Number(sa.amount || 0);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.spent - a.spent);
  }, [spends, leads, sales]);

  const dailyTrend = useMemo(() => {
    const days = period === "all" ? 90 : Number(period);
    const buckets: Record<string, { date: string; spent: number; leads: number; revenue: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      buckets[d] = { date: d.slice(5), spent: 0, leads: 0, revenue: 0 };
    }
    spends.forEach((s) => {
      const d = s.period_start.slice(0, 10);
      if (buckets[d]) buckets[d].spent += Number(s.amount_spent || 0);
    });
    leads.forEach((l) => {
      const d = l.created_at.slice(0, 10);
      if (buckets[d]) buckets[d].leads += 1;
    });
    sales.forEach((sa) => {
      const d = sa.created_at.slice(0, 10);
      if (buckets[d]) buckets[d].revenue += Number(sa.amount || 0);
    });
    return Object.values(buckets);
  }, [spends, leads, sales, period]);

  const submit = async () => {
    if (!form.tenant_id) {
      toast({ title: "Selecione a clínica", variant: "destructive" });
      return;
    }
    if (Number(form.amount_spent) <= 0) {
      toast({ title: "Informe o valor investido", variant: "destructive" });
      return;
    }
    const { error } = await supabase.from("campaign_spend").insert({
      tenant_id: form.tenant_id,
      period_start: form.period_start,
      period_end: form.period_end,
      channel: form.channel,
      campaign_name: form.campaign_name || null,
      campaign_id: form.campaign_id || null,
      amount_spent: Number(form.amount_spent),
      impressions: Number(form.impressions) || 0,
      clicks: Number(form.clicks) || 0,
      leads_generated: Number(form.leads_generated) || 0,
      notes: form.notes || null,
    } as any);
    if (error) {
      toast({ title: "Erro ao salvar", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Investimento registrado" });
    setOpen(false);
    setForm({ ...form, amount_spent: "", impressions: "", clicks: "", leads_generated: "", campaign_name: "", campaign_id: "", notes: "" });
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Excluir este registro?")) return;
    const { error } = await supabase.from("campaign_spend").delete().eq("id", id);
    if (error) {
      toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Removido" });
    load();
  };

  const openLinkDialog = (account: AdAccount) => {
    setLinkDialog({ open: true, account, tenantId: accountTenantMap.get(account.id) ?? "" });
  };

  const saveAccountLink = async () => {
    const account = linkDialog.account;
    if (!account) return;
    const tenantId = linkDialog.tenantId;
    // Remove existing rule(s) for this ad account
    await supabase
      .from("lead_routing_rules")
      .delete()
      .eq("match_type", "ad_account_id")
      .eq("match_value", account.id);
    if (tenantId && tenantId !== "__none__") {
      const { error } = await supabase.from("lead_routing_rules").insert({
        tenant_id: tenantId,
        match_type: "ad_account_id",
        match_value: account.id,
        match_label: account.name,
        ad_account_id: account.id,
        priority: 10,
        active: true,
      } as any);
      if (error) {
        toast({ title: "Erro ao vincular", description: error.message, variant: "destructive" });
        return;
      }
      toast({ title: "Conta vinculada", description: `${account.name} → ${tenants.find(t => t.id === tenantId)?.name ?? ""}` });
    } else {
      toast({ title: "Vínculo removido", description: account.name });
    }
    setLinkDialog({ open: false, tenantId: "" });
    loadRules();
  };

  // Define a conta de anúncio "ativa" para o admin master (grava em facebook_webhook_config.ad_account_id).
  const setActiveAdAccount = async (account: AdAccount) => {
    setSettingActive(account.id);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-config-save", {
        body: { ad_account_id: account.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setAdAccountId(account.id);
      toast({ title: "Conta ativa definida", description: `${account.name} (${account.id})` });
      // Carrega campanhas imediatamente
      loadMetaCampaigns(account.id);
      checkPermissions();
    } catch (e: any) {
      toast({ title: "Falha ao definir conta ativa", description: e.message ?? "", variant: "destructive" });
    } finally {
      setSettingActive(null);
    }
  };

  const loadMetaCampaigns = async (accountId?: string | null, didReconnect = false) => {
    const acc = accountId ?? (adAccountFilter !== "all" ? adAccountFilter : adAccountId);
    if (!acc) { setMetaCampaigns([]); setCampaignsAccountId(null); return; }
    setLoadingCampaigns(true);
    setCampaignsAccountId(acc);
    try {
      const days = period === "all" ? 90 : Number(period);
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const until = new Date().toISOString().slice(0, 10);
      let { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
        body: { action: "list_campaigns", ad_account_id: acc, with_insights: true, since, until },
      });
      const det = await detectNeedReconnect(data, error);
      if (det.need && !didReconnect) {
        const ok = await requestFacebookReconnect({ reason: det.reason, missing: det.payload?.missing });
        if (ok) return loadMetaCampaigns(acc, true);
        return;
      }
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setMetaCampaigns((data?.data ?? []) as MetaCampaign[]);
    } catch (e: any) {
      toast({ title: "Falha ao carregar campanhas", description: e.message ?? "", variant: "destructive" });
      setMetaCampaigns([]);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  const toggleCampaignStatus = async (c: MetaCampaign) => {
    const target = c.effective_status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setTogglingCampaign(c.id);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
        body: { action: "set_status", object_id: c.id, status: target },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: target === "ACTIVE" ? "Campanha ativada" : "Campanha pausada", description: c.name });
      loadMetaCampaigns(campaignsAccountId);
    } catch (e: any) {
      toast({ title: "Falha ao alterar status", description: e.message ?? "", variant: "destructive" });
    } finally {
      setTogglingCampaign(null);
    }
  };

  // Auto-load Meta campaigns when filter / active account changes
  useEffect(() => {
    if (!permState.ok) return;
    const acc = adAccountFilter !== "all" ? adAccountFilter : adAccountId;
    if (acc) loadMetaCampaigns(acc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adAccountFilter, adAccountId, permState.ok, period]);


  return (

    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Campanhas & Tráfego</h1>
          <p className="text-sm text-muted-foreground">KPIs de performance, ROI, CPA, CAC e funil de conversão.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={adAccountFilter} onValueChange={setAdAccountFilter}>
            <SelectTrigger className="w-[300px]"><SelectValue placeholder="Conta de anúncio" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                <span className="flex items-center gap-2"><Crown className="w-3.5 h-3.5 text-accent" /> Admin Master (todas as contas)</span>
              </SelectItem>
              {adAccounts.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {loadingAccounts ? "Carregando contas…" : "Nenhuma conta de anúncio acessível."}
                </div>
              )}
              {adAccounts.map((a) => {
                const tid = accountTenantMap.get(a.id);
                const tname = tid ? tenants.find((t) => t.id === tid)?.name : null;
                return (
                  <SelectItem key={a.id} value={a.id}>
                    <span className="flex flex-col">
                      <span className="font-medium">{a.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {a.id}{tname ? ` · ${tname}` : " · sem cliente vinculado"}
                      </span>
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>

          <Select value={period} onValueChange={(v: any) => setPeriod(v)}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Últimos 30d</SelectItem>
              <SelectItem value="60">Últimos 60d</SelectItem>
              <SelectItem value="90">Últimos 90d</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="w-4 h-4" /> Novo investimento</Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle>Registrar investimento de campanha</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <Label>Clínica</Label>
                  <Select value={form.tenant_id} onValueChange={(v) => setForm({ ...form, tenant_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Início</Label><Input type="date" value={form.period_start} onChange={(e) => setForm({ ...form, period_start: e.target.value })} /></div>
                <div><Label>Fim</Label><Input type="date" value={form.period_end} onChange={(e) => setForm({ ...form, period_end: e.target.value })} /></div>
                <div>
                  <Label>Canal</Label>
                  <Select value={form.channel} onValueChange={(v) => setForm({ ...form, channel: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Valor investido (R$)</Label><Input type="number" step="0.01" value={form.amount_spent} onChange={(e) => setForm({ ...form, amount_spent: e.target.value })} /></div>
                <div><Label>Nome da campanha</Label><Input value={form.campaign_name} onChange={(e) => setForm({ ...form, campaign_name: e.target.value })} /></div>
                <div><Label>ID da campanha (UTM/Meta)</Label><Input value={form.campaign_id} onChange={(e) => setForm({ ...form, campaign_id: e.target.value })} /></div>
                <div><Label>Impressões</Label><Input type="number" value={form.impressions} onChange={(e) => setForm({ ...form, impressions: e.target.value })} /></div>
                <div><Label>Cliques</Label><Input type="number" value={form.clicks} onChange={(e) => setForm({ ...form, clicks: e.target.value })} /></div>
                <div><Label>Leads reportados</Label><Input type="number" value={form.leads_generated} onChange={(e) => setForm({ ...form, leads_generated: e.target.value })} /></div>
                <div className="col-span-2"><Label>Observações</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button onClick={submit}>Salvar</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Facebook Ads — status, sync e validação de permissões */}
      <Card>
        <CardContent className="p-4 flex flex-wrap items-center gap-3 justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border ${
              !adAccountConfigured
                ? "border-amber-500/30 text-amber-400 bg-amber-500/5"
                : permState.checking
                  ? "border-border text-muted-foreground bg-muted/30"
                  : permState.ok
                    ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/5"
                    : "border-amber-500/30 text-amber-400 bg-amber-500/5"
            }`}>
              {!adAccountConfigured ? <ShieldAlert className="w-3.5 h-3.5" />
                : permState.checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : permState.ok ? <ShieldCheck className="w-3.5 h-3.5" />
                : <ShieldAlert className="w-3.5 h-3.5" />}
              {!adAccountConfigured
                ? (isPlaceholderAdAccount
                    ? `Ad Account é placeholder (${adAccountId}) — configure o real em /admin/facebook`
                    : "Ad Account não configurada — vá em /admin/facebook, passo 2")
                : permState.checking ? "Validando Marketing API…"
                : permState.ok ? `Marketing API conectada · ${adAccountId}`
                : `Permissão ausente: ${permState.missing.join(", ") || "ads_read"} — reconecte com escopo ads_read`}
            </div>
            {lastSync && (
              <span className="text-xs text-muted-foreground">
                Última sync: {new Date(lastSync).toLocaleString("pt-BR")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!adAccountConfigured ? (
              <Button asChild size="sm" className="gradient-accent">
                <Link to="/admin/facebook">Configurar Facebook →</Link>
              </Button>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={checkPermissions} disabled={permState.checking}>
                  <ShieldCheck className="w-4 h-4 mr-1.5" /> Revalidar
                </Button>
                {!permState.ok && !permState.checking && (
                  <Button asChild variant="outline" size="sm">
                    <Link to="/admin/facebook">Reconectar Facebook</Link>
                  </Button>
                )}
                <Button size="sm" onClick={() => syncFacebookAds(false)} disabled={syncing || !permState.ok}>
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
                  Sincronizar Facebook Ads
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Contas de anúncio — vínculo com clientes */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Contas de anúncio</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Vincule cada conta do Facebook Ads a um cliente do sistema para rotear automaticamente leads e métricas.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => loadAdAccounts()} disabled={loadingAccounts}>
            {loadingAccounts ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {adAccounts.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              {loadingAccounts
                ? "Carregando contas de anúncio…"
                : "Nenhuma conta acessível. Verifique a conexão do Facebook e as permissões ads_read/ads_management."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead>Moeda</TableHead>
                    <TableHead>Cliente vinculado</TableHead>
                    <TableHead>Status admin</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {adAccounts.map((a) => {
                    const tid = accountTenantMap.get(a.id);
                    const tname = tid ? tenants.find((t) => t.id === tid)?.name : null;
                    const isActive = adAccountId === a.id;
                    return (
                      <TableRow key={a.id} className={isActive ? "bg-accent/5" : ""}>
                        <TableCell className="font-medium">
                          <span className="flex items-center gap-1.5">
                            {isActive && <Star className="w-3.5 h-3.5 text-accent fill-accent" />}
                            {a.name}
                          </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{a.id}</TableCell>
                        <TableCell className="text-xs">{a.currency ?? "—"}</TableCell>
                        <TableCell>
                          {tname ? (
                            <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">{tname}</Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">Sem vínculo</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {isActive ? (
                            <Badge className="bg-accent/15 text-accent border-accent/30">
                              <Crown className="w-3 h-3 mr-1" /> Conta ativa
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-2 justify-end flex-wrap">
                            <Button
                              size="sm"
                              variant={isActive ? "secondary" : "default"}
                              disabled={isActive || settingActive === a.id}
                              onClick={() => setActiveAdAccount(a)}
                              className={!isActive ? "gradient-accent text-[hsl(232_65%_5%)]" : ""}
                            >
                              {settingActive === a.id ? (
                                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                              ) : (
                                <Star className="w-3.5 h-3.5 mr-1.5" />
                              )}
                              {isActive ? "Ativa" : "Definir como ativa"}
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => openLinkDialog(a)}>
                              {tname ? "Alterar cliente" : "Vincular cliente"}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { setAdAccountFilter(a.id); loadMetaCampaigns(a.id); }}>
                              Ver campanhas
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campanhas ao vivo (Meta Marketing API) */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              Campanhas — Facebook Ads (ao vivo)
              {campaignsAccountId && (
                <Badge variant="outline" className="font-mono text-[10px]">{campaignsAccountId}</Badge>
              )}
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Lista direta da Marketing API com performance, ROAS, CPL e ações no período selecionado.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => loadMetaCampaigns(campaignsAccountId ?? (adAccountFilter !== "all" ? adAccountFilter : adAccountId))}
            disabled={loadingCampaigns || !permState.ok}
          >
            {loadingCampaigns ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
            Atualizar
          </Button>
        </CardHeader>
        <CardContent>
          {!permState.ok ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Conecte o Facebook com as permissões da Marketing API para ver as campanhas ao vivo.
            </div>
          ) : !campaignsAccountId ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Selecione uma conta de anúncio acima (ou clique em <b>Definir como ativa</b>) para listar as campanhas.
            </div>
          ) : loadingCampaigns ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Carregando campanhas e insights…
            </div>
          ) : metaCampaigns.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Nenhuma campanha encontrada nesta conta.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Campanha</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Objetivo</TableHead>
                    <TableHead className="text-right">Orçamento</TableHead>
                    <TableHead className="text-right">Gasto</TableHead>
                    <TableHead className="text-right">Impr.</TableHead>
                    <TableHead className="text-right">Cliques</TableHead>
                    <TableHead className="text-right">CTR</TableHead>
                    <TableHead className="text-right">CPC</TableHead>
                    <TableHead className="text-right">Leads</TableHead>
                    <TableHead className="text-right">CPL</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {metaCampaigns.map((c, i) => {
                    const ins = c.insights;
                    const budget = c.daily_budget
                      ? `${BRL(Number(c.daily_budget) / 100)}/dia`
                      : c.lifetime_budget
                        ? `${BRL(Number(c.lifetime_budget) / 100)} total`
                        : "—";
                    const statusColor =
                      c.effective_status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                      c.effective_status === "PAUSED" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                      "bg-muted text-muted-foreground border-border";
                    return (
                      <TableRow key={c.id} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                        <TableCell className="font-medium max-w-[260px] truncate" title={c.name}>{c.name}</TableCell>
                        <TableCell><Badge variant="outline" className={statusColor}>{c.effective_status}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{c.objective?.replace("OUTCOME_", "") ?? "—"}</TableCell>
                        <TableCell className="text-right text-xs">{budget}</TableCell>
                        <TableCell className="text-right tabular-nums">{ins ? BRL(ins.spend) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{ins ? ins.impressions.toLocaleString("pt-BR") : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{ins ? ins.clicks.toLocaleString("pt-BR") : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{ins ? `${ins.ctr.toFixed(2)}%` : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{ins ? BRL(ins.cpc) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{ins ? ins.leads.toLocaleString("pt-BR") : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{ins && ins.leads > 0 ? BRL(ins.cpl) : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {ins && ins.spend > 0 ? (
                            <span className={ins.roas >= 1 ? "text-emerald-400" : "text-rose-400"}>
                              {ins.roas.toFixed(2)}x
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-1 justify-end">
                            <Button
                              size="icon"
                              variant="ghost"
                              title={c.effective_status === "ACTIVE" ? "Pausar" : "Ativar"}
                              disabled={togglingCampaign === c.id}
                              onClick={() => toggleCampaignStatus(c)}
                            >
                              {togglingCampaign === c.id ? <Loader2 className="w-4 h-4 animate-spin" />
                                : c.effective_status === "ACTIVE" ? <Pause className="w-4 h-4" />
                                : <Play className="w-4 h-4 text-emerald-400" />}
                            </Button>
                            <Button asChild size="icon" variant="ghost" title="Abrir no Gerenciador">
                              <a href={`https://business.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${c.id}`} target="_blank" rel="noreferrer">
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              {/* Resumo da conta */}
              {(() => {
                const total = metaCampaigns.reduce((acc, c) => {
                  const i = c.insights;
                  if (!i) return acc;
                  acc.spend += i.spend; acc.leads += i.leads; acc.clicks += i.clicks;
                  acc.impr += i.impressions; acc.rev += i.purchase_value;
                  return acc;
                }, { spend: 0, leads: 0, clicks: 0, impr: 0, rev: 0 });
                const cpl = total.leads > 0 ? total.spend / total.leads : 0;
                const ctr = total.impr > 0 ? (total.clicks / total.impr) * 100 : 0;
                return (
                  <div className="mt-4 grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                    <SumTile label="Gasto" value={BRL(total.spend)} />
                    <SumTile label="Impressões" value={total.impr.toLocaleString("pt-BR")} />
                    <SumTile label="Cliques" value={total.clicks.toLocaleString("pt-BR")} />
                    <SumTile label="CTR" value={`${ctr.toFixed(2)}%`} />
                    <SumTile label="Leads" value={total.leads.toLocaleString("pt-BR")} />
                    <SumTile label="CPL médio" value={total.leads ? BRL(cpl) : "—"} />
                  </div>
                );
              })()}
            </div>
          )}
        </CardContent>
      </Card>



      {/* Dialog: vincular conta de anúncio a um cliente */}
      <Dialog open={linkDialog.open} onOpenChange={(o) => setLinkDialog((s) => ({ ...s, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Vincular conta de anúncio</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-sm">
              <div className="font-medium">{linkDialog.account?.name}</div>
              <div className="text-xs text-muted-foreground font-mono">{linkDialog.account?.id}</div>
            </div>
            <div>
              <Label>Cliente do sistema</Label>
              <Select
                value={linkDialog.tenantId || "__none__"}
                onValueChange={(v) => setLinkDialog((s) => ({ ...s, tenantId: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Selecionar cliente" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Sem vínculo —</SelectItem>
                  {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground mt-2">
                Cria uma regra de roteamento (<code>ad_account_id</code> → cliente) para leads e métricas.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setLinkDialog({ open: false, tenantId: "" })}>Cancelar</Button>
            <Button onClick={saveAccountLink}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* KPI grid */}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Kpi icon={<Wallet className="w-4 h-4" />} label="Investido" value={BRL(kpis.totalSpent)} accent="from-primary/20 to-primary/5" />
        <Kpi icon={<Users className="w-4 h-4" />} label="Leads" value={kpis.totalLeads.toString()} />
        <Kpi icon={<Target className="w-4 h-4" />} label="CPL" value={BRL(kpis.cpl)} />
        <Kpi icon={<Activity className="w-4 h-4" />} label="CAC" value={BRL(kpis.cac)} />
        <Kpi icon={<TrendingUp className="w-4 h-4" />} label="ROI" value={PCT(kpis.roi)} accent={kpis.roi >= 0 ? "from-emerald-500/20 to-emerald-500/5" : "from-red-500/20 to-red-500/5"} />
        <Kpi icon={<DollarSign className="w-4 h-4" />} label="Receita" value={BRL(kpis.revenue)} accent="from-emerald-500/20 to-emerald-500/5" />
        <Kpi icon={<DollarSign className="w-4 h-4" />} label="Ticket médio" value={BRL(kpis.ticket)} />
        <Kpi icon={<MousePointerClick className="w-4 h-4" />} label="CTR" value={PCT(kpis.ctr)} />
        <Kpi icon={<Percent className="w-4 h-4" />} label="Tx Qualificação" value={PCT(kpis.qualifyRate)} />
        <Kpi icon={<Percent className="w-4 h-4" />} label="Tx Conversão" value={PCT(kpis.conversionRate)} />
      </div>

      {/* Funil */}
      <Card>
        <CardHeader><CardTitle>Funil de Conversão</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              { l: "Leads", v: kpis.totalLeads, c: "bg-blue-500/15 text-blue-400" },
              { l: "Qualificados", v: kpis.qualified, c: "bg-cyan-500/15 text-cyan-400" },
              { l: "Agendados", v: kpis.scheduled, c: "bg-violet-500/15 text-violet-400" },
              { l: "Compareceram", v: kpis.attended, c: "bg-amber-500/15 text-amber-400" },
              { l: "Fechados", v: kpis.won, c: "bg-emerald-500/15 text-emerald-400" },
            ].map((s, i) => (
              <div key={i} className={`rounded-lg p-4 ${s.c} border border-border/40`}>
                <div className="text-xs uppercase tracking-wider opacity-80">{s.l}</div>
                <div className="text-3xl font-bold mt-1">{s.v}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Investimento × Receita</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <AreaChart data={dailyTrend}>
                <defs>
                  <linearGradient id="gSpent" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--destructive))" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(var(--destructive))" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Legend />
                <Area type="monotone" dataKey="spent" name="Investido" stroke="hsl(var(--destructive))" fill="url(#gSpent)" />
                <Area type="monotone" dataKey="revenue" name="Receita" stroke="hsl(var(--primary))" fill="url(#gRev)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Leads por dia</CardTitle></CardHeader>
          <CardContent className="h-72">
            <ResponsiveContainer>
              <LineChart data={dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
                <Line type="monotone" dataKey="leads" stroke="hsl(var(--accent-foreground))" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Por campanha */}
      <Card>
        <CardHeader><CardTitle>Performance por Campanha</CardTitle></CardHeader>
        <CardContent className="h-80">
          <ResponsiveContainer>
            <BarChart data={perCampaign.slice(0, 10)} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <YAxis type="category" dataKey="name" width={140} stroke="hsl(var(--muted-foreground))" fontSize={11} />
              <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }} />
              <Legend />
              <Bar dataKey="spent" name="Investido" fill="hsl(var(--destructive))" radius={[0, 4, 4, 0]} />
              <Bar dataKey="revenue" name="Receita" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Tabela de registros */}
      <Card>
        <CardHeader><CardTitle>Investimentos registrados</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Período</TableHead>
                  <TableHead>Canal</TableHead>
                  <TableHead>Campanha</TableHead>
                  <TableHead className="text-right">Invest.</TableHead>
                  <TableHead className="text-right">Impr.</TableHead>
                  <TableHead className="text-right">Cliques</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Carregando…</TableCell></TableRow>
                ) : spends.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">Nenhum investimento registrado no período.</TableCell></TableRow>
                ) : spends.map((s, i) => {
                  const cpl = s.leads_generated > 0 ? Number(s.amount_spent) / s.leads_generated : 0;
                  return (
                    <TableRow key={s.id} className={i % 2 === 0 ? "bg-muted/30" : ""}>
                      <TableCell className="text-xs">{s.period_start} → {s.period_end}</TableCell>
                      <TableCell><Badge variant="secondary">{CHANNELS.find((c) => c.value === s.channel)?.label ?? s.channel}</Badge></TableCell>
                      <TableCell className="font-medium">{s.campaign_name || <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right">{BRL(Number(s.amount_spent))}</TableCell>
                      <TableCell className="text-right">{s.impressions.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right">{s.clicks.toLocaleString("pt-BR")}</TableCell>
                      <TableCell className="text-right">{s.leads_generated}</TableCell>
                      <TableCell className="text-right">{BRL(cpl)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" onClick={() => remove(s.id)} aria-label="Excluir">
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SumTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function Kpi({ icon, label, value, accent = "from-muted to-muted/30" }: { icon: React.ReactNode; label: string; value: string; accent?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br ${accent} p-4 transition-transform hover:scale-[1.02]`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
        {icon}{label}
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}
