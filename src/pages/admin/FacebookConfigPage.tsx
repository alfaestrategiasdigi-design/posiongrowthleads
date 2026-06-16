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
  Loader2, Facebook, Copy, RefreshCw, CheckCircle2,
  Upload, FileSpreadsheet, Users, ExternalLink, Zap,
  AlertCircle, KeyRound, Eye, EyeOff, LogIn, Unplug,
  Download, Bug,
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

  // page picker
  const [pages, setPages] = useState<FbPage[] | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingPage, setSavingPage] = useState<string | null>(null);

  const loadMeta = async () => {
    const { data } = await supabase.rpc("get_facebook_config_meta" as any);
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      setMeta(row as ConfigMeta);
      setVerifyToken(row.verify_token ?? "");
      setAppId(row.app_id ?? "");
      if (row.last_validation_result) setSteps(row.last_validation_result as ValidationStep[]);
    }
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

  return (
    <div className="space-y-6">
      {/* Webhook URL */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground">1. URL do Webhook</h2>
        <p className="text-xs text-muted-foreground">Use esta URL como <b>Callback URL</b> no painel da Meta (App → Webhooks → Page → leadgen).</p>
        <div className="flex gap-2">
          <Input readOnly value={WEBHOOK_URL} className="font-mono text-xs" />
          <Button variant="outline" onClick={() => copy(WEBHOOK_URL, "URL")}><Copy className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Verify Token */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground">2. Verify Token</h2>
        <p className="text-xs text-muted-foreground">String aleatória que a Meta envia no handshake do webhook. Cole o mesmo valor no painel da Meta.</p>
        <div className="flex gap-2">
          <Input value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} placeholder="cole ou gere um token..." className="font-mono text-xs" />
          <Button variant="outline" onClick={generateToken} title="Gerar token aleatório"><RefreshCw className="w-4 h-4" /></Button>
          <Button variant="outline" onClick={() => copy(verifyToken, "Verify Token")} disabled={!verifyToken}><Copy className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Credenciais do App Meta */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-accent" /> 3. Credenciais do App Meta
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Cole o <b>App ID</b> e <b>App Secret</b> do seu app criado em{" "}
            <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-accent underline">developers.facebook.com/apps</a>.
            São necessários para o botão "Conectar com Facebook" funcionar.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground flex items-center gap-2">
            App ID
            {meta?.app_id && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">{meta.app_id}</Badge>}
          </label>
          <Input
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="ex: 1234567890123456"
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground flex items-center gap-2">
            App Secret
            {meta?.has_app_secret && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">salvo</Badge>}
          </label>
          <div className="flex gap-2">
            <Input
              type={showSecret ? "text" : "password"}
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={meta?.has_app_secret ? "•••••••• (deixe vazio para manter)" : "cole o app secret aqui"}
              className="font-mono text-xs"
              autoComplete="off"
            />
            <Button variant="outline" onClick={() => setShowSecret(s => !s)} type="button">
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        <Button onClick={saveCredentials} disabled={saving} className="gradient-accent">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          <span className="ml-2">Salvar credenciais do App</span>
        </Button>
      </div>

      {/* Conectar com Facebook */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Facebook className="w-4 h-4 text-blue-500" /> 4. Conectar conta do Facebook
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Faça login com sua conta Meta, escolha a página de negócios e o sistema cuida do resto
            (Page Access Token de longa duração, inscrição no webhook leadgen, etc).
          </p>
        </div>

        {isConnected ? (
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              <div>
                <div className="text-sm font-semibold text-foreground">{meta?.connected_page_name}</div>
                <div className="text-xs text-muted-foreground">
                  Page ID: <span className="font-mono">{meta?.page_id}</span>
                  {meta?.token_expires_at && (
                    <span className="ml-2">· token válido até {new Date(meta.token_expires_at).toLocaleDateString("pt-BR")}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleFacebookLogin} disabled={connecting}>
                {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                <span className="ml-2">Reconectar</span>
              </Button>
              <Button variant="outline" size="sm" onClick={disconnect} className="text-red-400 hover:text-red-300">
                <Unplug className="w-4 h-4 mr-1" /> Desconectar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={handleFacebookLogin}
            disabled={connecting || !meta?.app_id || !meta?.has_app_secret}
            className="bg-[#1877F2] hover:bg-[#1665d8] text-white"
            size="lg"
          >
            {connecting ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
            <span className="ml-2">Conectar com Facebook</span>
          </Button>
        )}

        {(!meta?.app_id || !meta?.has_app_secret) && !isConnected && (
          <p className="text-xs text-amber-300 flex items-start gap-1">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Salve o App ID e o App Secret no passo 3 antes de conectar.
          </p>
        )}
      </div>

      {/* Validação ponta-a-ponta */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-foreground">5. Validar webhook completo</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Executa 6 checagens: Verify Token, handshake da Meta, token de página, permissões, formulários de Lead Ads e App Secret.
            </p>
            {meta?.last_validated_at && (
              <p className="text-[11px] text-muted-foreground mt-1 opacity-70">
                Última validação: {new Date(meta.last_validated_at).toLocaleString("pt-BR")}
              </p>
            )}
          </div>
          <Button onClick={runValidation} disabled={validating} className="gradient-accent">
            {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            <span className="ml-2">Validar agora</span>
          </Button>
        </div>

        {steps && (
          <div className="space-y-2">
            {steps.map((s) => <StepRow key={s.id} step={s} />)}
          </div>
        )}
      </div>

      {/* Backfill + Debug */}
      <BackfillAndDebugBlock />

      {/* Guia rápido */}
      <div className="bg-accent/5 border border-accent/20 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground">Configuração do App no painel da Meta (uma vez só)</h2>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Em <a href="https://developers.facebook.com/apps" target="_blank" rel="noreferrer" className="text-accent underline">developers.facebook.com/apps</a>, crie um App tipo <b>Business</b> (ou use o "Posion Leads").</li>
          <li>Em <b>App settings → Basic</b>, copie o <b>App ID</b> e <b>App Secret</b> e cole no passo 3 acima.</li>
          <li>Adicione o produto <b>Facebook Login → Web</b> e em <b>Valid OAuth Redirect URIs</b> adicione: <code className="bg-muted px-1 rounded">{typeof window !== "undefined" ? window.location.origin : ""}/</code></li>
          <li>Em <b>App settings → Basic → App Domains</b> adicione: <code className="bg-muted px-1 rounded">{typeof window !== "undefined" ? window.location.hostname : ""}</code></li>
          <li>Em <b>Webhooks → Page</b>, adicione subscription para <code className="bg-muted px-1 rounded">leadgen</code> usando a URL (passo 1) e o Verify Token (passo 2).</li>
          <li>Clique em <b>Conectar com Facebook</b> (passo 4) — pronto.</li>
          <li>Para receber leads de qualquer usuário (não só testers), envie o app para <b>App Review</b> com as permissões <code className="bg-muted px-1 rounded">leads_retrieval</code> + <code className="bg-muted px-1 rounded">pages_show_list</code> + <code className="bg-muted px-1 rounded">pages_manage_metadata</code>.</li>
        </ol>
      </div>

      {/* Page picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escolha a página</DialogTitle>
            <DialogDescription>
              Selecione a página de negócios que receberá os leads. Você pode reconectar e trocar a qualquer momento.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {pages?.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPage(p)}
                disabled={!!savingPage}
                className="w-full text-left rounded-lg border border-border/50 hover:border-accent/50 bg-card hover:bg-accent/5 p-3 transition disabled:opacity-50"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-medium text-foreground text-sm">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.category ?? "—"} · <span className="font-mono">{p.id}</span></div>
                  </div>
                  {savingPage === p.id ? (
                    <Loader2 className="w-4 h-4 animate-spin text-accent" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                  )}
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
   ABA 2 — Importar CSV
   ===================================================================== */

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
