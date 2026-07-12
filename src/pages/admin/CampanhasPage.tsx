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
  ChevronDown, Plus, X, Link2, Wallet, Crown, AlertTriangle, Settings, CheckSquare, Square, Zap,
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

  // ===== Gestão de eficiência (alertas) =====
  type Thresholds = { cplTarget: number; cprLimit: number; alertMarginPct: number };
  const THRESH_KEY = "posion.campanhas.thresholds.v1";
  const [thresholds, setThresholds] = useState<Thresholds>(() => {
    try {
      const raw = localStorage.getItem(THRESH_KEY);
      if (raw) return { cplTarget: 25, cprLimit: 150, alertMarginPct: 20, ...JSON.parse(raw) };
    } catch {}
    return { cplTarget: 25, cprLimit: 150, alertMarginPct: 20 };
  });
  useEffect(() => { try { localStorage.setItem(THRESH_KEY, JSON.stringify(thresholds)); } catch {} }, [thresholds]);
  const [thresholdDialog, setThresholdDialog] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "critical" | "warn" | "ok">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPausing, setBulkPausing] = useState(false);

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
  const [crmApptsByCampaign, setCrmApptsByCampaign] = useState<Record<string, number>>({});
  const [crmCompByCampaign, setCrmCompByCampaign] = useState<Record<string, number>>({});

  const [budgetDialog, setBudgetDialog] = useState<{ open: boolean; id?: string; name?: string; current?: string }>({ open: false });
  const [budgetValue, setBudgetValue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  type LeadForm = { id: string; name: string; status?: string; leads_count?: number; created_time?: string; page_id?: string; page_name?: string };
  type PageSummary = { id: string; name: string; forms_count: number; error?: boolean };
  const [leadForms, setLeadForms] = useState<LeadForm[]>([]);
  const [leadPages, setLeadPages] = useState<PageSummary[]>([]);
  const [leadFormErrors, setLeadFormErrors] = useState<{ page_id: string; page_name: string; error: string }[]>([]);
  const [loadingForms, setLoadingForms] = useState(false);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [syncingForm, setSyncingForm] = useState<string | null>(null);
  const [lastLeadsSync, setLastLeadsSync] = useState<string | null>(null);
  const [formsStale, setFormsStale] = useState<{ since: string; rateLimited: boolean } | null>(null);

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
      setCrmWinsByCampaign({}); setCrmRevenueByCampaign({}); setWonLeadsByCampaign({}); setCrmApptsByCampaign({}); setCrmCompByCampaign({});
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
    const appts: Record<string, number> = {};
    const comp: Record<string, number> = {};
    const seen = new Set<string>();
    const seenAppt = new Set<string>();
    const seenComp = new Set<string>();

    const selectedTenantId = adAccountFilter === "all" ? null : accountTenantMap.get(adAccountFilter) ?? null;

    const matchCampaign = (...cands: (string | null | undefined)[]) => {
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
      return best;
    };

    const attribute = (leadId: string, leadName: string, valor: number, ...cands: (string | null | undefined)[]) => {
      if (seen.has(leadId)) return;
      const best = matchCampaign(...cands);
      if (!best) return;
      seen.add(leadId);
      wins[best.key] = (wins[best.key] || 0) + 1;
      rev[best.key] = (rev[best.key] || 0) + (Number(valor) || 0);
      (leadsMap[best.key] = leadsMap[best.key] || []).push({ name: leadName || "Lead", valor: Number(valor) || 0 });
    };

    const attributeAppt = (leadId: string, ...cands: (string | null | undefined)[]) => {
      if (seenAppt.has(leadId)) return;
      const best = matchCampaign(...cands);
      if (!best) return;
      seenAppt.add(leadId);
      appts[best.key] = (appts[best.key] || 0) + 1;
    };

    const attributeComp = (leadId: string, ...cands: (string | null | undefined)[]) => {
      if (seenComp.has(leadId)) return;
      const best = matchCampaign(...cands);
      if (!best) return;
      seenComp.add(leadId);
      comp[best.key] = (comp[best.key] || 0) + 1;
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

    // Agendados: espelha exatamente a coluna "CONSULTA AGENDADA" do Kanban
    // (status = "reuniao_agendada"). Não soma etapas posteriores para bater 1:1 com os cards.
    let qa = supabase.from("leads")
      .select("id,utm_campaign,facebook_campaign,facebook_form_name,campaign_id_manual,tenant_id")
      .eq("status", "reuniao_agendada");
    if (selectedTenantId) qa = qa.eq("tenant_id", selectedTenantId);
    const { data: apptLeads } = await qa;
    (apptLeads ?? []).forEach((l: any) =>
      attributeAppt(l.id, l.campaign_id_manual, l.utm_campaign, l.facebook_campaign, l.facebook_form_name),
    );

    const { data: apptLeads2 } = await supabase
      .from("agency_leads")
      .select("id,utm_campaign,campaign_id_manual,tenant_id_criado,stage")
      .eq("stage", "reuniao_agendada");
    (apptLeads2 ?? [])
      .filter((a: any) => !selectedTenantId || a.tenant_id_criado === selectedTenantId)
      .forEach((a: any) => attributeAppt(a.id, a.campaign_id_manual, a.utm_campaign));

    // Compareceu: usado para o Custo por Reunião (CPR)
    let qc = supabase.from("leads")
      .select("id,utm_campaign,facebook_campaign,facebook_form_name,campaign_id_manual,tenant_id")
      .eq("status", "compareceu");
    if (selectedTenantId) qc = qc.eq("tenant_id", selectedTenantId);
    const { data: compLeads } = await qc;
    (compLeads ?? []).forEach((l: any) =>
      attributeComp(l.id, l.campaign_id_manual, l.utm_campaign, l.facebook_campaign, l.facebook_form_name),
    );

    const { data: compLeads2 } = await supabase
      .from("agency_leads")
      .select("id,utm_campaign,campaign_id_manual,tenant_id_criado,stage")
      .eq("stage", "compareceu");
    (compLeads2 ?? [])
      .filter((a: any) => !selectedTenantId || a.tenant_id_criado === selectedTenantId)
      .forEach((a: any) => attributeComp(a.id, a.campaign_id_manual, a.utm_campaign));

    setCrmWinsByCampaign(wins);
    setCrmRevenueByCampaign(rev);
    setWonLeadsByCampaign(leadsMap);
    setCrmApptsByCampaign(appts);
    setCrmCompByCampaign(comp);
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
    // Espelha em lead_routing_rules (roteio de leads) e tenant_ad_accounts (visão do cliente)
    await supabase.from("lead_routing_rules")
      .delete().eq("match_type", "ad_account_id").eq("match_value", account.id);
    await supabase.from("tenant_ad_accounts")
      .delete().eq("ad_account_id", account.id);
    if (tenantId && tenantId !== "__none__") {
      const { error: e1 } = await supabase.from("lead_routing_rules").insert({
        tenant_id: tenantId, match_type: "ad_account_id", match_value: account.id,
        match_label: account.name, ad_account_id: account.id, priority: 10, active: true,
      } as any);
      if (e1) { toast({ title: "Erro ao vincular (routing)", description: e1.message, variant: "destructive" }); return; }
      const { error: e2 } = await supabase.from("tenant_ad_accounts").insert({
        tenant_id: tenantId, ad_account_id: account.id, label: account.name, active: true,
      } as any);
      if (e2) { toast({ title: "Erro ao vincular (tenant)", description: e2.message, variant: "destructive" }); return; }
      toast({ title: "Conta vinculada ao cliente", description: account.name });
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
      if (data?.need_page || data?.need_reconnect) { setFormsError(data.error); setLeadForms([]); setLeadPages([]); setLeadFormErrors([]); setFormsStale(null); return; }
      if (data?.error) throw new Error(data.error);
      setLeadForms((data?.data ?? []) as LeadForm[]);
      setLeadPages((data?.pages ?? []) as PageSummary[]);
      setLeadFormErrors((data?.errors ?? []) as any[]);
      setFormsStale(data?.stale ? { since: data.stale_since, rateLimited: !!data.rate_limited } : null);
    } catch (e: any) {
      setFormsError(e.message ?? "Falha ao carregar formulários");
      setLeadForms([]); setLeadPages([]); setLeadFormErrors([]); setFormsStale(null);
    } finally { setLoadingForms(false); }
  };

  const bindFormToTenant = async (
    formId: string,
    formName: string,
    tenantId: string,
    pageId?: string | null,
    pageName?: string | null,
  ) => {
    setBusy(`form:${formId}`);
    try {
      await supabase.from("lead_routing_rules")
        .delete().eq("match_type", "form_id").eq("match_value", formId);
      if (tenantId && tenantId !== "__none__") {
        const { error } = await supabase.from("lead_routing_rules").insert({
          tenant_id: tenantId, match_type: "form_id", match_value: formId,
          match_label: formName, priority: 5, active: true,
          page_id: pageId ?? null, page_name: pageName ?? null,
        } as any);
        if (error) throw error;
        toast({ title: "Formulário vinculado", description: `${formName}${pageName ? ` (Página: ${pageName})` : ""} — importando histórico…` });
        // Auto import historical leads for this form so they land on the tenant
        supabase.functions.invoke("facebook-backfill-leads", {
          body: { form_ids: [formId], max_per_form: 2000 },
        }).then(({ data }) => {
          const s = ((data?.by_form ?? data?.summary ?? [])[0]) ?? {};
          if (s.error) {
            toast({ title: `Falha ao importar histórico`, description: `${formName}: ${s.error}`, variant: "destructive" });
          } else if (s.imported != null) {
            toast({ title: "Histórico importado", description: `${formName}: ${s.imported} novo(s), ${s.deduped ?? 0} já existentes.` });
            setLastLeadsSync(new Date().toISOString());
          }
        }).catch(() => {});
      } else {
        toast({ title: "Vínculo removido", description: formName });
      }
      loadRules();
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally { setBusy(null); }
  };


  // Garante que todo form_id que será sincronizado tem regra de roteamento.
  // Se não tem, cria automaticamente como is_admin_master=true (rota POSION),
  // caso contrário o backfill trata os leads como "unrouted" e conta como falha.
  const ensureRoutingRules = async (formEntries: { id: string; name?: string | null; page_id?: string | null; page_name?: string | null }[]) => {
    if (formEntries.length === 0) return 0;
    const ids = formEntries.map((f) => f.id);
    const { data: existing } = await supabase
      .from("lead_routing_rules")
      .select("match_value")
      .eq("match_type", "form_id")
      .in("match_value", ids);
    const have = new Set((existing ?? []).map((r: any) => String(r.match_value)));
    const toInsert = formEntries
      .filter((f) => !have.has(f.id))
      .map((f) => ({
        tenant_id: null,
        match_type: "form_id",
        match_value: f.id,
        match_label: f.name || `Formulário ${f.id}`,
        priority: 5,
        active: true,
        is_admin_master: true,
        page_id: f.page_id ?? null,
        page_name: f.page_name ?? null,
      }));
    if (toInsert.length === 0) return 0;
    const { error } = await supabase.from("lead_routing_rules").insert(toInsert as any);
    if (error) {
      console.error("[ensureRoutingRules] falha:", error);
      return 0;
    }
    return toInsert.length;
  };

  const syncFormNow = async (formId: string, formName: string, maxPerForm = 200) => {
    setSyncingForm(formId);
    try {
      const meta = leadForms.find((f) => f.id === formId);
      const registered = await ensureRoutingRules([{
        id: formId, name: formName,
        page_id: (meta as any)?.page_id ?? null,
        page_name: (meta as any)?.page_name ?? null,
      }]);
      if (registered > 0) {
        toast({ title: "Formulário registrado como POSION", description: `${formName} — leads irão para a conta admin.` });
        await loadRules();
      }

      const { data, error } = await supabase.functions.invoke("facebook-backfill-leads", {
        body: { form_ids: [formId], max_per_form: maxPerForm },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const s = (data?.by_form ?? data?.summary ?? [])[0] ?? {};
      if (s.error) {
        toast({ title: `Falha — ${formName}`, description: s.error, variant: "destructive" });
      } else {
        toast({
          title: "Sync concluído",
          description: `${formName}: ${s.imported ?? 0} novo(s), ${s.deduped ?? 0} duplicado(s), ${s.failed ?? 0} falha(s)`,
        });
      }
      setLastLeadsSync(new Date().toISOString());
    } catch (e: any) {
      toast({ title: "Falha no sync", description: e.message, variant: "destructive" });
    } finally { setSyncingForm(null); }
  };

  const syncPageForms = async (pageName: string, formIds: string[]) => {
    if (formIds.length === 0) return;
    const key = `page:${pageName}`;
    setSyncingForm(key);
    try {
      const entries = formIds.map((fid) => {
        const meta = leadForms.find((f) => f.id === fid);
        return {
          id: fid,
          name: meta?.name ?? null,
          page_id: (meta as any)?.page_id ?? null,
          page_name: (meta as any)?.page_name ?? pageName,
        };
      });
      const registered = await ensureRoutingRules(entries);
      if (registered > 0) {
        toast({ title: `${registered} formulário(s) registrado(s) como POSION`, description: pageName });
        await loadRules();
      }

      const { data, error } = await supabase.functions.invoke("facebook-backfill-leads", {
        body: { form_ids: formIds, max_per_form: 5000 },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const rows = (data?.by_form ?? data?.summary ?? []) as any[];
      const total = rows.reduce((a, x) => a + (x.imported ?? 0), 0);
      const dedup = rows.reduce((a, x) => a + (x.deduped ?? 0), 0);
      const errors = rows.filter((x) => x.error);
      if (errors.length) {
        toast({
          title: `Import parcial — ${pageName}`,
          description: `${total} novo(s), ${dedup} duplicado(s). ${errors.length} form(s) com erro: ${errors[0].error}`,
          variant: "destructive",
        });
      } else {
        toast({ title: `Histórico importado — ${pageName}`, description: `${total} novo(s), ${dedup} já existentes.` });
      }
      setLastLeadsSync(new Date().toISOString());
    } catch (e: any) {
      toast({ title: "Falha no import", description: e.message, variant: "destructive" });
    } finally { setSyncingForm(null); }
  };


  const syncAllForms = async () => {
    setSyncingForm("__all__");
    try {
      // Registra como POSION todos os forms carregados que ainda não têm rota.
      if (leadForms.length > 0) {
        const entries = leadForms.map((f) => ({
          id: f.id, name: f.name,
          page_id: (f as any).page_id ?? null,
          page_name: (f as any).page_name ?? null,
        }));
        const registered = await ensureRoutingRules(entries);
        if (registered > 0) {
          toast({ title: `${registered} formulário(s) registrado(s) como POSION` });
          await loadRules();
        }
      }
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

  // Backfill Página nas regras antigas assim que os forms forem carregados,
  // para que cada vínculo Formulário → Cliente registre também de qual Página do BM veio.
  useEffect(() => {
    if (leadForms.length === 0 || rules.length === 0) return;
    (async () => {
      const byForm = new Map(leadForms.map((f) => [f.id, f]));
      const missing = rules.filter(
        (r) => r.active && r.match_type === "form_id" && !(r as any).page_id && byForm.has(r.match_value),
      );
      if (missing.length === 0) return;
      await Promise.all(missing.map((r) => {
        const f = byForm.get(r.match_value)!;
        return supabase.from("lead_routing_rules")
          .update({ page_id: f.page_id ?? null, page_name: f.page_name ?? null } as any)
          .eq("id", r.id);
      }));
      loadRules();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadForms, rules.length]);


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

  // ===== Gestão de eficiência =====
  const campaignStatus = (c: MetaCampaign): { level: "ok"|"warn"|"critical"; reasons: string[]; cpl: number; cpr: number } => {
    const i = c.insights;
    const key = c.name.trim().toLowerCase();
    const crmComp = crmCompByCampaign[key] || 0;
    const cpl = i && i.leads ? i.spend / i.leads : 0;
    const cpr = i && crmComp ? i.spend / crmComp : 0;
    const reasons: string[] = [];
    const critCplGate = thresholds.cplTarget * (1 + thresholds.alertMarginPct / 100);
    const warnCplGate = thresholds.cplTarget;
    let level: "ok"|"warn"|"critical" = "ok";
    if (cpl > 0 && cpl > critCplGate) { level = "critical"; reasons.push(`CPL ${BRL(cpl)} > ${BRL(critCplGate)} (meta+${thresholds.alertMarginPct}%)`); }
    else if (cpl > 0 && cpl > warnCplGate) { level = "warn"; reasons.push(`CPL ${BRL(cpl)} > meta ${BRL(warnCplGate)}`); }
    if (cpr > 0 && cpr > thresholds.cprLimit) {
      level = "critical";
      reasons.push(`Custo/Reunião ${BRL(cpr)} > limite ${BRL(thresholds.cprLimit)}`);
    }
    // Sem leads mas com gasto relevante = warn
    if ((i?.spend || 0) > thresholds.cplTarget * 3 && (i?.leads || 0) === 0) {
      level = level === "critical" ? "critical" : "warn";
      reasons.push(`Gasto ${BRL(i!.spend)} sem leads`);
    }
    return { level, reasons, cpl, cpr };
  };

  const criticalCount = useMemo(() => metaCampaigns.filter((c) => c.effective_status === "ACTIVE" && campaignStatus(c).level === "critical").length, [metaCampaigns, thresholds, crmCompByCampaign]);
  const warnCount = useMemo(() => metaCampaigns.filter((c) => c.effective_status === "ACTIVE" && campaignStatus(c).level === "warn").length, [metaCampaigns, thresholds, crmCompByCampaign]);

  const toggleSelect = (id: string) => setSelectedIds((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });
  const selectAllCritical = () => {
    const ids = metaCampaigns.filter((c) => c.effective_status === "ACTIVE" && campaignStatus(c).level === "critical").map((c) => c.id);
    setSelectedIds(new Set(ids));
  };
  const clearSelection = () => setSelectedIds(new Set());

  const bulkPause = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Pausar ${selectedIds.size} campanha(s) selecionada(s)?`)) return;
    setBulkPausing(true);
    let ok = 0, fail = 0;
    for (const id of Array.from(selectedIds)) {
      try {
        const { data, error } = await supabase.functions.invoke("facebook-ads-manage", {
          body: { action: "set_status", object_id: id, status: "PAUSED" },
        });
        if (error || data?.error) throw new Error(error?.message || data?.error);
        ok++;
      } catch { fail++; }
    }
    setBulkPausing(false);
    setSelectedIds(new Set());
    toast({ title: `Pausadas: ${ok}${fail ? ` · Falhas: ${fail}` : ""}`, variant: fail ? "destructive" : "default" });
    loadMetaCampaigns();
  };

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
          <KpiTile label="Clínicas interessadas" value={NUM(kpis.leads)} />
          <KpiTile label="Custo/Clínica" value={kpis.cpl != null ? BRL(kpis.cpl) : "—"} />
          <KpiTile label="ROAS" value={kpis.roas != null ? `${kpis.roas.toFixed(2)}x` : "—"} accentSoft />
          <KpiTile label="Receita contratos (CRM)" value={BRL(kpis.crmRevenue)} accent />
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
                      ? `${leadForms.filter((f) => formTenantMap.has(f.id)).length} de ${leadForms.length} vinculado(s) · ${leadPages.length} página(s) verificadas${lastLeadsSync ? ` · última sync ${new Date(lastLeadsSync).toLocaleTimeString("pt-BR")}` : ""}`
                      : "Varre todas as Páginas do Business Manager acessíveis"}
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

              {formsStale && (
                <div className="text-[11px] text-sky-300/90 bg-sky-500/5 border border-sky-500/20 rounded px-3 py-2 mb-2">
                  <span className="font-semibold uppercase tracking-wider mr-2">Cache</span>
                  Mostrando última listagem bem-sucedida de{" "}
                  <b>{new Date(formsStale.since).toLocaleString("pt-BR")}</b>
                  {formsStale.rateLimited ? " — Meta retornou rate limit (#4). Tente novamente em ~1h." : " — atualização atual falhou parcialmente."}
                </div>
              )}

              {leadFormErrors.length > 0 && (
                <div className="text-[10px] text-amber-500/80 bg-amber-500/5 border border-amber-500/10 rounded px-3 py-2 mb-2">
                  <div className="font-semibold uppercase tracking-wider mb-1">Páginas com falha ({leadFormErrors.length})</div>
                  <ul className="space-y-0.5">
                    {leadFormErrors.slice(0, 6).map((e) => (
                      <li key={e.page_id}>· {e.page_name}: <span className="text-amber-400/70">{e.error}</span></li>
                    ))}
                  </ul>
                </div>
              )}

              {!formsError && leadForms.length === 0 && !loadingForms && (
                <div className="text-[11px] text-slate-500 italic px-2 py-3">
                  Clique em "Atualizar lista" para varrer todas as Páginas do Business Manager acessíveis.
                </div>
              )}

              {leadForms.length > 0 && (() => {
                const groups = new Map<string, LeadForm[]>();
                for (const f of leadForms) {
                  const key = f.page_name ?? "Sem página";
                  if (!groups.has(key)) groups.set(key, []);
                  groups.get(key)!.push(f);
                }
                const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
                return (
                  <div className="space-y-3">
                    {sorted.map(([pageName, forms]) => {
                      const linkedCount = forms.filter((f) => formTenantMap.has(f.id)).length;
                      const pageKey = `page:${pageName}`;
                      const linkedFormIds = forms.filter((f) => formTenantMap.has(f.id)).map((f) => f.id);
                      return (
                        <details key={pageName} className="group/pg border border-white/5 rounded-lg overflow-hidden bg-white/[0.01]" open={linkedCount > 0}>
                          <summary className="list-none cursor-pointer flex items-center justify-between px-3 py-2 bg-white/[0.02] border-b border-white/5 hover:bg-white/[0.04]">
                            <div className="flex items-center gap-2 min-w-0">
                              <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0 -rotate-90 group-open/pg:rotate-0 transition-transform" />
                              <div className="text-[11px] font-semibold text-slate-300 tracking-wide truncate">
                                {pageName}
                                <span className="ml-2 text-[10px] text-slate-500 font-normal">
                                  {forms.length} formulário(s) · <span className={linkedCount > 0 ? "text-emerald-400" : ""}>{linkedCount} vinculado(s)</span>
                                </span>
                              </div>
                            </div>
                            {linkedFormIds.length > 0 && (
                              <Button
                                size="sm" variant="ghost"
                                onClick={(e) => { e.preventDefault(); syncPageForms(pageName, linkedFormIds); }}
                                disabled={syncingForm === pageKey}
                                className="h-6 text-[10px] text-[#C9A84C] hover:bg-[#C9A84C]/10 shrink-0"
                              >
                                {syncingForm === pageKey ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <RefreshCw className="w-3 h-3 mr-1" />}
                                IMPORTAR HISTÓRICO
                              </Button>
                            )}
                          </summary>
                          <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-slate-500 border-b border-white/5 text-left">
                                  <th className="py-2 pl-3 font-medium">FORMULÁRIO</th>
                                  <th className="py-2 font-medium">ID</th>
                                  <th className="py-2 font-medium text-right">LEADS</th>
                                  <th className="py-2 font-medium">CLIENTE VINCULADO</th>
                                  <th className="py-2 pr-3 font-medium text-right">AÇÃO</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-white/5">
                                {forms.map((f) => {
                                  const linked = formTenantMap.get(f.id) ?? "__none__";
                                  const linkedName = linked !== "__none__" ? tenants.find((t) => t.id === linked)?.name : null;
                                  return (
                                    <tr key={f.id}>
                                      <td className="py-3 pl-3 text-white">
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
                                          onValueChange={(v) => bindFormToTenant(f.id, f.name, v, f.page_id ?? null, f.page_name ?? pageName ?? null)}
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
                                      <td className="py-3 pr-3 text-right">
                                        <Button size="sm" variant="ghost" onClick={() => syncFormNow(f.id, f.name, 2000)}
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
                        </details>
                      );
                    })}
                  </div>
                );
              })()}

            </div>

          </div>
        </details>

        {/* Campaigns — Card Grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1 flex-wrap gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-500 tracking-widest uppercase">Performance de Campanhas</h3>
              <p className="text-[10px] text-slate-600 mt-0.5">Gestão global · ordenado por investimento</p>
            </div>
            <div className="flex items-center gap-2 text-[10px]">
              <span className="px-2 py-1 rounded-md bg-rose-500/10 border border-rose-500/30 text-rose-400 font-bold uppercase tracking-widest">
                <AlertTriangle className="w-3 h-3 inline mr-1" />{criticalCount} pausar
              </span>
              <span className="px-2 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold uppercase tracking-widest">
                {warnCount} atenção
              </span>
              <span className="text-slate-600 uppercase tabular-nums">{loadingCampaigns ? "Carregando…" : `${visibleCampaigns.length} total`}</span>
            </div>
          </div>

          {/* Barra de eficiência */}
          <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-[#0A0A0A] border border-white/5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Filtro</span>
            <div className="flex items-center rounded-md border border-white/10 overflow-hidden">
              {(["all","critical","warn","ok"] as const).map((k) => (
                <button key={k} onClick={() => setStatusFilter(k)}
                  className={`px-2.5 h-7 text-[10px] font-bold uppercase tracking-widest transition ${statusFilter === k ? "bg-[#C9A84C]/20 text-[#F0D78C]" : "text-slate-500 hover:text-slate-300"}`}>
                  {k === "all" ? "Todas" : k === "critical" ? "Pausar" : k === "warn" ? "Atenção" : "OK"}
                </button>
              ))}
            </div>
            <div className="h-5 w-px bg-white/10" />
            <Button size="sm" variant="ghost" onClick={() => setThresholdDialog(true)}
              className="h-7 px-2 text-[10px] text-slate-400 hover:text-white">
              <Settings className="w-3 h-3 mr-1" /> Limites de eficiência
            </Button>
            <Button size="sm" variant="ghost" onClick={selectAllCritical}
              className="h-7 px-2 text-[10px] text-rose-400 hover:text-rose-300 hover:bg-rose-500/10">
              <CheckSquare className="w-3 h-3 mr-1" /> Selecionar críticas ({criticalCount})
            </Button>
            <div className="ml-auto flex items-center gap-2">
              {selectedIds.size > 0 && (
                <>
                  <span className="text-[10px] text-slate-400 tabular-nums">{selectedIds.size} selecionada(s)</span>
                  <Button size="sm" variant="ghost" onClick={clearSelection} className="h-7 px-2 text-[10px] text-slate-500 hover:text-white">
                    Limpar
                  </Button>
                  <Button size="sm" onClick={bulkPause} disabled={bulkPausing}
                    className="h-7 px-3 bg-rose-500 hover:bg-rose-600 text-white text-[10px] font-bold uppercase tracking-widest">
                    {bulkPausing ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : <Pause className="w-3 h-3 mr-1" />}
                    Pausar em massa
                  </Button>
                </>
              )}
            </div>
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

          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {[...visibleCampaigns].sort((a, b) => (b.insights?.spend || 0) - (a.insights?.spend || 0)).map((c) => {
              const i = c.insights;
              const key = c.name.trim().toLowerCase();
              const crmWins = crmWinsByCampaign[key] || 0;
              const crmRev = crmRevenueByCampaign[key] || 0;
              const crmAppts = crmApptsByCampaign[key] || 0;
              const crmComp = crmCompByCampaign[key] || 0;
              const wonList = wonLeadsByCampaign[key] || [];
              const isActive = c.effective_status === "ACTIVE";
              const dailyBudgetR = c.daily_budget ? Number(c.daily_budget) / 100 : null;
              const roas = i && i.spend ? ((i.purchase_value + crmRev) / i.spend) : 0;
              const cpl = i && i.leads ? i.spend / i.leads : 0;
              const cpr = i && crmComp ? i.spend / crmComp : 0;

              return (
                <div key={c.id}
                  className={`relative bg-gradient-to-br from-[#0B0B0B] to-[#080808] border rounded-2xl overflow-hidden transition-all group
                    ${isActive ? "border-white/5 hover:border-[#C9A84C]/40 hover:shadow-[0_0_40px_-10px_rgba(201,168,76,0.35)]" : "border-white/[0.03] opacity-70 hover:opacity-100"}`}>
                  {/* Status strip */}
                  <div className={`absolute top-0 left-0 right-0 h-[2px] ${isActive ? "bg-gradient-to-r from-emerald-500/0 via-emerald-500 to-emerald-500/0" : "bg-slate-800"}`} />

                  {/* Header */}
                  <div className="p-4 pb-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]" : "bg-slate-700"}`} />
                        <span className={`text-[9px] uppercase tracking-widest font-bold ${isActive ? "text-emerald-500" : "text-slate-600"}`}>
                          {isActive ? "AO VIVO" : (c.effective_status || c.status)}
                        </span>
                      </div>
                      <span className="text-[9px] font-mono text-slate-600 truncate max-w-[110px]" title={c.id}>{c.id}</span>
                    </div>
                    <h4 className={`font-serif text-[15px] leading-tight ${isActive ? "text-white group-hover:text-[#F0D78C]" : "text-slate-400"} transition-colors line-clamp-2`}
                      title={c.name}>
                      {c.name}
                    </h4>
                    <p className="text-[10px] text-slate-600 mt-1 truncate">
                      {c.objective || "—"}{dailyBudgetR ? ` · ${BRL(dailyBudgetR)}/dia` : ""}
                    </p>
                  </div>

                  {/* Big numbers strip */}
                  <div className="grid grid-cols-2 border-y border-white/5 divide-x divide-white/5">
                    <div className="p-3">
                      <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">Investido</div>
                      <div className="text-lg font-serif text-white tabular-nums mt-0.5">{BRL(i?.spend || 0)}</div>
                    </div>
                    <div className="p-3">
                      <div className="text-[9px] text-[#C9A84C] uppercase tracking-widest font-bold flex items-center gap-1">
                        <Crown className="w-2.5 h-2.5" /> Contratos fechados
                      </div>
                      <div className="text-lg font-serif text-[#C9A84C] tabular-nums mt-0.5">{BRL(crmRev)}</div>
                    </div>
                  </div>

                  {/* Micro metrics */}
                  <div className="grid grid-cols-6 divide-x divide-white/5 border-b border-white/5 text-center">
                    <MicroMetric label="Clínicas" value={NUM(i?.leads || 0)} />
                    <MicroMetric label="Reuniões" value={NUM(crmAppts)} highlight={crmAppts > 0} />
                    <MicroMetric label="Custo/Clínica" value={cpl ? BRL(cpl) : "—"} />
                    <MicroMetric label="Custo/Reunião" value={cpr ? BRL(cpr) : "—"} highlight={cpr > 0} />
                    <MicroMetric label="CTR" value={i ? `${(i.ctr || 0).toFixed(1)}%` : "—"} />
                    <MicroMetric label="ROAS" value={roas ? `${roas.toFixed(1)}x` : "—"}
                      highlight={roas >= 2} />
                  </div>

                  {/* Wins pills */}
                  {wonList.length > 0 && (
                    <div className="px-4 py-2.5 flex flex-wrap gap-1 border-b border-white/5 bg-[#C9A84C]/[0.02]">
                      {wonList.slice(0, 3).map((w, idx) => (
                        <span key={idx} className="text-[9px] px-1.5 py-0.5 rounded bg-[#C9A84C]/10 text-[#F0D78C] border border-[#C9A84C]/20 truncate max-w-[140px]">
                          {w.name} · {BRL(w.valor)}
                        </span>
                      ))}
                      {wonList.length > 3 && (
                        <span className="text-[9px] px-1.5 py-0.5 text-slate-500">+{wonList.length - 3}</span>
                      )}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="p-3 flex items-center justify-between gap-1">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost"
                        onClick={() => setBudgetDialog({ open: true, id: c.id, name: c.name, current: c.daily_budget })}
                        className="h-6 px-2 text-[9px] text-slate-400 hover:text-white hover:bg-white/5">
                        <Wallet className="w-3 h-3 mr-1" /> ORÇ.
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleCampaignStatus(c)} disabled={togglingCampaign === c.id}
                        className="h-6 px-2 text-[9px] text-slate-400 hover:text-white hover:bg-white/5">
                        {togglingCampaign === c.id ? <Loader2 className="w-3 h-3 animate-spin" /> :
                          isActive ? <Pause className="w-3 h-3 mr-1" /> : <Play className="w-3 h-3 mr-1" />}
                        {isActive ? "PAUSAR" : "ATIVAR"}
                      </Button>
                    </div>
                    <a href={`https://www.facebook.com/adsmanager/manage/campaigns?act=${(c as any).account_id || (adAccountFilter !== "all" ? adAccountFilter : adAccountId || "").replace("act_", "")}&selected_campaign_ids=${c.id}`}
                      target="_blank" rel="noopener noreferrer"
                      className="text-[9px] font-bold text-[#C9A84C] uppercase tracking-widest border border-[#C9A84C]/20 px-2 py-1 rounded hover:bg-[#C9A84C] hover:text-[#050505] transition-all flex items-center gap-1">
                      <ExternalLink className="w-2.5 h-2.5" /> Meta
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
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

function MicroMetric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="py-2.5">
      <div className="text-[9px] text-slate-600 uppercase tracking-widest font-bold">{label}</div>
      <div className={`text-[13px] font-semibold tabular-nums mt-0.5 ${highlight ? "text-emerald-400" : "text-slate-200"}`}>{value}</div>
    </div>
  );
}
