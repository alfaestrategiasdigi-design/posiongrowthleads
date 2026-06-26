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
import { Plus, Trash2, TrendingUp, DollarSign, Target, Users, MousePointerClick, Activity, Wallet, Percent, RefreshCw, ShieldCheck, ShieldAlert, Loader2, Crown, Star, Play, Pause, ExternalLink, ChevronDown, ChevronRight, Archive, Megaphone, Eye, Filter, Zap, Sparkles, Layers } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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

  // Drill-down / management state
  type AdSet = { id: string; name: string; status: string; effective_status: string; daily_budget?: string; lifetime_budget?: string; optimization_goal?: string };
  type Ad = { id: string; name: string; status: string; effective_status: string };
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [adsetsByCampaign, setAdsetsByCampaign] = useState<Record<string, AdSet[]>>({});
  const [loadingAdsetsFor, setLoadingAdsetsFor] = useState<string | null>(null);
  const [expandedAdset, setExpandedAdset] = useState<string | null>(null);
  const [adsByAdset, setAdsByAdset] = useState<Record<string, Ad[]>>({});
  const [loadingAdsFor, setLoadingAdsFor] = useState<string | null>(null);
  const [busyObject, setBusyObject] = useState<string | null>(null);
  const [createCampOpen, setCreateCampOpen] = useState(false);
  const [newCamp, setNewCamp] = useState({ name: "", objective: "OUTCOME_LEADS" });
  const [budgetDialog, setBudgetDialog] = useState<{ open: boolean; id?: string; name?: string; current?: string }>({ open: false });
  const [budgetValue, setBudgetValue] = useState("");
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [showOnlyActive, setShowOnlyActive] = useState(true);
  const [detailCampaign, setDetailCampaign] = useState<MetaCampaign | null>(null);
  // CRM wins keyed by normalized campaign name (utm_campaign === campaign.name)
  const [crmWinsByCampaign, setCrmWinsByCampaign] = useState<Record<string, number>>({});

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
      const days = period === "all" ? 90 : Number(period);
      const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const until = new Date().toISOString().slice(0, 10);
      let { data, error } = await supabase.functions.invoke("facebook-campaigns-sync", { body: { since, until } });


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
    let lq = supabase.from("leads").select("id, tenant_id, status, created_at, origem, utm_campaign, facebook_campaign, facebook_form_name, reuniao_agendada_em, reuniao_realizada_em, fechado_em");
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
    // Prefer real CRM leads; fall back to reported leads only if CRM is empty.
    const totalLeads = leads.length || totalLeadsReported;

    // Status → funnel stage (aligned with PIPELINE_STAGES in src/types/admin.ts)
    const QUAL = new Set(["mql","sql","reuniao_agendada","reuniao_realizada","proposta","negociacao","ganho","convertido","fechado_ganho"]);
    const SCHED = new Set(["reuniao_agendada","reuniao_realizada","proposta","negociacao","ganho","convertido","fechado_ganho"]);
    const ATTEND = new Set(["reuniao_realizada","proposta","negociacao","ganho","convertido","fechado_ganho"]);
    const WON = new Set(["ganho","convertido","fechado_ganho"]);

    const qualified = leads.filter((l) => QUAL.has(l.status)).length;
    const scheduled = leads.filter((l) => SCHED.has(l.status) || !!l.reuniao_agendada_em).length;
    const attended = leads.filter((l) => ATTEND.has(l.status) || !!l.reuniao_realizada_em).length;
    const won = leads.filter((l) => WON.has(l.status) || !!l.fechado_em).length;

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
      ltv: ticket,
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
      const key = l.facebook_campaign || l.utm_campaign || l.facebook_form_name;
      if (!key) continue;
      const cur = map.get(key) || { name: key, spent: 0, leads: 0, sales: 0, revenue: 0 };
      cur.leads += 1; map.set(key, cur);
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
      if (data?.rate_limited) {
        toast({
          title: "Limite da API do Facebook atingido",
          description: "Aguarde alguns minutos e clique em Atualizar novamente. As campanhas anteriores foram mantidas.",
          variant: "destructive",
        });
        return; // keep previous metaCampaigns on screen
      }
      if (data?.error) throw new Error(data.error);
      setMetaCampaigns((data?.data ?? []) as MetaCampaign[]);
      // Load CRM wins for these campaigns
      try {
        const names = (data?.data ?? []).map((c: any) => c.name).filter(Boolean);
        if (names.length) {
          let q = supabase.from("leads").select("utm_campaign,status,tenant_id").eq("status", "ganho").in("utm_campaign", names);
          if (selectedTenantId) q = q.eq("tenant_id", selectedTenantId);
          const { data: wins } = await q;
          const map: Record<string, number> = {};
          (wins ?? []).forEach((l: any) => {
            const k = (l.utm_campaign || "").trim().toLowerCase();
            if (!k) return;
            map[k] = (map[k] || 0) + 1;
          });
          setCrmWinsByCampaign(map);
        } else {
          setCrmWinsByCampaign({});
        }
      } catch { /* non-fatal */ }
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

  // ===== Generic Marketing API call with reconnect handling =====
  const callFb = async (action: string, params: Record<string, any> = {}, didReconnect = false): Promise<any> => {
    const { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
      body: { action, ...params },
    });
    const det = await detectNeedReconnect(data, error);
    if (det.need && !didReconnect) {
      const ok = await requestFacebookReconnect({ reason: det.reason, missing: det.payload?.missing });
      if (ok) return callFb(action, params, true);
      throw new Error("Reconexão cancelada");
    }
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  };

  const toggleExpandCampaign = async (c: MetaCampaign) => {
    if (expandedCampaign === c.id) { setExpandedCampaign(null); return; }
    setExpandedCampaign(c.id);
    setExpandedAdset(null);
    if (!adsetsByCampaign[c.id]) {
      setLoadingAdsetsFor(c.id);
      try {
        const r = await callFb("list_adsets", { campaign_id: c.id });
        setAdsetsByCampaign((s) => ({ ...s, [c.id]: r.data ?? [] }));
      } catch (e: any) {
        toast({ title: "Falha ao listar conjuntos", description: e.message, variant: "destructive" });
      } finally { setLoadingAdsetsFor(null); }
    }
  };

  const toggleExpandAdset = async (a: AdSet) => {
    if (expandedAdset === a.id) { setExpandedAdset(null); return; }
    setExpandedAdset(a.id);
    if (!adsByAdset[a.id]) {
      setLoadingAdsFor(a.id);
      try {
        const r = await callFb("list_ads", { adset_id: a.id });
        setAdsByAdset((s) => ({ ...s, [a.id]: r.data ?? [] }));
      } catch (e: any) {
        toast({ title: "Falha ao listar anúncios", description: e.message, variant: "destructive" });
      } finally { setLoadingAdsFor(null); }
    }
  };

  const toggleObjectStatus = async (id: string, currentStatus: string, kind: "adset" | "ad", parentId: string) => {
    const next = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setBusyObject(id);
    try {
      await callFb("set_status", { object_id: id, status: next });
      toast({ title: next === "ACTIVE" ? "Ativado" : "Pausado" });
      if (kind === "adset") {
        const r = await callFb("list_adsets", { campaign_id: parentId });
        setAdsetsByCampaign((s) => ({ ...s, [parentId]: r.data ?? [] }));
      } else {
        const r = await callFb("list_ads", { adset_id: parentId });
        setAdsByAdset((s) => ({ ...s, [parentId]: r.data ?? [] }));
      }
    } catch (e: any) {
      toast({ title: "Falha", description: e.message, variant: "destructive" });
    } finally { setBusyObject(null); }
  };

  const archiveObject = async (id: string, kind: "campaign" | "adset" | "ad", parentId?: string) => {
    if (!confirm("Arquivar este item? Ele sai da lista ativa.")) return;
    setBusyObject(id);
    try {
      await callFb("set_status", { object_id: id, status: "ARCHIVED" });
      toast({ title: "Arquivado" });
      if (kind === "campaign") loadMetaCampaigns(campaignsAccountId);
      else if (kind === "adset" && parentId) {
        const r = await callFb("list_adsets", { campaign_id: parentId });
        setAdsetsByCampaign((s) => ({ ...s, [parentId]: r.data ?? [] }));
      } else if (kind === "ad" && parentId) {
        const r = await callFb("list_ads", { adset_id: parentId });
        setAdsByAdset((s) => ({ ...s, [parentId]: r.data ?? [] }));
      }
    } catch (e: any) {
      toast({ title: "Falha", description: e.message, variant: "destructive" });
    } finally { setBusyObject(null); }
  };

  const submitCreateCampaign = async () => {
    if (!newCamp.name) { toast({ title: "Nome obrigatório", variant: "destructive" }); return; }
    setBusyObject("create");
    try {
      const acc = adAccountFilter !== "all" ? adAccountFilter : adAccountId;
      await callFb("create_campaign", { name: newCamp.name, objective: newCamp.objective, status: "PAUSED", ad_account_id: acc });
      toast({ title: "Campanha criada (pausada)", description: "Configure conjunto e criativos antes de ativar." });
      setCreateCampOpen(false);
      setNewCamp({ name: "", objective: "OUTCOME_LEADS" });
      loadMetaCampaigns(campaignsAccountId);
    } catch (e: any) {
      toast({ title: "Falha ao criar", description: e.message, variant: "destructive" });
    } finally { setBusyObject(null); }
  };

  const openBudgetDialog = (id: string, name: string, current?: string) => {
    setBudgetDialog({ open: true, id, name, current });
    setBudgetValue(current ? (Number(current) / 100).toFixed(2) : "");
  };

  const submitBudget = async () => {
    if (!budgetDialog.id) return;
    const v = Number(budgetValue.replace(",", "."));
    if (!isFinite(v) || v <= 0) { toast({ title: "Valor inválido", variant: "destructive" }); return; }
    setBusyObject(budgetDialog.id);
    try {
      await callFb("update_budget", { object_id: budgetDialog.id, daily_budget: v });
      toast({ title: "Orçamento atualizado", description: `R$ ${v.toFixed(2)} / dia` });
      setBudgetDialog({ open: false });
      setBudgetValue("");
      loadMetaCampaigns(campaignsAccountId);
      // Refresh any open adsets
      if (expandedCampaign) {
        const r = await callFb("list_adsets", { campaign_id: expandedCampaign });
        setAdsetsByCampaign((s) => ({ ...s, [expandedCampaign]: r.data ?? [] }));
      }
    } catch (e: any) {
      toast({ title: "Falha", description: e.message, variant: "destructive" });
    } finally { setBusyObject(null); }
  };

  // Auto-load Meta campaigns when filter / active account / period changes
  useEffect(() => {
    if (!permState.ok) return;
    const acc = adAccountFilter !== "all" ? adAccountFilter : adAccountId;
    if (acc) loadMetaCampaigns(acc);
    // Re-sync campaign_spend silently with the actual period window
    syncFacebookAds(true).catch(() => {});
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

      {/* Contas de anúncio — vínculo com clientes (recolhível) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <button
            type="button"
            onClick={() => setAccountsOpen((v) => !v)}
            className="flex items-start gap-2 text-left hover:opacity-90"
            aria-expanded={accountsOpen}
          >
            {accountsOpen ? <ChevronDown className="w-4 h-4 mt-1" /> : <ChevronRight className="w-4 h-4 mt-1" />}
            <div>
              <CardTitle>Contas de anúncio <span className="text-xs font-normal text-muted-foreground ml-2">({adAccounts.length})</span></CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Vincule cada conta do Facebook Ads a um cliente do sistema para rotear automaticamente leads e métricas.
              </p>
            </div>
          </button>
          {accountsOpen && (
            <Button variant="outline" size="sm" onClick={() => loadAdAccounts()} disabled={loadingAccounts}>
              {loadingAccounts ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Atualizar
            </Button>
          )}
        </CardHeader>
        {accountsOpen && (
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
        )}
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
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => loadMetaCampaigns(campaignsAccountId ?? (adAccountFilter !== "all" ? adAccountFilter : adAccountId))}
              disabled={loadingCampaigns || !permState.ok}
            >
              {loadingCampaigns ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1.5" />}
              Atualizar
            </Button>
            <Button
              size="sm"
              onClick={() => setCreateCampOpen(true)}
              disabled={!permState.ok || !(adAccountFilter !== "all" ? adAccountFilter : adAccountId)}
              className="gap-1.5"
            >
              <Plus className="w-4 h-4" /> Nova campanha
            </Button>
          </div>
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
          ) : (() => {
            const visible = showOnlyActive
              ? metaCampaigns.filter((c) => c.effective_status === "ACTIVE")
              : metaCampaigns;
            const maxSpend = Math.max(1, ...visible.map((c) => c.insights?.spend ?? 0));
            const activeCount = metaCampaigns.filter((c) => c.effective_status === "ACTIVE").length;
            const total = visible.reduce((acc, c) => {
              const i = c.insights;
              if (!i) return acc;
              acc.spend += i.spend; acc.leads += i.leads; acc.clicks += i.clicks;
              acc.impr += i.impressions; acc.rev += i.purchase_value;
              return acc;
            }, { spend: 0, leads: 0, clicks: 0, impr: 0, rev: 0 });
            const cpl = total.leads > 0 ? total.spend / total.leads : 0;
            const ctr = total.impr > 0 ? (total.clicks / total.impr) * 100 : 0;
            return (
              <div className="space-y-4">
                {/* Filter bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-full border border-border/60 bg-card/60 backdrop-blur px-3 py-1.5">
                      <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">Apenas ativas</span>
                      <Switch checked={showOnlyActive} onCheckedChange={setShowOnlyActive} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      <span className="text-emerald-400 font-semibold tabular-nums">{activeCount}</span> ativas
                      <span className="mx-1.5 text-border">·</span>
                      <span className="tabular-nums">{metaCampaigns.length}</span> totais
                    </div>
                  </div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-primary" /> Marketing API ao vivo
                  </div>
                </div>

                {visible.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/50 bg-card/40 py-12 text-center text-sm text-muted-foreground">
                    Nenhuma campanha {showOnlyActive ? "ativa" : ""} nesta conta.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {visible.map((c) => (
                      <CampaignCard
                        key={c.id}
                        c={c}
                        maxSpend={maxSpend}
                        toggling={togglingCampaign === c.id}
                        busy={busyObject === c.id}
                        crmWins={crmWinsByCampaign[(c.name || "").trim().toLowerCase()] || 0}
                        onToggle={() => toggleCampaignStatus(c)}
                        onBudget={() => openBudgetDialog(c.id, c.name, c.daily_budget)}
                        onArchive={() => archiveObject(c.id, "campaign")}
                        onOpen={() => { setDetailCampaign(c); if (expandedCampaign !== c.id) toggleExpandCampaign(c); }}
                      />
                    ))}
                  </div>
                )}

                {/* Resumo */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-xs">
                  <SumTile label="Gasto" value={BRL(total.spend)} />
                  <SumTile label="Impressões" value={total.impr.toLocaleString("pt-BR")} />
                  <SumTile label="Cliques" value={total.clicks.toLocaleString("pt-BR")} />
                  <SumTile label="CTR" value={`${ctr.toFixed(2)}%`} />
                  <SumTile label="Leads" value={total.leads.toLocaleString("pt-BR")} />
                  <SumTile label="CPL médio" value={total.leads ? BRL(cpl) : "—"} />
                </div>
              </div>
            );
          })()}
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

      {/* Dialog: criar campanha */}
      <Dialog open={createCampOpen} onOpenChange={setCreateCampOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nova campanha</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={newCamp.name} onChange={(e) => setNewCamp({ ...newCamp, name: e.target.value })} placeholder="Ex.: Captação Clínicas — SP" />
            </div>
            <div>
              <Label>Objetivo</Label>
              <Select value={newCamp.objective} onValueChange={(v) => setNewCamp({ ...newCamp, objective: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["OUTCOME_LEADS","OUTCOME_SALES","OUTCOME_TRAFFIC","OUTCOME_ENGAGEMENT","OUTCOME_AWARENESS","OUTCOME_APP_PROMOTION"].map((o) =>
                    <SelectItem key={o} value={o}>{o.replace("OUTCOME_", "")}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              A campanha é criada <b>pausada</b>. Configure conjunto e criativos no Ads Manager antes de ativar.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateCampOpen(false)}>Cancelar</Button>
            <Button onClick={submitCreateCampaign} disabled={busyObject === "create"}>
              {busyObject === "create" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: editar orçamento */}
      <Dialog open={budgetDialog.open} onOpenChange={(o) => !o && setBudgetDialog({ open: false })}>
        <DialogContent>
          <DialogHeader><DialogTitle>Orçamento diário · {budgetDialog.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Novo valor (R$ por dia)</Label>
            <Input type="number" step="0.01" value={budgetValue} onChange={(e) => setBudgetValue(e.target.value)} placeholder="50.00" />
            <p className="text-xs text-muted-foreground">Atual: {budgetDialog.current ? BRL(Number(budgetDialog.current)/100) : "—"}</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBudgetDialog({ open: false })}>Cancelar</Button>
            <Button onClick={submitBudget} disabled={busyObject === budgetDialog.id}>
              {busyObject === budgetDialog.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null} Atualizar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog: Detalhes da campanha */}
      <Dialog open={!!detailCampaign} onOpenChange={(o) => !o && setDetailCampaign(null)}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          {detailCampaign && (() => {
            const c = detailCampaign;
            const ins = c.insights;
            const budget = c.daily_budget
              ? `${BRL(Number(c.daily_budget) / 100)}/dia`
              : c.lifetime_budget ? `${BRL(Number(c.lifetime_budget) / 100)} total` : "—";
            const adsets = adsetsByCampaign[c.id] ?? [];
            const statusCls =
              c.effective_status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
              c.effective_status === "PAUSED" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
              "bg-muted text-muted-foreground border-border";
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2 pr-8">
                    <Megaphone className="w-4 h-4 text-primary shrink-0" />
                    <span className="truncate">{c.name}</span>
                    <Badge variant="outline" className={statusCls}>{c.effective_status}</Badge>
                  </DialogTitle>
                  <p className="text-xs text-muted-foreground font-mono">{c.id} · {c.objective?.replace("OUTCOME_", "") ?? "—"} · {budget}</p>
                </DialogHeader>

                {/* Action bar */}
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggleCampaignStatus(c)} disabled={togglingCampaign === c.id}>
                    {togglingCampaign === c.id ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : c.effective_status === "ACTIVE" ? <Pause className="w-3.5 h-3.5 mr-1.5" /> : <Play className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />}
                    {c.effective_status === "ACTIVE" ? "Pausar" : "Ativar"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => openBudgetDialog(c.id, c.name, c.daily_budget)}>
                    <DollarSign className="w-3.5 h-3.5 mr-1.5" /> Orçamento
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => archiveObject(c.id, "campaign")} disabled={busyObject === c.id}>
                    {busyObject === c.id ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Archive className="w-3.5 h-3.5 mr-1.5" />}
                    Arquivar
                  </Button>
                  <Button size="sm" asChild variant="outline" className="ml-auto">
                    <a href={`https://business.facebook.com/adsmanager/manage/campaigns?selected_campaign_ids=${c.id}`} target="_blank" rel="noreferrer">
                      <ExternalLink className="w-3.5 h-3.5 mr-1.5" /> Abrir no Gerenciador (criativo)
                    </a>
                  </Button>
                </div>

                {/* Insights grid */}
                {ins ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <SumTile label="Gasto" value={BRL(ins.spend)} />
                    <SumTile label="Impressões" value={ins.impressions.toLocaleString("pt-BR")} />
                    <SumTile label="Alcance" value={ins.reach.toLocaleString("pt-BR")} />
                    <SumTile label="Frequência" value={ins.frequency.toFixed(2)} />
                    <SumTile label="Cliques" value={ins.clicks.toLocaleString("pt-BR")} />
                    <SumTile label="CTR" value={`${ins.ctr.toFixed(2)}%`} />
                    <SumTile label="CPC" value={BRL(ins.cpc)} />
                    <SumTile label="CPM" value={BRL(ins.cpm)} />
                    <SumTile label="Leads" value={ins.leads.toLocaleString("pt-BR")} />
                    <SumTile label="CPL" value={ins.leads ? BRL(ins.cpl) : "—"} />
                    <SumTile label="Compras" value={ins.purchases.toLocaleString("pt-BR")} />
                    <SumTile label="ROAS" value={ins.spend ? `${ins.roas.toFixed(2)}x` : "—"} />
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">Sem insights no período.</div>
                )}

                {/* Adsets + Ads */}
                <div className="space-y-2">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                    <Layers className="w-3 h-3" /> Conjuntos de anúncio
                  </div>
                  {loadingAdsetsFor === c.id ? (
                    <div className="text-xs text-muted-foreground flex items-center gap-2 py-3">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando conjuntos…
                    </div>
                  ) : adsets.length === 0 ? (
                    <div className="text-xs text-muted-foreground py-2">Nenhum conjunto.</div>
                  ) : (
                    <div className="space-y-1.5">
                      {adsets.map((a) => {
                        const adsetBudget = a.daily_budget ? `${BRL(Number(a.daily_budget)/100)}/dia` : a.lifetime_budget ? `${BRL(Number(a.lifetime_budget)/100)} total` : "—";
                        const isAdsetExp = expandedAdset === a.id;
                        const ads = adsByAdset[a.id] ?? [];
                        const adsetCls =
                          a.effective_status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
                          a.effective_status === "PAUSED" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
                          "bg-muted text-muted-foreground border-border";
                        return (
                          <div key={a.id} className="rounded-lg border border-border/50 bg-card/40">
                            <div className="flex items-center gap-2 px-3 py-2">
                              <button className="flex items-center gap-1 text-sm font-medium hover:underline truncate" onClick={() => toggleExpandAdset(a)}>
                                {isAdsetExp ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                <span className="truncate">{a.name}</span>
                              </button>
                              <Badge variant="outline" className={adsetCls + " text-[10px]"}>{a.effective_status}</Badge>
                              <span className="text-[11px] text-muted-foreground ml-auto">{adsetBudget}</span>
                              <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busyObject === a.id} onClick={() => toggleObjectStatus(a.id, a.status, "adset", c.id)}>
                                {busyObject === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : a.effective_status === "ACTIVE" ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                              </Button>
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openBudgetDialog(a.id, a.name, a.daily_budget)}>
                                <DollarSign className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                            {isAdsetExp && (
                              <div className="border-t border-border/40 px-3 py-2 bg-muted/20">
                                {loadingAdsFor === a.id ? (
                                  <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Carregando anúncios…</div>
                                ) : ads.length === 0 ? (
                                  <div className="text-xs text-muted-foreground">Nenhum anúncio.</div>
                                ) : (
                                  <div className="space-y-1">
                                    {ads.map((ad) => (
                                      <div key={ad.id} className="flex items-center gap-2 text-xs">
                                        <Megaphone className="w-3 h-3 text-muted-foreground shrink-0" />
                                        <span className="truncate">{ad.name}</span>
                                        <Badge variant="outline" className="text-[9px] ml-auto">{ad.effective_status}</Badge>
                                        <Button size="icon" variant="ghost" className="h-6 w-6" disabled={busyObject === ad.id} onClick={() => toggleObjectStatus(ad.id, ad.status, "ad", a.id)}>
                                          {busyObject === ad.id ? <Loader2 className="w-3 h-3 animate-spin" /> : ad.effective_status === "ACTIVE" ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3 text-emerald-400" />}
                                        </Button>
                                        <Button asChild size="icon" variant="ghost" className="h-6 w-6" title="Ver criativo">
                                          <a href={`https://business.facebook.com/adsmanager/manage/ads?selected_ad_ids=${ad.id}`} target="_blank" rel="noreferrer">
                                            <ExternalLink className="w-3 h-3" />
                                          </a>
                                        </Button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CampaignCard({ c, maxSpend, toggling, busy, onToggle, onBudget, onArchive, onOpen }: {
  c: any; maxSpend: number; toggling: boolean; busy: boolean;
  onToggle: () => void; onBudget: () => void; onArchive: () => void; onOpen: () => void;
}) {
  const ins = c.insights;
  const isActive = c.effective_status === "ACTIVE";
  const statusCls =
    isActive ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" :
    c.effective_status === "PAUSED" ? "bg-amber-500/15 text-amber-400 border-amber-500/30" :
    "bg-muted text-muted-foreground border-border";
  const spendPct = ins ? Math.min(100, (ins.spend / maxSpend) * 100) : 0;
  const budget = c.daily_budget
    ? `${BRL(Number(c.daily_budget) / 100)}/dia`
    : c.lifetime_budget ? `${BRL(Number(c.lifetime_budget) / 100)} total` : "—";
  const roasGood = ins && ins.spend > 0 && ins.roas >= 1;
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-card to-card/40 backdrop-blur p-4 transition-all hover:border-primary/40 hover:shadow-[0_0_24px_-8px_hsl(var(--primary)/0.4)]">
      {isActive && (
        <span className="absolute top-3 right-3 flex items-center gap-1 text-[9px] uppercase tracking-wider text-emerald-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          </span>
          ao vivo
        </span>
      )}

      <div className="flex items-start gap-2 pr-16">
        <div className={`mt-0.5 grid place-items-center w-7 h-7 rounded-md ${isActive ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"}`}>
          <Zap className="w-3.5 h-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <button onClick={onOpen} className="text-left text-sm font-semibold leading-tight hover:text-primary transition-colors line-clamp-2" title={c.name}>
            {c.name}
          </button>
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className={statusCls + " text-[9px] py-0 h-4"}>{c.effective_status}</Badge>
            <span className="text-[10px] text-muted-foreground">{c.objective?.replace("OUTCOME_", "") ?? "—"}</span>
            <span className="text-[10px] text-muted-foreground">· {budget}</span>
          </div>
        </div>
      </div>

      {/* Metrics */}
      {ins ? (
        <>
          <div className="mt-3 grid grid-cols-4 gap-1.5">
            <Metric label="Gasto" value={BRL(ins.spend)} />
            <Metric label="Leads" value={ins.leads.toLocaleString("pt-BR")} accent="text-cyan-300" />
            <Metric label="CPL" value={ins.leads ? BRL(ins.cpl) : "—"} />
            <Metric label="ROAS" value={ins.spend ? `${ins.roas.toFixed(2)}x` : "—"} accent={roasGood ? "text-emerald-400" : ins.spend ? "text-rose-400" : ""} />
          </div>

          {/* Spend bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
              <span>Participação no gasto</span>
              <span className="tabular-nums">{spendPct.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-primary via-primary/80 to-cyan-400 transition-all" style={{ width: `${spendPct}%` }} />
            </div>
          </div>

          {/* CTR / CPC */}
          <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] text-muted-foreground">
            <div>CTR <span className="text-foreground font-semibold tabular-nums">{ins.ctr.toFixed(2)}%</span></div>
            <div>CPC <span className="text-foreground font-semibold tabular-nums">{BRL(ins.cpc)}</span></div>
            <div>Impr. <span className="text-foreground font-semibold tabular-nums">{ins.impressions.toLocaleString("pt-BR")}</span></div>
          </div>
        </>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground italic">Sem insights no período.</div>
      )}

      {/* Footer actions */}
      <div className="mt-3 pt-3 border-t border-border/40 flex items-center gap-1">
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onToggle} disabled={toggling}>
          {toggling ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : isActive ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1 text-emerald-400" />}
          {isActive ? "Pausar" : "Ativar"}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onBudget}>
          <DollarSign className="w-3 h-3 mr-1" /> Orç.
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onArchive} disabled={busy}>
          {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Archive className="w-3 h-3 mr-1" />}
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs ml-auto" onClick={onOpen}>
          <Eye className="w-3 h-3 mr-1" /> Detalhes
        </Button>
      </div>
    </div>
  );
}

function Metric({ label, value, accent = "" }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-xs font-bold tabular-nums leading-tight mt-0.5 ${accent}`}>{value}</div>
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
