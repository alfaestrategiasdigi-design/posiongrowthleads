import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Accordion, AccordionItem, AccordionTrigger, AccordionContent,
} from "@/components/ui/accordion";
import {
  Loader2, Facebook, Copy, RefreshCw, CheckCircle2,
  Upload, FileSpreadsheet, Users, ExternalLink, Zap,
  AlertCircle, KeyRound, Eye, EyeOff, LogIn, Unplug,
  Download, Bug, Settings2, Target,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const WEBHOOK_URL = `https://${projectId}.supabase.co/functions/v1/facebook-leads-webhook`;
const FB_SCOPES = "leads_retrieval,pages_show_list,pages_manage_metadata,pages_read_engagement,ads_read,ads_management,business_management";

// ---- Facebook JS SDK loader ----
let fbSdkPromise: Promise<any> | null = null;
function loadFbSdk(appId: string): Promise<any> {
  if (fbSdkPromise) return fbSdkPromise;
  fbSdkPromise = new Promise((resolve, reject) => {
    if ((window as any).FB) {
      try { (window as any).FB.init({ appId, cookie: false, xfbml: false, version: "v21.0" }); } catch {}
      return resolve((window as any).FB);
    }
    (window as any).fbAsyncInit = function () {
      (window as any).FB.init({ appId, cookie: false, xfbml: false, version: "v21.0" });
      resolve((window as any).FB);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true; s.defer = true; s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Falha ao carregar Facebook SDK"));
    document.body.appendChild(s);
  });
  return fbSdkPromise;
}

/* =====================================================================
   CSV PARSER (UTF-16 LE + TAB, formato exportado pelo Meta Ads Manager)
   ===================================================================== */

type ParsedRow = Record<string, string>;

function parseMetaCsv(buf: ArrayBuffer): ParsedRow[] {
  // Tenta UTF-16 LE; cai pra UTF-8 se vier ASCII puro
  const bytes = new Uint8Array(buf);
  const isUtf16 = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
  const text = new TextDecoder(isUtf16 ? "utf-16le" : "utf-8")
    .decode(buf)
    .replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const splitRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === sep && !inQ) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = splitRow(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const row: ParsedRow = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row;
  });
}

function normalizePhone(raw: string): string {
  return (raw || "").replace(/^p:\+?/i, "").replace(/\D/g, "");
}

function rowToLead(row: ParsedRow) {
  const observacoesParts: string[] = [];
  const ig = row["qual_o_@_do_seu_instagram?"];
  const trafego = row["já_investiu_em_tráfego_pago?"];
  if (ig) observacoesParts.push(`Instagram: ${ig}`);
  if (trafego) observacoesParts.push(`Tráfego: ${trafego}`);

  return {
    nome_completo: row["full_name"] || row["nome"] || "Lead Facebook Ads",
    whatsapp: normalizePhone(row["phone_number"] || row["whatsapp"] || ""),
    email: row["email"] || null,
    nome_empresa: row["company_name"] || null,
    especialidade: row["você_já_realiza_cirurgias_de_transplante_capilar?"] || null,
    faturamento_mensal: row["qual_o_faturamento_médio_mensal_da_sua_clínica_hoje?"] || null,
    status: "novo",
    origem: "facebook_ads",
    revendedor_iniciante: false,
    facebook_lead_id: row["id"] || null,
    facebook_form_id: row["form_id"] || null,
    facebook_form_name: row["form_name"] || null,
    facebook_campaign: row["campaign_name"] || row["campaign_id"] || null,
    facebook_ad_name: row["ad_name"] || null,
    facebook_adset_name: row["adset_name"] || null,
    utm_source: "facebook",
    utm_medium: "lead_ads",
    utm_campaign: row["campaign_name"] || null,
    observacoes: observacoesParts.join(" | ") || null,
  };
}

/* =====================================================================
   ABA 1 — Configuração (Credenciais Meta + Webhook + Validação)
   ===================================================================== */

type ConfigMeta = {
  id: string;
  verify_token: string;
  page_id: string | null;
  app_id: string | null;
  connected_page_name: string | null;
  token_expires_at: string | null;
  ad_account_id: string | null;
  default_tenant_id: string | null;
  last_campaigns_sync_at: string | null;
  last_leads_sync_at: string | null;
  has_page_access_token: boolean;
  has_app_secret: boolean;
  last_validated_at: string | null;
  last_validation_result: any;
  updated_at: string;
};

type FbPage = { id: string; name: string; access_token: string; category: string | null; tasks: string[] };

type ValidationStep = {
  id: string;
  label: string;
  ok: boolean;
  level: "ok" | "warn" | "error";
  message: string;
  detail?: any;
};

