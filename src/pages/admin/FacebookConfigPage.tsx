import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Facebook, Copy, RefreshCw, CheckCircle2,
  Upload, FileSpreadsheet, Users, ExternalLink, Zap,
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
   ABA 1 — Configuração (Verify Token + Webhook URL + Guia Zapier)
   ===================================================================== */

function ConfigTab() {
  const [verifyToken, setVerifyToken] = useState("");
  const [configId, setConfigId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  useEffect(() => {
    supabase.from("facebook_webhook_config").select("*").limit(1).maybeSingle()
      .then(({ data }) => {
        if (data) { setConfigId(data.id); setVerifyToken(data.verify_token); }
        setLoading(false);
      });
  }, []);

  const generateToken = () => {
    const t = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map(b => b.toString(16).padStart(2, "0")).join("");
    setVerifyToken(t);
  };

  const save = async () => {
    if (verifyToken.length < 12) { toast.error("Token precisa ter pelo menos 12 caracteres"); return; }
    setSaving(true);
    if (configId) {
      await supabase.from("facebook_webhook_config").update({
        verify_token: verifyToken, updated_at: new Date().toISOString(),
      } as any).eq("id", configId);
    } else {
      const { data } = await supabase.from("facebook_webhook_config")
        .insert({ verify_token: verifyToken } as any).select("id").single();
      if (data) setConfigId(data.id);
    }
    setSaving(false);
    toast.success("Configuração salva");
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  if (loading) return <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;

  return (
    <div className="space-y-6">
      {/* 3 rotas resumidas */}
      <div className="grid md:grid-cols-3 gap-3">
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><Zap className="w-4 h-4 text-amber-400" /> Caminho B — Zapier</div>
          <p className="text-xs text-muted-foreground mt-1">Rápido, 5 min, sem App Review. <b>Recomendado</b>.</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/60 p-4">
          <div className="text-sm font-semibold text-foreground">Caminho A — Webhook Meta</div>
          <p className="text-xs text-muted-foreground mt-1">Tempo real nativo. Exige App Review (~3–7 dias).</p>
        </div>
        <div className="rounded-xl border border-border/50 bg-card/60 p-4">
          <div className="text-sm font-semibold text-foreground">Caminho C — Polling</div>
          <p className="text-xs text-muted-foreground mt-1">Edge function busca leads a cada X min via Graph API.</p>
        </div>
      </div>

      {/* Webhook URL */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground">1. URL do Webhook</h2>
        <p className="text-xs text-muted-foreground">Use esta URL no Zapier/Make ou como Callback URL no app da Meta.</p>
        <div className="flex gap-2">
          <Input readOnly value={WEBHOOK_URL} className="font-mono text-xs" />
          <Button variant="outline" onClick={() => copy(WEBHOOK_URL, "URL")}><Copy className="w-4 h-4" /></Button>
        </div>
      </div>

      {/* Verify token (somente Caminho A) */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground">2. Verify Token <span className="text-xs text-muted-foreground">(somente Caminho A — webhook nativo Meta)</span></h2>
        <div className="flex gap-2">
          <Input value={verifyToken} onChange={(e) => setVerifyToken(e.target.value)} placeholder="cole ou gere um token..." className="font-mono text-xs" />
          <Button variant="outline" onClick={generateToken} title="Gerar token aleatório"><RefreshCw className="w-4 h-4" /></Button>
          <Button onClick={save} disabled={saving} className="gradient-accent">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            <span className="ml-2">Salvar</span>
          </Button>
        </div>
      </div>

      {/* Guia Zapier */}
      <div className="bg-accent/5 border border-accent/20 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground flex items-center gap-2"><Zap className="w-4 h-4 text-amber-400" /> Como conectar via Zapier (5 min)</h2>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Entre em <a href="https://zapier.com" target="_blank" rel="noreferrer" className="text-accent underline">zapier.com</a> e crie um novo Zap.</li>
          <li><b>Trigger:</b> <i>Facebook Lead Ads</i> → <i>New Lead</i>. Conecte sua conta Meta, selecione a Página e o Formulário.</li>
          <li><b>Action:</b> <i>Webhooks by Zapier</i> → <i>POST</i>.</li>
          <li>Cole a URL acima em <b>URL</b>. Em <b>Payload Type</b>, escolha <b>JSON</b>.</li>
          <li>Em <b>Data</b>, mapeie os campos do formulário para estas chaves:
            <code className="block bg-muted/40 rounded p-2 mt-1 text-xs">full_name, phone_number, email, company_name, form_name, ad_name, adset_name, campaign_name, id</code>
          </li>
          <li>Teste. O lead deve aparecer aqui em <b>Leads do Facebook</b>.</li>
        </ol>
      </div>

      {/* Guia Caminho A */}
      <div className="bg-card border border-border/50 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-foreground">Como configurar o Webhook nativo da Meta (Caminho A)</h2>
        <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
          <li>Crie um App em <a href="https://developers.facebook.com" target="_blank" rel="noreferrer" className="text-accent underline">developers.facebook.com</a> (tipo Business).</li>
          <li>Em <b>Webhooks → Page</b>, adicione subscription para <code className="bg-muted px-1 rounded">leadgen</code>.</li>
          <li>Cole a URL acima como <b>Callback URL</b> e o token acima como <b>Verify Token</b>.</li>
          <li>Solicite as permissões <code className="bg-muted px-1 rounded">leads_retrieval</code> e <code className="bg-muted px-1 rounded">pages_manage_metadata</code> via App Review (~3–7 dias).</li>
          <li>Após aprovação, gere um <b>Page Access Token de longa duração</b> e me avise — adiciono a hidratação via Graph API.</li>
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
            Nenhum lead do Facebook ainda. Importe um CSV ou configure o Zapier.
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
          Receba leads de formulários do Facebook direto no Kanban — via Zapier, CSV ou webhook nativo.
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
