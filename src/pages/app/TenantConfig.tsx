import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Save, Loader2, MessageCircle, CheckCircle2, Key, RefreshCw, Eye, EyeOff, Zap, AlertCircle, QrCode, Target } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

interface ApiToken {
  id: string;
  token: string;
  name: string;
  active: boolean;
  created_at: string;
}

export default function TenantConfig() {
  const { tenant } = useTenant();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // API tokens
  const [apiToken, setApiToken] = useState<ApiToken | null>(null);
  const [revealToken, setRevealToken] = useState(false);
  const [generatingToken, setGeneratingToken] = useState(false);

  // WhatsApp config
  const [provider, setProvider] = useState("evolution");
  const [instanceUrl, setInstanceUrl] = useState("");
  const [instanceName, setInstanceName] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [revealApiKey, setRevealApiKey] = useState(false);
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [clientToken, setClientToken] = useState("");
  const [status, setStatus] = useState<string>("disconnected");
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  const webhookUrl = tenant
    ? `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/whatsapp-webhook?tenant=${tenant.slug}`
    : "";

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    Promise.all([
      supabase.from("zapi_connections").select("*").eq("tenant_id", tenant.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("api_tokens").select("*").eq("tenant_id", tenant.id).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]).then(([conn, tok]) => {
      if (conn.data) {
        setConnectionId(conn.data.id);
        setInstanceId(conn.data.instance_id || "");
        setToken(conn.data.token || "");
        setClientToken(conn.data.client_token || "");
        setProvider((conn.data as any).provider || "evolution");
        setInstanceUrl((conn.data as any).instance_url || "");
        setInstanceName((conn.data as any).instance_name || "");
        setApiKey((conn.data as any).api_key || "");
        setStatus(conn.data.status || "disconnected");
      }
      if (tok.data) setApiToken(tok.data as ApiToken);
      setLoading(false);
    });
  }, [tenant]);

  const generateToken = async () => {
    if (!tenant) return;
    setGeneratingToken(true);
    // Invalidate previous
    if (apiToken) {
      await supabase.from("api_tokens").update({ active: false }).eq("id", apiToken.id);
    }
    const { data, error } = await supabase
      .from("api_tokens")
      .insert({ tenant_id: tenant.id, name: "Token principal" })
      .select()
      .single();
    setGeneratingToken(false);
    if (error) return toast.error("Erro ao gerar token: " + error.message);
    setApiToken(data as ApiToken);
    setRevealToken(true);
    toast.success("Novo token gerado! Copie e guarde com segurança.");
  };

  const maskToken = (t: string) => "•".repeat(Math.max(0, t.length - 8)) + t.slice(-8);

  const sanitizeBaseUrl = (raw: string): { url: string; error?: string } => {
    const trimmed = (raw || "").trim();
    if (!trimmed) return { url: "" };
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
      const u = new URL(withProto);
      const path = u.pathname.replace(/\/+$/, "");
      if (/\/manager(\/|$)/i.test(path) || /\/manager\b/i.test(trimmed)) {
        return { url: `${u.protocol}//${u.host}`, error: "Use apenas a URL base da Evolution API. Não cole URL do Manager." };
      }
      if (path) return { url: `${u.protocol}//${u.host}`, error: "Use apenas a URL base, sem caminho." };
      return { url: `${u.protocol}//${u.host}` };
    } catch {
      return { url: trimmed, error: "URL inválida" };
    }
  };

  const handleUrlBlur = () => {
    const { url, error } = sanitizeBaseUrl(instanceUrl);
    if (url !== instanceUrl) setInstanceUrl(url);
    setUrlError(error ?? null);
    if (error) toast.warning(error);
  };

  const save = async () => {
    if (!tenant) return;
    const { url, error: invalidUrl } = sanitizeBaseUrl(instanceUrl);
    if (invalidUrl) { setInstanceUrl(url); setUrlError(invalidUrl); return toast.error(invalidUrl); }
    setSaving(true);
    const payload: any = {
      tenant_id: tenant.id,
      instance_id: instanceId || instanceName || "manual",
      token: token || apiKey || "manual",
      client_token: clientToken || apiKey || "manual",
      webhook_url: webhookUrl,
      status,
      provider,
      instance_url: url,
      instance_name: instanceName,
      api_key: apiKey,
    };
    const { error, data } = connectionId
      ? await supabase.from("zapi_connections").update(payload).eq("id", connectionId).select().single()
      : await supabase.from("zapi_connections").insert(payload).select().single();
    setSaving(false);
    if (error) return toast.error("Erro ao salvar: " + error.message);
    if (data && !connectionId) setConnectionId(data.id);
    toast.success("Configurações salvas!");
  };

  const testConnection = async () => {
    if (!tenant || !instanceName) return toast.error("Informe o nome da instância");
    setTesting(true);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-status", {
        body: { connection_id: connectionId, instance_name: instanceName, tenant_id: tenant.id },
      });
      const next = data?.status || "disconnected";
      setStatus(next);
      if (next === "connected") {
        setQr(null);
        toast.success("Conexão ativa!");
      } else {
        toast.warning("Evolution indisponível", { description: data?.error || error?.message || `Status: ${next}` });
      }
    } catch (e: any) {
      setStatus("disconnected");
      toast.warning("Evolution indisponível", { description: e.message || "Erro ao consultar status" });
    }
    setTesting(false);
  };

  const connectEvolution = async () => {
    if (!tenant) return;
    if (!instanceUrl || !apiKey || !instanceName) return toast.error("Preencha URL, API Key e nome da instância");
    const { url, error: invalidUrl } = sanitizeBaseUrl(instanceUrl);
    if (invalidUrl) { setInstanceUrl(url); setUrlError(invalidUrl); return toast.error(invalidUrl); }
    setConnecting(true);
    setQr(null);
    try {
      const { data, error } = await supabase.functions.invoke("evolution-connect", {
        body: { instance_url: url, api_key: apiKey, instance_name: instanceName, tenant_id: tenant.id },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      const qrCode = data?.qr;
      if (qrCode) {
        setQr(qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode.replace(/^data:[^,]+,/, "")}`);
        toast.success("QR Code gerado — escaneie no WhatsApp");
      } else {
        toast.success("Instância conectada/configurada");
      }
      setStatus(data?.status || "connecting");
      setInstanceUrl(url);
      await Promise.all([
        supabase.from("zapi_connections").select("*").eq("tenant_id", tenant.id).order("updated_at", { ascending: false }).limit(1).maybeSingle().then((conn) => {
          if (conn.data) {
            setConnectionId(conn.data.id);
            setStatus(conn.data.status || data?.status || "connecting");
          }
        }),
      ]);
    } catch (e: any) {
      toast.error(e.message || "Falha ao conectar");
    } finally {
      setConnecting(false);
    }
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight font-display">Configurações</h1>
        <p className="text-muted-foreground">{tenant?.name}</p>
      </div>

      {/* Integrações & API */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Key className="w-4 h-4 text-primary" /> Integrações & API</CardTitle>
          <CardDescription>Token de acesso para conectar n8n, agentes de IA e sistemas externos à sua clínica.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Chave de API da clínica</Label>
            {apiToken ? (
              <>
                <div className="flex gap-2">
                  <Input
                    value={revealToken ? apiToken.token : maskToken(apiToken.token)}
                    readOnly
                    className="font-mono text-xs"
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setRevealToken((v) => !v)} title="Revelar/Ocultar">
                    {revealToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                  <Button type="button" variant="outline" size="icon" onClick={() => copy(apiToken.token, "Token")}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Use este token no header <code className="bg-muted px-1 rounded">Authorization: Bearer {"{token}"}</code>. Gerado em {new Date(apiToken.created_at).toLocaleDateString("pt-BR")}.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Nenhum token ativo. Gere o primeiro abaixo.</p>
            )}
            <Button onClick={generateToken} disabled={generatingToken} variant="outline" className="gap-2 mt-2">
              {generatingToken ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {apiToken ? "Gerar novo token (invalida o atual)" : "Gerar token"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* WhatsApp manual config */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><MessageCircle className="w-4 h-4 text-primary" /> WhatsApp — Configuração Manual</CardTitle>
              <CardDescription>Conecte sua instância (Evolution API, Z-API, WPPConnect).</CardDescription>
            </div>
            <Badge
              variant="outline"
              className={
                status === "connected"
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : status === "pending"
                  ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                  : "bg-rose-500/10 text-rose-400 border-rose-500/30"
              }
            >
              {status === "connected" ? <><CheckCircle2 className="w-3 h-3 mr-1" /> Conectado</> : status === "pending" ? "Pendente" : <><AlertCircle className="w-3 h-3 mr-1" /> Desconectado</>}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provedor</Label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="evolution">Evolution API</SelectItem>
                <SelectItem value="zapi">Z-API</SelectItem>
                <SelectItem value="wppconnect">WPPConnect</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>URL da instância</Label>
            <Input value={instanceUrl} onChange={(e) => { setInstanceUrl(e.target.value); if (urlError) setUrlError(null); }} onBlur={handleUrlBlur} placeholder="http://129.121.36.166:8080" className={urlError ? "border-destructive" : ""} />
            <p className={`text-xs ${urlError ? "text-destructive" : "text-muted-foreground"}`}>{urlError || "Use somente a URL base da Evolution API (http://host:porta), nunca /manager."}</p>
          </div>

          <div className="space-y-2">
            <Label>Nome da instância</Label>
            <Input value={instanceName} onChange={(e) => setInstanceName(e.target.value)} placeholder="zap01" />
          </div>

          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex gap-2">
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Chave da API"
                type={revealApiKey ? "text" : "password"}
              />
              <Button type="button" variant="outline" size="icon" onClick={() => setRevealApiKey((v) => !v)}>
                {revealApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <Label>Webhook URL (cole no painel da sua API)</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={() => copy(webhookUrl, "Webhook URL")}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={connectEvolution} disabled={connecting} className="gap-2">
              {connecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <QrCode className="w-4 h-4" />} Conectar / Gerar QR
            </Button>
            <Button onClick={testConnection} disabled={testing || !connectionId} variant="outline" className="gap-2">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Testar conexão
            </Button>
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
            </Button>
          </div>
          {qr && (
            <div className="border border-border rounded-lg p-4 flex flex-col items-center bg-card">
              <p className="text-xs text-muted-foreground mb-3">Escaneie em <strong>Dispositivos conectados</strong></p>
              <img src={qr} alt="QR Code" className="w-56 h-56 rounded-md bg-white p-2" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