function StepRow({ step }: { step: ValidationStep }) {
  const color =
    step.level === "ok" ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/5"
    : step.level === "warn" ? "text-amber-300 border-amber-500/30 bg-amber-500/5"
    : "text-red-400 border-red-500/30 bg-red-500/5";
  const Icon = step.level === "error" ? AlertCircle : step.level === "warn" ? AlertCircle : CheckCircle2;
  return (
    <div className={`rounded-lg border p-3 text-sm ${color}`}>
      <div className="flex items-start gap-2">
        <Icon className="w-4 h-4 mt-0.5 shrink-0" />
        <div className="flex-1">
          <div className="font-medium">{step.label}</div>
          <div className="text-xs opacity-80 mt-0.5">{step.message}</div>
          {step.id === "forms" && Array.isArray(step.detail) && step.detail.length > 0 && (
            <ul className="text-xs opacity-80 mt-2 space-y-0.5">
              {step.detail.slice(0, 8).map((f: any) => (
                <li key={f.id}>• <span className="font-medium">{f.name}</span> · <span className="font-mono opacity-60">{f.id}</span> · {f.status} · {f.leads_count ?? 0} leads</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfigTab() {
  const [meta, setMeta] = useState<ConfigMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [steps, setSteps] = useState<ValidationStep[] | null>(null);

  // form inputs
  const [verifyToken, setVerifyToken] = useState("");
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [adAccountId, setAdAccountId] = useState("");
  const [defaultTenantId, setDefaultTenantId] = useState<string>("");
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [syncingCamp, setSyncingCamp] = useState(false);

  // page picker
  const [pages, setPages] = useState<FbPage[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingPage, setSavingPage] = useState<string | null>(null);

  const loadMeta = async () => {
    const [{ data }, { data: ts }] = await Promise.all([
      supabase.rpc("get_facebook_config_meta" as any),
      supabase.from("tenants").select("id, name").order("name"),
    ]);
    const row: any = Array.isArray(data) ? data[0] : data;
    if (row) {
      setMeta(row as ConfigMeta);
      setVerifyToken(row.verify_token ?? "");
      setAppId(row.app_id ?? "");
      setAdAccountId(row.ad_account_id ?? "");
      setDefaultTenantId(row.default_tenant_id ?? "");
      if (row.last_validation_result) setSteps(row.last_validation_result as ValidationStep[]);
    }
    if (ts) setTenants(ts as any);
    setLoading(false);
  };

  useEffect(() => { loadMeta(); }, []);

  const generateToken = () => {
    const t = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    setVerifyToken(t);
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  const saveCredentials = async () => {
    if (verifyToken && verifyToken.length < 12) {
      toast.error("Verify Token precisa ter pelo menos 12 caracteres");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      if (verifyToken) payload.verify_token = verifyToken;
      if (appId.trim()) payload.app_id = appId.trim();
      if (appSecret) payload.app_secret = appSecret;
      if (adAccountId.trim()) payload.ad_account_id = adAccountId.trim();
      payload.default_tenant_id = defaultTenantId || null;

      const { error } = await supabase.functions.invoke("facebook-config-save", { body: payload });
      if (error) throw error;
      toast.success("Credenciais salvas");
      setAppSecret("");
      await loadMeta();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  };

  const syncCampaigns = async () => {
    setSyncingCamp(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-campaigns-sync", { body: { days: 30 } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Sincronizado: ${data?.results?.length ?? 0} campanhas`);
      await loadMeta();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao sincronizar");
    } finally {
      setSyncingCamp(false);
    }
  };

  const handleFacebookLogin = async () => {
    if (!meta?.app_id) {
      toast.error("Salve primeiro o App ID e o App Secret");
      return;
    }
    setConnecting(true);
    try {
      const FB = await loadFbSdk(meta.app_id);
      const resp: any = await new Promise((resolve) => {
        FB.login(resolve, { scope: FB_SCOPES, return_scopes: true });
      });
      if (!resp?.authResponse?.accessToken) {
        toast.error("Login com Facebook cancelado ou negado");
        return;
      }
      const shortToken = resp.authResponse.accessToken;

      const { data, error } = await supabase.functions.invoke("facebook-oauth-exchange", {
        body: { short_lived_token: shortToken },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha no servidor");
      if (!data.pages?.length) {
        toast.error("Sua conta não administra nenhuma página. Crie/seja admin de uma página antes de conectar.");
        return;
      }
      setPages(data.pages);
      setPickerOpen(true);
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao conectar");
    } finally {
      setConnecting(false);
    }
  };

  const selectPage = async (page: FbPage) => {
    setSavingPage(page.id);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-oauth-save-page", {
        body: {
          page_id: page.id,
          page_name: page.name,
          page_access_token: page.access_token,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao salvar");
      if (data.subscribed) toast.success(`Conectado a ${page.name} · inscrição leadgen criada`);
      else toast.success(`Conectado a ${page.name}`, {
        description: data.subscribeError ? `Aviso: ${data.subscribeError}` : undefined,
      });
      setPickerOpen(false);
      setPages(null);
      await loadMeta();
    } catch (e: any) {
      toast.error(e.message ?? "Falha ao salvar página");
    } finally {
      setSavingPage(null);
    }
  };

  const disconnect = async () => {
    if (!confirm("Desconectar a página? O webhook deixará de receber leads até reconectar.")) return;
    try {
      const { error } = await supabase.functions.invoke("facebook-config-save", {
        body: { clear_page_access_token: true },
      });
      if (error) throw error;
      toast.success("Página desconectada");
      await loadMeta();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao desconectar");
    }
  };

  const runValidation = async () => {
    setValidating(true);
    setSteps(null);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-webhook-validate", { body: {} });
      if (error) throw error;
      setSteps(data.steps as ValidationStep[]);
      if (data.ok) toast.success("Webhook validado com sucesso");
      else toast.error("Encontramos problemas na validação — veja abaixo");
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao validar");
    } finally {
      setValidating(false);
    }
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;

  const isConnected = meta?.has_page_access_token && meta?.connected_page_name;
  const isPlaceholderAdAccount = !!meta?.ad_account_id && /^act_1234/.test(meta.ad_account_id);
  const adAccountOk = !!meta?.ad_account_id && !isPlaceholderAdAccount;
  const defaultTenantOk = !!defaultTenantId;

  return (
    <div className="space-y-6">
      {/* ============ SETUP RÁPIDO — 3 PASSOS ============ */}
      <div className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/10 via-card to-card p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Zap className="w-5 h-5 text-accent" /> Setup rápido
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Três passos. Depois os leads chegam sozinhos no Kanban com UTMs e a página de Campanhas mostra o investimento.
            </p>
          </div>
          {isConnected && adAccountOk && defaultTenantOk && (
            <div className="text-xs text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Tudo pronto
            </div>
          )}
        </div>

        {/* Passo 1 — Conectar */}
        <div className="rounded-lg border border-border/60 bg-background/40 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${isConnected ? "bg-emerald-500/20 text-emerald-400" : "bg-accent/20 text-accent"}`}>1</span>
              <span className="font-medium text-foreground text-sm">Conectar a página do Facebook</span>
            </div>
            {isConnected && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                ✓ {meta?.connected_page_name}
              </Badge>
            )}
          </div>
          {isConnected ? (
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleFacebookLogin} disabled={connecting}>
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                <span className="ml-2">Reconectar / Trocar página</span>
              </Button>
              <Button variant="outline" size="sm" onClick={disconnect} className="text-red-400 hover:text-red-300">
                <Unplug className="w-4 h-4 mr-1" /> Desconectar
              </Button>
            </div>
          ) : (
            <>
              <Button
                onClick={handleFacebookLogin}
                disabled={connecting || !meta?.app_id || !meta?.has_app_secret}
                className="bg-[#1877F2] hover:bg-[#1665d8] text-white"
              >
                {connecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
                <span className="ml-2">Conectar com Facebook</span>
              </Button>
              {(!meta?.app_id || !meta?.has_app_secret) && (
                <p className="text-xs text-amber-300 flex items-start gap-1">
                  <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Antes preencha o App ID + App Secret em "Configurações avançadas" abaixo.
                </p>
              )}
            </>
          )}
        </div>

        {/* Passo 2 — Ad Account */}
        <div className={`rounded-lg border p-4 space-y-3 ${adAccountOk ? "border-border/60 bg-background/40" : "border-amber-500/30 bg-amber-500/5"}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${adAccountOk ? "bg-emerald-500/20 text-emerald-400" : "bg-accent/20 text-accent"}`}>2</span>
              <span className="font-medium text-foreground text-sm">Conta de anúncios (Ad Account)</span>
            </div>
            {adAccountOk && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400 font-mono">
                {meta?.ad_account_id}
              </Badge>
            )}
          </div>
          {isPlaceholderAdAccount && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] text-amber-200 flex items-start gap-1.5">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              O Ad Account salvo é um placeholder (<code className="font-mono">{meta?.ad_account_id}</code>). É por isso que a página de <b>Campanhas</b> mostra "permissão ads_read ausente" — a chamada falha porque a conta não existe.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-2">
            <Input
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
              placeholder="act_1234567890123456"
              className="font-mono text-xs"
            />
            <Button onClick={saveCredentials} disabled={saving || !adAccountId.trim()} variant="outline" size="sm">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span className="ml-2">Salvar</span>
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Pegue em{" "}
            <a href="https://business.facebook.com/settings/ad-accounts" target="_blank" rel="noreferrer" className="text-accent underline">
              Business → Contas de anúncio
            </a>
            . Formato: <code className="font-mono bg-muted/50 px-1 rounded">act_</code> + ID numérico. <b>Não use placeholder.</b>
          </p>
        </div>

        {/* Passo 3 — Default tenant */}
        <div className={`rounded-lg border p-4 space-y-3 ${defaultTenantOk ? "border-border/60 bg-background/40" : "border-amber-500/30 bg-amber-500/5"}`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${defaultTenantOk ? "bg-emerald-500/20 text-emerald-400" : "bg-accent/20 text-accent"}`}>3</span>
              <span className="font-medium text-foreground text-sm">Clínica padrão para receber os leads</span>
            </div>
            {defaultTenantOk && (
              <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">
                {tenants.find(t => t.id === defaultTenantId)?.name ?? "definida"}
              </Badge>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-2">
            <select
              value={defaultTenantId}
              onChange={(e) => setDefaultTenantId(e.target.value)}
              className="w-full h-10 px-3 rounded-md bg-background border border-input text-xs"
            >
              <option value="">★ Admin Master (conta principal)</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <Button onClick={saveCredentials} disabled={saving} variant="outline" size="sm">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              <span className="ml-2">Salvar</span>
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Toda lead que chegar pelo webhook ou backfill vai para esta clínica e aparece no Kanban com UTMs preenchidos automaticamente.
          </p>
        </div>

        {/* Sync rápido */}
        {isConnected && adAccountOk && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
            <Button onClick={syncCampaigns} disabled={syncingCamp} className="gradient-accent" size="sm">
              {syncingCamp ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
              <span className="ml-2">Sincronizar campanhas agora</span>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/admin/campanhas">Ver Campanhas →</Link>
            </Button>
            {meta?.last_campaigns_sync_at && (
              <span className="text-[11px] text-muted-foreground">
                Última sync: {new Date(meta.last_campaigns_sync_at).toLocaleString("pt-BR")}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ============ CONFIGURAÇÕES AVANÇADAS ============ */}
      <Accordion type="single" collapsible className="bg-card border border-border/50 rounded-xl">
        <AccordionItem value="advanced" className="border-0">
          <AccordionTrigger className="px-6 hover:no-underline">
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Settings2 className="w-4 h-4 text-accent" />
              Configurações avançadas (App, Webhook, Validações, Backfill)
            </span>
          </AccordionTrigger>
          <AccordionContent className="px-6 pb-6">
            <div className="space-y-6">
              {/* Webhook URL */}
              <div className="bg-background/40 border border-border/40 rounded-lg p-4 space-y-3">
                <h3 className="font-semibold text-foreground text-sm">URL do Webhook (Callback)</h3>
                <p className="text-xs text-muted-foreground">Cole no painel Meta → App → Webhooks → Page → leadgen.</p>
                <div className="flex gap-2">
                  <Input readOnly value={WEBHOOK_URL} className="font-mono text-xs" />
                  <Button variant="outline" onClick={() => copy(WEBHOOK_URL, "URL")}><Copy className="w-4 h-4" /></Button>
                </div>
              </div>

              {/* Verify Token */}
              <div className="bg-background/40 border border-border/40 rounded-lg p-4 space-y-3">
                <h3 className="font-semibold text-foreground text-sm">Verify Token</h3>
                <div className="flex gap-2">
                  <Input value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} placeholder="cole ou gere..." className="font-mono text-xs" />
                  <Button variant="outline" onClick={generateToken}><RefreshCw className="w-4 h-4" /></Button>
                  <Button variant="outline" onClick={() => copy(verifyToken, "Verify Token")} disabled={!verifyToken}><Copy className="w-4 h-4" /></Button>
                </div>
                <Button onClick={saveCredentials} disabled={saving} size="sm" variant="outline">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span className="ml-2">Salvar</span>
                </Button>
              </div>

              {/* App ID + Secret */}
              <div className="bg-background/40 border border-border/40 rounded-lg p-4 space-y-3">
                <h3 className="font-semibold text-foreground text-sm flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-accent" /> Credenciais do App Meta
                </h3>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">App ID
                    {meta?.app_id && <Badge variant="outline" className="ml-2 text-[10px] border-emerald-500/40 text-emerald-400">{meta.app_id}</Badge>}
                  </label>
                  <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="ex: 1234567890123456" className="font-mono text-xs" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">App Secret
                    {meta?.has_app_secret && <Badge variant="outline" className="ml-2 text-[10px] border-emerald-500/40 text-emerald-400">salvo</Badge>}
                  </label>
                  <div className="flex gap-2">
                    <Input type={showSecret ? "text" : "password"} value={appSecret} onChange={(e) => setAppSecret(e.target.value)}
                      placeholder={meta?.has_app_secret ? "•••••••• (deixe vazio para manter)" : "cole o app secret"}
                      className="font-mono text-xs" autoComplete="off" />
                    <Button variant="outline" onClick={() => setShowSecret(s => !s)} type="button">
                      {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
                <Button onClick={saveCredentials} disabled={saving} className="gradient-accent" size="sm">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  <span className="ml-2">Salvar credenciais</span>
                </Button>
              </div>

              {/* Validação completa */}
              <div className="bg-background/40 border border-border/40 rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="font-semibold text-foreground text-sm">Validar webhook ponta-a-ponta</h3>
                    <p className="text-xs text-muted-foreground">6 checagens: token, handshake, permissões, formulários, app secret.</p>
                  </div>
                  <Button onClick={runValidation} disabled={validating} size="sm" className="gradient-accent">
                    {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    <span className="ml-2">Validar</span>
                  </Button>
                </div>
                {steps && <div className="space-y-2">{steps.map((s) => <StepRow key={s.id} step={s} />)}</div>}
              </div>

              {/* Backfill, Validation Block, Debug */}
              <BackfillAndDebugBlock />

              {/* Guia */}
              <div className="bg-accent/5 border border-accent/20 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold text-foreground text-sm">Setup do App Meta (uma vez)</h3>
                <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
                  <li>Em <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-accent underline">developers.facebook.com/apps</a>, App tipo <b>Business</b>.</li>
                  <li>App settings → Basic: copie App ID + App Secret.</li>
                  <li>Facebook Login → Web — adicione em Valid OAuth Redirect URIs: <code className="bg-muted px-1 rounded">{typeof window !== "undefined" ? window.location.origin : ""}/</code></li>
                  <li>Webhooks → Page → assine <code className="bg-muted px-1 rounded">leadgen</code> com a URL e Verify Token acima.</li>
                  <li>App Review: solicite <code className="bg-muted px-1 rounded">leads_retrieval</code>, <code className="bg-muted px-1 rounded">pages_show_list</code>, <code className="bg-muted px-1 rounded">pages_manage_metadata</code>, <code className="bg-muted px-1 rounded">ads_read</code>.</li>
                </ol>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      {/* Page picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escolha a página</DialogTitle>
            <DialogDescription>Página de negócios que receberá os leads.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {pages?.map((p) => (
              <button key={p.id} onClick={() => selectPage(p)} disabled={!!savingPage}
                className="w-full text-left rounded-lg border border-border/50 hover:border-accent/50 bg-card hover:bg-accent/5 p-3 transition disabled:opacity-50">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.category ?? "—"} · <span className="font-mono">{p.id}</span></div>
                  </div>
                  {savingPage === p.id ? <Loader2 className="w-4 h-4 animate-spin text-accent" /> : <CheckCircle2 className="w-4 h-4 text-muted-foreground" />}
                </div>
              </button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)} disabled={!!savingPage}>Cancelar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* =====================================================================
   Backfill (importação retroativa via Graph API) + Debug endpoint
   ===================================================================== */

function BackfillAndDebugBlock() {
  const [formIds, setFormIds] = useState("");
  const [maxPerForm, setMaxPerForm] = useState("200");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debug, setDebug] = useState<any>(null);

  const runBackfill = async () => {
    setRunning(true);
    setResult(null);
    try {
      const ids = formIds.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
      const { data, error } = await supabase.functions.invoke("facebook-backfill-leads", {
        body: { form_ids: ids, max_per_form: Number(maxPerForm) || 200 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha");
      setResult(data);
      toast.success(`Importação concluída: ${data.totals.imported} novos · ${data.totals.deduped} duplicados · ${data.totals.failed} falhas`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro na importação");
    } finally {
      setRunning(false);
    }
  };

  const runDebug = async () => {
    setDebugLoading(true);
    setDebug(null);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-debug", { body: {} });
      if (error) throw error;
      setDebug(data);
    } catch (e: any) {
      toast.error(e.message ?? "Erro no debug");
    } finally {
      setDebugLoading(false);
    }
  };

  return (
    <>
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Download className="w-4 h-4 text-accent" /> 6. Importação retroativa (Graph API)
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Busca leads <b>já existentes</b> nos formulários da página via Graph API e insere no banco
            (duplicados ignorados pelo <code>facebook_lead_id</code>). Deixe IDs em branco para importar de todos os formulários.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[1fr,160px] gap-2">
          <Input
            value={formIds}
            onChange={(e) => setFormIds(e.target.value)}
            placeholder="IDs separados por vírgula (ex: 1858043458199562) — vazio = todos"
            className="font-mono text-xs"
          />
          <Input
            value={maxPerForm}
            onChange={(e) => setMaxPerForm(e.target.value)}
            type="number"
            placeholder="máx por form"
            className="text-xs"
          />
        </div>
        <Button onClick={runBackfill} disabled={running} className="gradient-accent">
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span className="ml-2">Importar leads existentes</span>
        </Button>

        {result && (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-2">
            <div className="font-semibold text-emerald-300">
              Total: {result.totals.fetched} buscados · {result.totals.imported} novos · {result.totals.deduped} duplicados · {result.totals.failed} falhas
            </div>
            <ul className="space-y-1 text-muted-foreground">
              {result.by_form.map((f: any) => (
                <li key={f.form_id}>
                  • <b className="text-foreground">{f.form_name ?? f.form_id}</b> ({f.form_id}) — buscados: {f.fetched}, novos: {f.imported}, duplicados: {f.deduped}, falhas: {f.failed}
                  {f.error && <span className="text-red-400"> · erro: {f.error}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <MetaValidationBlock />

      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">

        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Bug className="w-4 h-4 text-accent" /> 7. Diagnóstico (token, banco, subscriptions)
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Mostra status do token, conexão com o banco, último lead salvo, inscrições da Meta na página
              e contagem de leads por formulário direto da Graph API.
            </p>
          </div>
          <Button onClick={runDebug} disabled={debugLoading} variant="outline">
            {debugLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bug className="w-4 h-4" />}
            <span className="ml-2">Rodar diagnóstico</span>
          </Button>
        </div>

        {debug && (
          <pre className="bg-muted/30 border border-border/40 rounded-lg p-3 text-[10px] overflow-x-auto max-h-96 font-mono">
            {JSON.stringify(debug, null, 2)}
          </pre>
        )}
      </div>
    </>
  );
}

/* =====================================================================
   Bloco — Validação Meta (permissões + inscrição + últimos eventos)
   ===================================================================== */

type PermRow = { permission: string; status: string; granted: boolean };
type WebhookEvent = {
  id: string;
  received_at: string;
  signature_valid: boolean | null;
  leadgen_id: string | null;
  form_id: string | null;
  page_id: string | null;
  processed: boolean;
  lead_id: string | null;
  error: string | null;
};

function MetaValidationBlock() {
  const [permLoading, setPermLoading] = useState(false);
  const [perms, setPerms] = useState<PermRow[] | null>(null);
  const [subLoading, setSubLoading] = useState(false);
  const [sub, setSub] = useState<any>(null);
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [evLoading, setEvLoading] = useState(false);

  const checkPerms = async () => {
    setPermLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-permissions-check", { body: {} });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha");
      setPerms(data.permissions);
      if (data.all_granted) toast.success("Todas as permissões concedidas");
      else toast.warning(`Faltam: ${data.missing.join(", ")}`);
    } catch (e: any) { toast.error(e.message ?? "Erro"); }
    finally { setPermLoading(false); }
  };

  const checkSub = async (action: "check" | "resubscribe" = "check") => {
    setSubLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-page-subscription-check", { body: { action } });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha");
      setSub(data);
      if (action === "resubscribe") toast.success("Reinscrição enviada");
    } catch (e: any) { toast.error(e.message ?? "Erro"); }
    finally { setSubLoading(false); }
  };

  const loadEvents = async () => {
    setEvLoading(true);
    const { data } = await supabase.from("facebook_webhook_events" as any)
      .select("id, received_at, signature_valid, leadgen_id, form_id, page_id, processed, lead_id, error")
      .order("received_at", { ascending: false }).limit(50);
    setEvents((data as any) ?? []);
    setEvLoading(false);
  };

  useEffect(() => { loadEvents(); }, []);

  return (
    <>
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-accent" /> 6b. Permissões da Meta no token
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              O guia oficial de Webhooks para Lead Ads exige 6 permissões. Se alguma estiver faltando, reconecte no Passo 4.
            </p>
          </div>
          <Button onClick={checkPerms} disabled={permLoading} variant="outline">
            {permLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-2">Revalidar</span>
          </Button>
        </div>
        {perms && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {perms.map((p) => (
              <li key={p.permission} className={`flex items-center gap-2 rounded-lg border p-2 ${p.granted ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                {p.granted
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  : <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
                <span className="font-mono">{p.permission}</span>
                <span className="ml-auto text-muted-foreground">{p.status}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Zap className="w-4 h-4 text-accent" /> 6c. Inscrição do app na Página (leadgen)
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Confirma que nosso app está em <code>subscribed_apps</code> da Página. Sem isso, a Meta não envia eventos.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => checkSub("check")} disabled={subLoading} variant="outline">
              {subLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              <span className="ml-2">Verificar</span>
            </Button>
            <Button onClick={() => checkSub("resubscribe")} disabled={subLoading} className="gradient-accent">
              Reinscrever
            </Button>
          </div>
        </div>
        {sub && (
          <div className="text-xs space-y-2">
            <div className={`rounded-lg border p-2 ${sub.subscribed_to_leadgen ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-300" : "border-red-500/30 bg-red-500/5 text-red-300"}`}>
              {sub.subscribed_to_leadgen
                ? "✓ Página inscrita no campo leadgen"
                : "✗ Página NÃO inscrita em leadgen — clique em Reinscrever"}
            </div>
            <div className="text-muted-foreground">
              Apps inscritos ({sub.apps?.length ?? 0}):
              <ul className="mt-1 space-y-1">
                {(sub.apps ?? []).map((a: any) => (
                  <li key={a.id} className="font-mono">
                    • {a.name} <span className="text-muted-foreground">({a.id})</span>
                    {a.subscribed_fields?.length ? <span className="ml-2 text-emerald-400">[{a.subscribed_fields.join(", ")}]</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>

      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <Bug className="w-4 h-4 text-accent" /> 6d. Últimos eventos do Webhook (50)
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Auditoria de cada evento recebido da Meta — útil para diagnosticar leads que não chegaram.
            </p>
          </div>
          <Button onClick={loadEvents} disabled={evLoading} variant="outline">
            {evLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            <span className="ml-2">Recarregar</span>
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="p-2">Recebido</th>
                <th className="p-2">Sig</th>
                <th className="p-2">Leadgen ID</th>
                <th className="p-2">Form</th>
                <th className="p-2">Status</th>
                <th className="p-2">Lead / Erro</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr><td colSpan={6} className="p-4 text-center text-muted-foreground">Nenhum evento ainda</td></tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-t border-border/30">
                  <td className="p-2 whitespace-nowrap">{new Date(e.received_at).toLocaleString("pt-BR")}</td>
                  <td className="p-2">
                    {e.signature_valid === true ? <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      : e.signature_valid === false ? <AlertCircle className="w-3 h-3 text-red-400" />
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-2 font-mono">{e.leadgen_id ?? "—"}</td>
                  <td className="p-2 font-mono">{e.form_id ?? "—"}</td>
                  <td className="p-2">
                    {e.processed
                      ? <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30">OK</Badge>
                      : <Badge variant="outline" className="border-red-500/30 text-red-300">Falhou</Badge>}
                  </td>
                  <td className="p-2 text-muted-foreground max-w-[280px] truncate">
                    {e.lead_id ? <span className="font-mono">{e.lead_id}</span> : (e.error ?? "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/* =====================================================================
   ABA 2 — Importar CSV
   ===================================================================== */

type FbForm = { id: string; name: string; status?: string; leads_count?: number };

function MetaImportSection({ onImported }: { onImported: () => void }) {
  const [forms, setForms] = useState<FbForm[] | null>(null);
  const [loadingForms, setLoadingForms] = useState(false);
  const [formId, setFormId] = useState<string>("");
  const today = new Date();
  const thirtyAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const [fromDate, setFromDate] = useState(fmt(thirtyAgo));
  const [toDate, setToDate] = useState(fmt(today));
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);

  const loadForms = async () => {
    setLoadingForms(true);
    try {
      const { data, error } = await supabase.functions.invoke("facebook-leads-export-csv", {
        body: { action: "list_forms" },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setForms(data.forms ?? []);
      if (data.forms?.[0]?.id) setFormId(data.forms[0].id);
      toast.success(`${data.forms?.length ?? 0} formulários encontrados`);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao listar formulários");
    } finally {
      setLoadingForms(false);
    }
  };

  const runImport = async () => {
    if (!formId) { toast.error("Selecione um formulário"); return; }
    setImporting(true);
    setResult(null);
    try {
      const from = Math.floor(new Date(fromDate + "T00:00:00Z").getTime() / 1000);
      const to   = Math.floor(new Date(toDate   + "T23:59:59Z").getTime() / 1000);
      const { data, error } = await supabase.functions.invoke("facebook-leads-export-csv", {
        body: { action: "import", form_id: formId, from_date: from, to_date: to },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      toast.success(`${data.inserted} novos · ${data.deduped} já existiam · ${data.organic} orgânicos · ${data.errors} falhas`);
      onImported();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao importar");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-foreground flex items-center gap-2">
          <Download className="w-4 h-4 text-accent" /> Importar do Meta por período
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Usa o endpoint oficial <code className="text-[10px] bg-muted/40 px-1 rounded">/ads/lead_gen/export_csv</code> da Meta.
          Requer página conectada e permissão <b>leads_retrieval</b>. Duplicados (mesmo lead ID) são ignorados.
        </p>
      </div>

      {!forms && (
        <Button variant="outline" onClick={loadForms} disabled={loadingForms}>
          {loadingForms ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
          Carregar formulários da página
        </Button>
      )}

      {forms && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5 md:col-span-2">
            <label className="text-xs font-medium text-foreground">Formulário</label>
            <select
              value={formId}
              onChange={(e) => setFormId(e.target.value)}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground"
            >
              {forms.length === 0 && <option value="">Nenhum formulário encontrado</option>}
              {forms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.status ?? "?"} · {f.leads_count ?? 0} leads · {f.id}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">De</label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="text-xs" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">Até</label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="text-xs" />
          </div>
          <div className="md:col-span-2 flex gap-2">
            <Button onClick={runImport} disabled={importing || !formId} className="gradient-accent">
              {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Download className="w-4 h-4 mr-2" />}
              Importar leads do período
            </Button>
            <Button variant="outline" onClick={loadForms} disabled={loadingForms} title="Recarregar formulários">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs space-y-1">
          <div><b className="text-emerald-300">Concluído</b> · {result.total} linhas processadas</div>
          <div className="text-muted-foreground">
            {result.inserted} novos · {result.deduped} duplicados · {result.organic} orgânicos · {result.errors} falhas
          </div>
          {result.error_samples?.length > 0 && (
            <div className="text-amber-300 text-[10px] mt-1">Amostra de erros: {result.error_samples.join(" | ")}</div>
          )}
        </div>
      )}
    </div>
  );
}

function ImportTab({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; deduped: number; errors: number } | null>(null);



  const handleFile = async (file: File) => {
    setFileName(file.name);
    setResult(null);
    const buf = await file.arrayBuffer();
    const parsed = parseMetaCsv(buf);
    setRows(parsed);
    if (!parsed.length) toast.error("Não consegui ler nenhuma linha do CSV");
    else toast.success(`${parsed.length} linhas lidas`);
  };

  const handleImport = async () => {
    if (!rows.length) return;
    setImporting(true);
    let inserted = 0, deduped = 0, errors = 0;
    for (const row of rows) {
      const lead = rowToLead(row);
      if (lead.facebook_lead_id) {
        const { data: exist } = await supabase.from("leads")
          .select("id").eq("facebook_lead_id", lead.facebook_lead_id).maybeSingle();
        if (exist) { deduped++; continue; }
      }
      const { error } = await supabase.from("leads").insert(lead as any);
      if (error) { errors++; console.error(error); } else inserted++;
    }
    setImporting(false);
    setResult({ inserted, deduped, errors });
    toast.success(`${inserted} novos · ${deduped} já existiam · ${errors} falhas`);
    onImported();
  };

  const preview = rows.slice(0, 5);

  return (
    <div className="space-y-6">
      <MetaImportSection onImported={onImported} />

      <div className="rounded-xl border border-dashed border-border/60 bg-card/60 p-8 text-center">

        <FileSpreadsheet className="w-10 h-10 text-accent mx-auto mb-3" />
        <h3 className="font-semibold text-foreground">Importar leads do Facebook Ads Manager</h3>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Aceita o CSV exportado em <b>Gerenciador de Anúncios → Anúncios → Resultados → Baixar leads</b>.
          Formato UTF-16 TAB-separated da Meta. Duplicados (mesmo lead ID) são ignorados.
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <Button onClick={() => fileRef.current?.click()} className="gradient-accent">
          <Upload className="w-4 h-4 mr-2" /> Escolher CSV
        </Button>
        {fileName && <p className="text-xs text-muted-foreground mt-3">{fileName} · {rows.length} linhas</p>}
      </div>

      {preview.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
          <h4 className="text-sm font-semibold text-foreground">Preview (primeiras 5 linhas)</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="p-2">Nome</th><th className="p-2">WhatsApp</th><th className="p-2">Email</th>
                  <th className="p-2">Empresa</th><th className="p-2">Campanha</th><th className="p-2">Anúncio</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row, i) => {
                  const l = rowToLead(row);
                  return (
                    <tr key={i} className="border-t border-border/30">
                      <td className="p-2 text-foreground">{l.nome_completo}</td>
                      <td className="p-2">{l.whatsapp}</td>
                      <td className="p-2">{l.email}</td>
                      <td className="p-2">{l.nome_empresa}</td>
                      <td className="p-2 text-xs truncate max-w-[180px]">{l.facebook_campaign}</td>
                      <td className="p-2 text-xs truncate max-w-[180px]">{l.facebook_ad_name}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Button onClick={handleImport} disabled={importing} className="gradient-accent">
            {importing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Importar {rows.length} leads
          </Button>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <b className="text-emerald-300">Concluído.</b>{" "}
          <span className="text-muted-foreground">
            {result.inserted} novos · {result.deduped} já existiam · {result.errors} falharam
          </span>
        </div>
      )}
    </div>
  );
}

/* =====================================================================
   ABA 3 — Leads do Facebook
   ===================================================================== */

type FbLead = {
  id: string;
  nome_completo: string;
  whatsapp: string;
  email: string | null;
  status: string;
  created_at: string;
  facebook_campaign: string | null;
  facebook_ad_name: string | null;
  facebook_form_name: string | null;
};

function LeadsTab({ reloadKey }: { reloadKey: number }) {
  const [leads, setLeads] = useState<FbLead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    supabase.from("leads")
      .select("id, nome_completo, whatsapp, email, status, created_at, facebook_campaign, facebook_ad_name, facebook_form_name")
      .eq("origem", "facebook_ads")
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setLeads((data as FbLead[]) ?? []);
        setLoading(false);
      });
  }, [reloadKey]);

  const byCampaign = useMemo(() => {
    const map = new Map<string, number>();
    leads.forEach((l) => {
      const k = l.facebook_campaign || "(sem campanha)";
      map.set(k, (map.get(k) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [leads]);

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">Total de leads</div>
          <div className="text-2xl font-bold text-foreground">{leads.length}</div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">Hoje</div>
          <div className="text-2xl font-bold text-foreground">
            {leads.filter(l => new Date(l.created_at).toDateString() === new Date().toDateString()).length}
          </div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">Campanhas ativas</div>
          <div className="text-2xl font-bold text-foreground">{byCampaign.length}</div>
        </div>
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="text-xs text-muted-foreground">Novos (não trabalhados)</div>
          <div className="text-2xl font-bold text-foreground">{leads.filter(l => l.status === "novo").length}</div>
        </div>
      </div>

      {/* Por campanha */}
      {byCampaign.length > 0 && (
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <h4 className="text-sm font-semibold text-foreground mb-3">Leads por campanha</h4>
          <div className="space-y-2">
            {byCampaign.map(([campaign, count]) => (
              <div key={campaign} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground truncate max-w-[70%]">{campaign}</span>
                <Badge variant="outline">{count}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabela */}
      <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border/40">
          <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Users className="w-4 h-4 text-accent" /> Últimos leads
          </h4>
          <Link to="/admin/kanban" className="text-xs text-accent hover:underline flex items-center gap-1">
            Abrir Kanban <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
        {leads.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            Nenhum lead do Facebook ainda. Importe um CSV ou configure o webhook nativo da Meta.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground bg-muted/20">
                <tr className="text-left">
                  <th className="p-2">Data</th><th className="p-2">Nome</th><th className="p-2">WhatsApp</th>
                  <th className="p-2">Campanha</th><th className="p-2">Anúncio</th><th className="p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {leads.slice(0, 100).map((l) => (
                  <tr key={l.id} className="border-t border-border/30 hover:bg-muted/10">
                    <td className="p-2 text-muted-foreground">{new Date(l.created_at).toLocaleDateString("pt-BR")}</td>
                    <td className="p-2 text-foreground">{l.nome_completo}</td>
                    <td className="p-2">{l.whatsapp}</td>
                    <td className="p-2 truncate max-w-[200px]">{l.facebook_campaign}</td>
                    <td className="p-2 truncate max-w-[200px]">{l.facebook_ad_name}</td>
                    <td className="p-2"><Badge variant="outline">{l.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* =====================================================================
   PÁGINA
   ===================================================================== */

const FacebookConfigPage = () => {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Facebook className="w-6 h-6 text-blue-500" /> Facebook Lead Ads
        </h1>
        <p className="text-muted-foreground text-sm">
          Receba leads de formulários do Facebook direto no Kanban — via webhook nativo da Meta ou importação CSV.
        </p>
      </div>

      <Tabs defaultValue="leads" className="space-y-4">
        <TabsList>
          <TabsTrigger value="leads">Leads do Facebook</TabsTrigger>
          <TabsTrigger value="import">Importar CSV</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>
        <TabsContent value="leads"><LeadsTab reloadKey={reloadKey} /></TabsContent>
        <TabsContent value="import"><ImportTab onImported={() => setReloadKey(k => k + 1)} /></TabsContent>
        <TabsContent value="config"><ConfigTab /></TabsContent>
      </Tabs>
    </div>
  );
};

export default FacebookConfigPage;
