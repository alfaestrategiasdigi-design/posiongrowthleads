import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import {
  RefreshCw, ShieldCheck, ShieldAlert, Loader2, Play, Pause, ExternalLink,
  ChevronDown, Plus, X, Link2, Wallet, Crown,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { requestFacebookReconnect, detectNeedReconnect } from "@/components/facebook/ReconnectFacebookDialog";

type Tenant = { id: string; name: string; slug: string };
type AdAccount = {
  id: string; account_id: string; name: string;
  account_status?: number; currency?: string; business_name?: string;
};
type RoutingRule = {
  id: string; tenant_id: string; match_type: string;
  match_value: string; ad_account_id: string | null; active: boolean;
};
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

const BRL = (n: number) =>
  (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });
const NUM = (n: number) => (n || 0).toLocaleString("pt-BR");

const todayISO = () => new Date().toISOString().slice(0, 10);
const daysAgoISO = (d: number) =>
  new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

export default function CampanhasPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [rules, setRules] = useState<RoutingRule[]>([]);

  const [adAccountFilter, setAdAccountFilter] = useState<string>("all");
  const [since, setSince] = useState<string>(daysAgoISO(30));
  const [until, setUntil] = useState<string>(todayISO());
  const [onlyActive, setOnlyActive] = useState(true);

  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [adAccountId, setAdAccountId] = useState<string | null>(null);
  const [permState, setPermState] = useState<{ ok: boolean; missing: string[]; checking: boolean }>({
    ok: false, missing: [], checking: true,
  });

  const [metaCampaigns, setMetaCampaigns] = useState<MetaCampaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [togglingCampaign, setTogglingCampaign] = useState<string | null>(null);

  const [crmWinsByCampaign, setCrmWinsByCampaign] = useState<Record<string, number>>({});
  const [crmRevenueByCampaign, setCrmRevenueByCampaign] = useState<Record<string, number>>({});
  const [wonLeadsByCampaign, setWonLeadsByCampaign] = useState<Record<string, { name: string; valor: number }[]>>({});

  const [budgetDialog, setBudgetDialog] = useState<{ open: boolean; id?: string; name?: string; current?: string }>({ open: false });
  const [budgetValue, setBudgetValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  type LeadForm = { id: string; name: string; status?: string; leads_count?: number; created_time?: string };
  const [leadForms, setLeadForms] = useState<LeadForm[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [syncingForm, setSyncingForm] = useState<string | null>(null);
  const [lastLeadsSync, setLastLeadsSync] = useState<string | null>(null);

  const isPlaceholderAdAccount = !!adAccountId && /^act_1234/.test(adAccountId);
  const adAccountConfigured = !!adAccountId && !isPlaceholderAdAccount;

  const accountTenantMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rules) {
      if (!r.active || r.match_type !== "ad_account_id") continue;
      const key = r.match_value.startsWith("act_") ? r.match_value : `act_${r.match_value}`;
      m.set(key, r.tenant_id);
    }
    return m;
  }, [rules]);

  const formIdRules = useMemo(
    () => rules.filter((r) => r.active && r.match_type === "form_id"),
    [rules],
  );

  const loadAdAccounts = async (opts?: { didReconnect?: boolean }) => {
    try {
      let { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
        body: { action: "list_ad_accounts" },
      });
      if (error && !data) {
        try {
          const ctx: any = (error as any).context;
          if (ctx && typeof ctx.json === "function") data = await ctx.json();
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
    } catch { /* silent */ }
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
    setPermState((s) => ({ ...s, checking: true }));
    if (!adAccountConfigured) {
      setPermState({ ok: false, missing: [], checking: false });
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("facebook-campaigns-sync", {
        body: { check_permissions: true },
      });
      if (error) throw error;
      setPermState({ ok: !!data?.ok, missing: data?.missing ?? [], checking: false });
    } catch {
      setPermState({ ok: false, missing: ["ads_read"], checking: false });
    }
  };

  useEffect(() => { checkPermissions(); /* eslint-disable-next-line */ }, [adAccountId]);

  const attributeCrm = async (camps: { id: string; name: string }[]) => {
    if (!camps.length) {
      setCrmWinsByCampaign({}); setCrmRevenueByCampaign({}); setWonLeadsByCampaign({});
      return;
    }
    const normalize = (s: string) =>
      (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[\[\]\(\)\{\}\-\_\/\\\.,;:!\?]/g, " ").replace(/\s+/g, " ").trim();
    const tokens = (s: string) => new Set(normalize(s).split(" ").filter((t) => t.length >= 3));
    const campTokens = camps.map((c) => ({ key: c.name.trim().toLowerCase(), name: c.name, toks: tokens(c.name) }));

    const wins: Record<string, number> = {};
    const rev: Record<string, number> = {};
    const leadsMap: Record<string, { name: string; valor: number }[]> = {};
    const seen = new Set<string>();

    const selectedTenantId = adAccountFilter === "all" ? null : accountTenantMap.get(adAccountFilter) ?? null;

    const attribute = (leadId: string, leadName: string, valor: number, ...cands: (string | null | undefined)[]) => {
      if (seen.has(leadId)) return;
      let best: { key: string; name: string; score: number } | null = null;
      for (const cand of cands) {
        if (!cand) continue;
        const candNorm = cand.trim().toLowerCase();
        const candToks = tokens(cand);
        if (candToks.size === 0) continue;
        for (const c of campTokens) {
          if (c.key === candNorm) { best = { key: c.key, name: c.name, score: 1 }; break; }
          let inter = 0;
          for (const t of candToks) if (c.toks.has(t)) inter++;
          const union = candToks.size + c.toks.size - inter;
          const score = union ? inter / union : 0;
          if (score >= 0.4 && (!best || score > best.score)) best = { key: c.key, name: c.name, score };
        }
        if (best && best.score === 1) break;
      }
      if (!best) return;
      seen.add(leadId);
      wins[best.key] = (wins[best.key] || 0) + 1;
      rev[best.key] = (rev[best.key] || 0) + (Number(valor) || 0);
      (leadsMap[best.key] = leadsMap[best.key] || []).push({ name: leadName || "Lead", valor: Number(valor) || 0 });
    };

    let q1 = supabase.from("leads")
      .select("id,nome_completo,utm_campaign,facebook_campaign,facebook_form_name,valor_proposta,campaign_id_manual,tenant_id")
      .eq("status", "ganho");
    if (selectedTenantId) q1 = q1.eq("tenant_id", selectedTenantId);
    const { data: wins1 } = await q1;
    (wins1 ?? []).forEach((l: any) =>
      attribute(l.id, l.nome_completo, l.valor_proposta, l.campaign_id_manual, l.utm_campaign, l.facebook_campaign, l.facebook_form_name),
    );

    const { data: wins2 } = await supabase
      .from("agency_leads")
      .select("id,nome_clinica,responsavel,utm_campaign,valor_proposta,campaign_id_manual,tenant_id_criado")
      .eq("stage", "ganho");
    (wins2 ?? [])
      .filter((a: any) => !selectedTenantId || a.tenant_id_criado === selectedTenantId)
      .forEach((a: any) =>
        attribute(a.id, a.nome_clinica || a.responsavel, a.valor_proposta, a.campaign_id_manual, a.utm_campaign),
      );

    setCrmWinsByCampaign(wins);
    setCrmRevenueByCampaign(rev);
    setWonLeadsByCampaign(leadsMap);
  };

  const loadMetaCampaigns = async (didReconnect = false) => {
    const acc = adAccountFilter !== "all" ? adAccountFilter : adAccountId;
    if (!acc) { setMetaCampaigns([]); return; }
    setLoadingCampaigns(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
        body: { action: "list_campaigns", ad_account_id: acc, with_insights: true, since, until },
      });
      const det = await detectNeedReconnect(data, error);
      if (det.need && !didReconnect) {
        const ok = await requestFacebookReconnect({ reason: det.reason, missing: det.payload?.missing });
        if (ok) return loadMetaCampaigns(true);
        return;
      }
      if (error) throw error;
      if (data?.rate_limited) {
        toast({ title: "Limite da API do Facebook atingido", description: "Aguarde alguns minutos.", variant: "destructive" });
        return;
      }
      if (data?.error) throw new Error(data.error);
      const camps = (data?.data ?? []) as MetaCampaign[];
      setMetaCampaigns(camps);
      attributeCrm(camps.map((c) => ({ id: c.id, name: c.name })));
    } catch (e: any) {
      toast({ title: "Falha ao carregar campanhas", description: e.message ?? "", variant: "destructive" });
      setMetaCampaigns([]);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  useEffect(() => {
    if (!permState.ok) return;
    loadMetaCampaigns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adAccountFilter, adAccountId, permState.ok, since, until]);

  const syncFacebookAds = async (didReconnect = false) => {
    setSyncing(true);
    try {
      let { data, error } = await supabase.functions.invoke("facebook-campaigns-sync", { body: { since, until } });
      const det = await detectNeedReconnect(data, error);
      if (det.need && !didReconnect) {
        const ok = await requestFacebookReconnect({ reason: det.reason, missing: det.payload?.missing });
        if (ok) { await checkPermissions(); return syncFacebookAds(true); }
        return;
      }
      if (error || data?.error) throw new Error(data?.error ?? (error as any)?.message ?? "Erro");
      toast({ title: `Sincronizado: ${data?.results?.length ?? 0} campanhas` });
      setLastSync(new Date().toISOString());
      loadMetaCampaigns();
    } catch (e: any) {
      toast({ title: "Falha ao sincronizar", description: e.message, variant: "destructive" });
    } finally {
      setSyncing(false);
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
      toast({ title: target === "ACTIVE" ? "Campanha ativada" : "Campanha pausada" });
      loadMetaCampaigns();
    } catch (e: any) {
      toast({ title: "Falha ao alterar status", description: e.message ?? "", variant: "destructive" });
    } finally {
      setTogglingCampaign(null);
    }
  };

  const submitBudget = async () => {
    if (!budgetDialog.id) return;
    const v = Number(budgetValue.replace(",", "."));
    if (!isFinite(v) || v <= 0) { toast({ title: "Valor inválido", variant: "destructive" }); return; }
    setBusy(budgetDialog.id);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
        body: { action: "update_budget", object_id: budgetDialog.id, daily_budget: v },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Orçamento atualizado", description: `R$ ${v.toFixed(2)} / dia` });
      setBudgetDialog({ open: false });
      setBudgetValue("");
      loadMetaCampaigns();
    } catch (e: any) {
      toast({ title: "Falha", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  // ===== Mapping actions =====
  const linkAccountToTenant = async (account: AdAccount, tenantId: string) => {
    await supabase.from("lead_routing_rules")
      .delete().eq("match_type", "ad_account_id").eq("match_value", account.id);
    if (tenantId && tenantId !== "__none__") {
      const { error } = await supabase.from("lead_routing_rules").insert({
        tenant_id: tenantId, match_type: "ad_account_id", match_value: account.id,
        match_label: account.name, ad_account_id: account.id, priority: 10, active: true,
      } as any);
      if (error) { toast({ title: "Erro ao vincular", description: error.message, variant: "destructive" }); return; }
      toast({ title: "Conta vinculada" });
    } else {
      toast({ title: "Vínculo removido" });
    }
    loadRules();
  };

  // ===== Lead Forms (Meta) =====
  const loadLeadForms = async () => {
    setLoadingForms(true); setFormsError(null);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
        body: { action: "list_lead_forms" },
      });
      if (error) throw error;
      if (data?.need_page) { setFormsError(data.error); setLeadForms([]); return; }
      if (data?.error) throw new Error(data.error);
      setLeadForms((data?.data ?? []) as LeadForm[]);
    } catch (e: any) {
      setFormsError(e.message ?? "Falha ao carregar formulários");
      setLeadForms([]);
    } finally { setLoadingForms(false); }
  };

  const bindFormToTenant = async (formId: string, formName: string, tenantId: string) => {
    setBusy(`form:${formId}`);
    try {
      await supabase.from("lead_routing_rules")
        .delete().eq("match_type", "form_id").eq("match_value", formId);
      if (tenantId && tenantId !== "__none__") {
        const { error } = await supabase.from("lead_routing_rules").insert({
          tenant_id: tenantId, match_type: "form_id", match_value: formId,
          match_label: formName, priority: 5, active: true,
        } as any);
        if (error) throw error;
        toast({ title: "Formulário vinculado", description: formName });
      } else {
        toast({ title: "Vínculo removido", description: formName });
      }
      loadRules();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const syncFormNow = async (formId: string, formName: string) => {
    setSyncingForm(formId);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-backfill-leads", {
        body: { form_ids: [formId], max_per_form: 200 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const s = (data?.summary ?? [])[0] ?? {};
      toast({
        title: "Sync concluído",
        description: `${formName}: ${s.imported ?? 0} novo(s), ${s.deduped ?? 0} duplicado(s)`,
      });
      setLastLeadsSync(new Date().toISOString());
    } catch (e: any) {
      toast({ title: "Falha no sync", description: e.message, variant: "destructive" });
    } finally { setSyncingForm(null); }
  };

  const syncAllForms = async () => {
    setSyncingForm("__all__");
    try {
      const { data, error } = await supabase.functions.invoke("facebook-backfill-leads", { body: {} });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const total = (data?.summary ?? []).reduce((a: number, x: any) => a + (x.imported ?? 0), 0);
      toast({ title: "Sync geral concluído", description: `${total} lead(s) importado(s).` });
      setLastLeadsSync(new Date().toISOString());
    } catch (e: any) {
      toast({ title: "Falha no sync", description: e.message, variant: "destructive" });
    } finally { setSyncingForm(null); }
  };

  const formTenantMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rules) if (r.active && r.match_type === "form_id") m.set(r.match_value, r.tenant_id);
    return m;
  }, [rules]);


  // ===== KPIs =====
  const visibleCampaigns = useMemo(
    () => onlyActive ? metaCampaigns.filter((c) => c.effective_status === "ACTIVE") : metaCampaigns,
    [metaCampaigns, onlyActive],
  );

  const kpis = useMemo(() => {
    const src = metaCampaigns; // KPIs sempre sobre o total (não filtrado por ativas)
    let spend = 0, leads = 0, purchaseValue = 0, active = 0;
    for (const c of src) {
      const i = c.insights;
      if (i) { spend += i.spend || 0; leads += i.leads || 0; purchaseValue += i.purchase_value || 0; }
      if (c.effective_status === "ACTIVE") active++;
    }
    const crmRevenue = Object.values(crmRevenueByCampaign).reduce((a, b) => a + b, 0);
    const totalRevenue = purchaseValue + crmRevenue;
    return {
      spend, leads, active, total: src.length,
      cpl: leads > 0 ? spend / leads : null,
      roas: spend > 0 ? totalRevenue / spend : null,
      crmRevenue,
    };
  }, [metaCampaigns, crmRevenueByCampaign]);

  const lastSyncLabel = lastSync
    ? new Date(lastSync).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "nunca";

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 py-8 px-4 md:px-6 flex justify-center">
      <div className="w-full max-w-6xl space-y-6">

        {/* Sticky header */}
        <header className="sticky top-0 z-40 bg-[#0A0A0A]/90 backdrop-blur-md border border-white/5 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-4 shadow-2xl">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={adAccountFilter} onValueChange={setAdAccountFilter}>
              <SelectTrigger className="w-[260px] bg-[#111] border-white/10 text-white text-sm">
                <SelectValue placeholder="Conta de anúncio" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  <span className="flex items-center gap-2"><Crown className="w-3.5 h-3.5 text-[#C9A84C]" /> Todas as contas</span>
                </SelectItem>
                {adAccounts.map((a) => {
                  const tid = accountTenantMap.get(a.id);
                  const tname = tid ? tenants.find((t) => t.id === tid)?.name : null;
                  return (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex flex-col">
                        <span className="font-medium">{a.name}</span>
                        <span className="text-[10px] text-muted-foreground">{a.id}{tname ? ` · ${tname}` : " · sem cliente"}</span>
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <div className="h-6 w-px bg-white/10" />
            <Input type="date" value={since} onChange={(e) => setSince(e.target.value)}
              className="bg-[#111] border-white/10 text-white text-sm w-[150px]" />
            <span className="text-xs text-slate-500 font-medium">ATÉ</span>
            <Input type="date" value={until} onChange={(e) => setUntil(e.target.value)}
              className="bg-[#111] border-white/10 text-white text-sm w-[150px]" />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Apenas ativas</span>
              <Switch checked={onlyActive} onCheckedChange={setOnlyActive} />
            </label>
            <Button
              onClick={() => syncFacebookAds()}
              disabled={syncing || !adAccountConfigured}
              className="bg-[#C9A84C] hover:bg-[#F0D78C] text-[#050505] font-bold text-xs h-9"
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span className="ml-1.5">SINCRONIZAR</span>
            </Button>
          </div>
        </header>

        {/* API Status */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#0A0A0A] border border-white/5 rounded-xl">
          <div className="flex items-center gap-2">
            {permState.checking ? (
              <><Loader2 className="w-3 h-3 animate-spin text-slate-500" /><span className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">Verificando permissões…</span></>
            ) : permState.ok ? (
              <><div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /><span className="text-[10px] uppercase tracking-widest font-semibold text-slate-500">Meta Marketing API: Conectado</span></>
            ) : (
              <><ShieldAlert className="w-3 h-3 text-amber-500" /><span className="text-[10px] uppercase tracking-widest font-semibold text-amber-500">
                {!adAccountConfigured ? "Nenhuma conta ativa" : `Permissões faltando: ${permState.missing.join(", ") || "ads_read"}`}
              </span></>
            )}
          </div>
          <span className="text-[10px] text-slate-600 font-mono">Última sync: {lastSyncLabel}</span>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiTile label="Investido" value={BRL(kpis.spend)} accent />
          <KpiTile label="Leads" value={NUM(kpis.leads)} />
          <KpiTile label="CPL" value={kpis.cpl != null ? BRL(kpis.cpl) : "—"} />
          <KpiTile label="ROAS" value={kpis.roas != null ? `${kpis.roas.toFixed(2)}x` : "—"} accentSoft />
          <KpiTile label="Receita CRM" value={BRL(kpis.crmRevenue)} accent />
          <KpiTile label="Ativas / Total" value={`${kpis.active} / ${kpis.total}`} />
        </div>

        {/* Mapping */}
        <details className="group bg-[#0A0A0A] border border-white/5 rounded-2xl overflow-hidden">
          <summary className="list-none cursor-pointer p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#C9A84C]/10 flex items-center justify-center text-[#C9A84C]">
                <Link2 className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-semibold text-white tracking-wide uppercase">Mapeamento de Contas & Formulários</h3>
            </div>
            <ChevronDown className="w-5 h-5 text-slate-500 group-open:rotate-180 transition-transform" />
          </summary>
          <div className="px-4 pb-6 space-y-6">
            {/* Ad accounts → tenant */}
            <div>
              <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2 pt-2">Contas de anúncios → Cliente</div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-white/5 text-left">
                      <th className="py-2 font-medium">CONTA</th>
                      <th className="py-2 font-medium">ID</th>
                      <th className="py-2 font-medium">VINCULAR TENANT</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {adAccounts.length === 0 && (
                      <tr><td colSpan={3} className="py-4 text-slate-500 text-center">Nenhuma conta acessível.</td></tr>
                    )}
                    {adAccounts.map((a) => {
                      const linkedTenant = accountTenantMap.get(a.id) ?? "__none__";
                      return (
                        <tr key={a.id}>
                          <td className="py-3 text-white">{a.name}</td>
                          <td className="py-3 text-slate-500 font-mono">{a.id}</td>
                          <td className="py-3">
                            <Select value={linkedTenant} onValueChange={(v) => linkAccountToTenant(a, v)}>
                              <SelectTrigger className="bg-[#111] border-white/10 text-slate-300 h-8 w-[220px] text-xs">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">— Sem vínculo —</SelectItem>
                                {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Lead Forms (Meta) → Cliente */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Formulários de Lead Ads → Cliente</div>
                  <div className="text-[10px] text-slate-600 mt-0.5">
                    {leadForms.length > 0
                      ? `${leadForms.filter((f) => formTenantMap.has(f.id)).length} de ${leadForms.length} vinculado(s)${lastLeadsSync ? ` · última sync ${new Date(lastLeadsSync).toLocaleTimeString("pt-BR")}` : ""}`
                      : "Puxa direto da página Facebook conectada"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={loadLeadForms} disabled={loadingForms}
                    className="h-7 text-[10px] text-slate-400 hover:text-white">
                    {loadingForms ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                    ATUALIZAR LISTA
                  </Button>
                  <Button size="sm" onClick={syncAllForms} disabled={syncingForm === "__all__" || leadForms.length === 0}
                    className="h-7 text-[10px] bg-[#C9A84C]/10 text-[#C9A84C] hover:bg-[#C9A84C] hover:text-[#050505] border border-[#C9A84C]/20">
                    {syncingForm === "__all__" ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                    SYNC TODOS
                  </Button>
                </div>
              </div>

              {formsError && (
                <div className="text-[11px] text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded px-3 py-2 mb-2">
                  {formsError}
                </div>
              )}

              {!formsError && leadForms.length === 0 && !loadingForms && (
                <div className="text-[11px] text-slate-500 italic px-2 py-3">
                  Clique em "Atualizar lista" para carregar os formulários da página Facebook conectada.
                </div>
              )}

              {leadForms.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-white/5 text-left">
                        <th className="py-2 font-medium">FORMULÁRIO</th>
                        <th className="py-2 font-medium">ID</th>
                        <th className="py-2 font-medium text-right">LEADS</th>
                        <th className="py-2 font-medium">CLIENTE VINCULADO</th>
                        <th className="py-2 font-medium text-right">AÇÃO</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {leadForms.map((f) => {
                        const linked = formTenantMap.get(f.id) ?? "__none__";
                        const linkedName = linked !== "__none__" ? tenants.find((t) => t.id === linked)?.name : null;
                        return (
                          <tr key={f.id}>
                            <td className="py-3 text-white">
                              <div className="flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${linkedName ? "bg-emerald-500" : "bg-slate-600"}`} />
                                {f.name}
                              </div>
                            </td>
                            <td className="py-3 text-slate-500 font-mono text-[10px]">{f.id}</td>
                            <td className="py-3 text-slate-400 text-right tabular-nums">{f.leads_count ?? 0}</td>
                            <td className="py-3">
                              <Select
                                value={linked}
                                onValueChange={(v) => bindFormToTenant(f.id, f.name, v)}
                                disabled={busy === `form:${f.id}`}
                              >
                                <SelectTrigger className="bg-[#111] border-white/10 text-slate-300 h-8 w-[220px] text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">— Sem vínculo (vai para fallback) —</SelectItem>
                                  {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="py-3 text-right">
                              <Button size="sm" variant="ghost" onClick={() => syncFormNow(f.id, f.name)}
                                disabled={syncingForm === f.id}
                                className="h-7 text-[10px] text-[#C9A84C] hover:bg-[#C9A84C]/10">
                                {syncingForm === f.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                                SYNC AGORA
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>
        </details>

        {/* Campaigns */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-xs font-bold text-slate-500 tracking-widest uppercase">Performance de Campanhas</h3>
            <span className="text-[10px] text-slate-600 uppercase">
              {loadingCampaigns ? "Carregando…" : `${visibleCampaigns.length} campanha(s) · ordenado por gasto`}
            </span>
          </div>

          {!adAccountConfigured && (
            <div className="bg-[#0A0A0A] border border-white/5 rounded-2xl p-8 text-center text-sm text-slate-500">
              Selecione uma conta de anúncio para carregar campanhas.
            </div>
          )}

          {adAccountConfigured && !loadingCampaigns && visibleCampaigns.length === 0 && (
            <div className="bg-[#0A0A0A] border border-white/5 rounded-2xl p-8 text-center text-sm text-slate-500">
              Nenhuma campanha {onlyActive ? "ativa" : ""} no período selecionado.
            </div>
          )}

          {[...visibleCampaigns].sort((a, b) => (b.insights?.spend || 0) - (a.insights?.spend || 0)).map((c) => {
            const i = c.insights;
            const key = c.name.trim().toLowerCase();
            const crmWins = crmWinsByCampaign[key] || 0;
            const crmRev = crmRevenueByCampaign[key] || 0;
            const wonList = wonLeadsByCampaign[key] || [];
            const isActive = c.effective_status === "ACTIVE";
            const dailyBudgetR = c.daily_budget ? Number(c.daily_budget) / 100 : null;
            return (
              <div key={c.id}
                className={`bg-[#0A0A0A] border border-white/5 rounded-2xl p-5 hover:border-[#C9A84C]/30 transition-all group ${!isActive ? "opacity-80" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      <span className={`w-2 h-2 rounded-full ${isActive ? "bg-emerald-500" : "bg-slate-700"}`} />
                      <h4 className={`text-lg font-serif ${isActive ? "text-white group-hover:text-[#F0D78C]" : "text-slate-400"} transition-colors truncate`}>
                        {c.name}
                      </h4>
                    </div>
                    <p className="text-xs text-slate-500 font-mono">
                      {c.id} · {c.objective || "—"}{dailyBudgetR ? ` · orç. ${BRL(dailyBudgetR)}/dia` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Gasto</p>
                      <p className="text-md font-semibold text-white">{BRL(i?.spend || 0)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] text-slate-500 uppercase font-bold tracking-tighter">Ganhos CRM</p>
                      <p className="text-md font-semibold text-[#C9A84C]">{BRL(crmRev)}</p>
                      {crmWins > 0 && <p className="text-[9px] text-slate-600">{crmWins} venda(s)</p>}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 border-t border-white/5 pt-4 items-center">
                  <Metric label="Leads" value={NUM(i?.leads || 0)} />
                  <Metric label="CPL" value={i && i.leads ? BRL(i.spend / i.leads) : "—"} />
                  <Metric label="CTR" value={i ? `${(i.ctr || 0).toFixed(2)}%` : "—"} />
                  <Metric label="ROAS" value={i && i.spend ? `${((i.purchase_value + crmRev) / i.spend).toFixed(2)}x` : "—"} />
                  <div className="flex items-center justify-end gap-2 flex-wrap">
                    <Button size="sm" variant="ghost"
                      onClick={() => setBudgetDialog({ open: true, id: c.id, name: c.name, current: c.daily_budget })}
                      className="h-7 text-[10px] text-slate-400 hover:text-white">
                      <Wallet className="w-3 h-3 mr-1" /> ORÇAMENTO
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleCampaignStatus(c)} disabled={togglingCampaign === c.id}
                      className="h-7 text-[10px] text-slate-400 hover:text-white">
                      {togglingCampaign === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> :
                        isActive ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                      {isActive ? "PAUSAR" : "ATIVAR"}
                    </Button>
                    <a href={`https://www.facebook.com/adsmanager/manage/campaigns?act=${(c as any).account_id || (adAccountFilter !== "all" ? adAccountFilter : adAccountId || "").replace("act_", "")}&selected_campaign_ids=${c.id}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[10px] font-bold text-[#C9A84C] uppercase tracking-widest border border-[#C9A84C]/20 px-3 py-1.5 rounded hover:bg-[#C9A84C] hover:text-[#050505] transition-all flex items-center gap-1">
                      <ExternalLink className="w-3 h-3" /> Ads Manager
                    </a>
                  </div>
                </div>

                {wonList.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-white/5 flex flex-wrap gap-1.5">
                    {wonList.slice(0, 6).map((w, idx) => (
                      <span key={idx} className="text-[10px] px-2 py-0.5 rounded bg-[#C9A84C]/10 text-[#F0D78C] border border-[#C9A84C]/20">
                        {w.name} · {BRL(w.valor)}
                      </span>
                    ))}
                    {wonList.length > 6 && (
                      <span className="text-[10px] px-2 py-0.5 text-slate-500">+{wonList.length - 6}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Budget dialog */}
      <Dialog open={budgetDialog.open} onOpenChange={(o) => !o && setBudgetDialog({ open: false })}>
        <DialogContent className="bg-[#0A0A0A] border-white/10 text-slate-200">
          <DialogHeader><DialogTitle>Orçamento diário — {budgetDialog.name}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Valor em R$ / dia</Label>
            <Input value={budgetValue} onChange={(e) => setBudgetValue(e.target.value)} placeholder="50.00"
              className="bg-[#111] border-white/10 text-white" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBudgetDialog({ open: false })}>Cancelar</Button>
            <Button onClick={submitBudget} disabled={busy === budgetDialog.id}
              className="bg-[#C9A84C] hover:bg-[#F0D78C] text-[#050505] font-bold">
              {busy === budgetDialog.id ? <Loader2 className="w-4 h-4 animate-spin" /> : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add form rule dialog */}
      <Dialog open={addRuleOpen} onOpenChange={setAddRuleOpen}>
        <DialogContent className="bg-[#0A0A0A] border-white/10 text-slate-200">
          <DialogHeader><DialogTitle>Nova regra form_id → cliente</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Form ID (Facebook Lead Form)</Label>
              <Input value={newRule.form_id} onChange={(e) => setNewRule({ ...newRule, form_id: e.target.value })}
                placeholder="1234567890" className="bg-[#111] border-white/10 text-white font-mono" />
            </div>
            <div>
              <Label>Cliente</Label>
              <Select value={newRule.tenant_id} onValueChange={(v) => setNewRule({ ...newRule, tenant_id: v })}>
                <SelectTrigger className="bg-[#111] border-white/10 text-white"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddRuleOpen(false)}>Cancelar</Button>
            <Button onClick={addFormRule} className="bg-[#C9A84C] hover:bg-[#F0D78C] text-[#050505] font-bold">Adicionar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function KpiTile({ label, value, accent, accentSoft }: { label: string; value: string; accent?: boolean; accentSoft?: boolean }) {
  const color = accent ? "text-[#C9A84C]" : accentSoft ? "text-[#F0D78C]" : "text-white";
  return (
    <div className="bg-[#0A0A0A] border border-white/5 p-5 rounded-2xl">
      <p className="text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-2">{label}</p>
      <p className={`text-xl font-serif ${color} truncate`}>{value}</p>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] text-slate-600 uppercase mb-0.5">{label}</p>
      <p className="text-sm font-medium text-slate-300">{value}</p>
    </div>
  );
}
