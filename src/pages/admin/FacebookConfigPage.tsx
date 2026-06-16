import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Facebook, Copy, RefreshCw, CheckCircle2,
  Upload, FileSpreadsheet, Users, ExternalLink, Zap,
  AlertCircle, KeyRound, Eye, EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";

const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const WEBHOOK_URL = `https://${projectId}.supabase.co/functions/v1/facebook-leads-webhook`;

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
  has_page_access_token: boolean;
  has_app_secret: boolean;
  last_validated_at: string | null;
  last_validation_result: any;
  updated_at: string;
};

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
  const [steps, setSteps] = useState<ValidationStep[] | null>(null);

  // form inputs (apenas para envio — token nunca volta do server)
  const [verifyToken, setVerifyToken] = useState("");
  const [pageAccessToken, setPageAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [pageId, setPageId] = useState("");
  const [showPat, setShowPat] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  const loadMeta = async () => {
    const { data } = await supabase.rpc("get_facebook_config_meta" as any);
    const row = Array.isArray(data) ? data[0] : data;
    if (row) {
      setMeta(row as ConfigMeta);
      setVerifyToken(row.verify_token ?? "");
      setPageId(row.page_id ?? "");
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

  const saveAll = async () => {
    if (verifyToken && verifyToken.length < 12) {
      toast.error("Verify Token precisa ter pelo menos 12 caracteres");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {};
      if (verifyToken) payload.verify_token = verifyToken;
      if (pageAccessToken) payload.page_access_token = pageAccessToken;
      if (appSecret) payload.app_secret = appSecret;
      if (pageId !== (meta?.page_id ?? "")) payload.page_id = pageId;

      const { error } = await supabase.functions.invoke("facebook-config-save", { body: payload });
      if (error) throw error;
      toast.success("Credenciais salvas");
      setPageAccessToken("");
      setAppSecret("");
      await loadMeta();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
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

      {/* Credenciais Meta */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-accent" /> 3. Credenciais Meta
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Cole aqui o <b>Page Access Token</b> (longa duração, com permissão <code className="bg-muted px-1 rounded">leads_retrieval</code>).
            Tokens ficam guardados criptografados e <b>nunca</b> aparecem de volta na tela — apenas o status.
          </p>
        </div>

        {/* Page Access Token */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground flex items-center gap-2">
            Page Access Token
            {meta?.has_page_access_token && <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400">salvo</Badge>}
          </label>
          <div className="flex gap-2">
            <Input
              type={showPat ? "text" : "password"}
              value={pageAccessToken}
              onChange={(e) => setPageAccessToken(e.target.value)}
              placeholder={meta?.has_page_access_token ? "•••••••• (deixe vazio para manter)" : "cole o token aqui"}
              className="font-mono text-xs"
              autoComplete="off"
            />
            <Button variant="outline" onClick={() => setShowPat(s => !s)} type="button">
              {showPat ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {/* App Secret */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground flex items-center gap-2">
            App Secret <span className="opacity-60 font-normal">(opcional — valida X-Hub-Signature-256)</span>
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

        {/* Page ID */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-foreground">Page ID <span className="opacity-60 font-normal">(opcional)</span></label>
          <Input
            value={pageId}
            onChange={(e) => setPageId(e.target.value)}
            placeholder="ex: 102345678901234"
            className="font-mono text-xs"
          />
        </div>

        <Button onClick={saveAll} disabled={saving} className="gradient-accent">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          <span className="ml-2">Salvar credenciais</span>
        </Button>
      </div>

      {/* Validação ponta-a-ponta */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-foreground">4. Validar webhook completo</h2>
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

      {/* Guia rápido */}
      <div className="bg-accent/5 border border-accent/20 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground">Como configurar no painel da Meta</h2>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Crie um App em <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-accent underline">developers.facebook.com</a> (tipo Business) e gere um <b>Page Access Token de longa duração</b> com as permissões <code className="bg-muted px-1 rounded">leads_retrieval</code>, <code className="bg-muted px-1 rounded">pages_show_list</code> e <code className="bg-muted px-1 rounded">pages_manage_metadata</code>.</li>
          <li>Cole o token (e opcionalmente o App Secret) no formulário acima e clique em <b>Salvar credenciais</b>.</li>
          <li>No App → <b>Webhooks → Page</b>, adicione subscription para o campo <code className="bg-muted px-1 rounded">leadgen</code>. Use a <b>URL do Webhook</b> (passo 1) e o <b>Verify Token</b> (passo 2).</li>
          <li>Assine a Página ao App via Graph API:
            <code className="block bg-muted/40 rounded p-2 mt-1 text-xs break-all">POST /v21.0/&#123;page-id&#125;/subscribed_apps?subscribed_fields=leadgen&access_token=&#123;page_token&#125;</code>
          </li>
          <li>Clique em <b>Validar agora</b> e confira que todos os passos ficaram verdes.</li>
          <li>Envie o app para <b>App Review</b> (Meta) com as permissões acima — sem isso, só leads de testers chegam.</li>
        </ol>
      </div>
    </div>
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
