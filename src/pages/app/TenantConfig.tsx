import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Copy, Save, Loader2, MessageCircle, CheckCircle2, Key, RefreshCw, Eye, EyeOff, Zap, AlertCircle } from "lucide-react";
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

  const webhookUrl = tenant
    ? `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/whatsapp-webhook?tenant=${tenant.slug}`
    : "";

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    Promise.all([
      supabase.from("zapi_connections").select("*").eq("tenant_id", tenant.id).maybeSingle(),
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

  const save = async () => {
    if (!tenant) return;
    setSaving(true);
    const payload: any = {
      tenant_id: tenant.id,
      instance_id: instanceId || instanceName || "manual",
      token: token || apiKey || "manual",
      client_token: clientToken || apiKey || "manual",
      webhook_url: webhookUrl,
      status,
      provider,
      instance_url: instanceUrl,
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
    if (!instanceUrl || !apiKey) return toast.error("Preencha URL e API Key primeiro");
    setTesting(true);
    try {
      const url = `${instanceUrl.replace(/\/$/, "")}/instance/connectionState/${encodeURIComponent(instanceName)}`;
      const res = await fetch(url, { headers: { apikey: apiKey } });
      if (res.ok) {
        setStatus("connected");
        toast.success("Conexão bem-sucedida!");
      } else {
        setStatus("disconnected");
        toast.error(`Falha (${res.status}): verifique URL, instância e API Key`);
      }
    } catch (e: any) {
      setStatus("disconnected");
      toast.error("Erro de rede: " + e.message);
    }
    setTesting(false);
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
            <Input value={instanceUrl} onChange={(e) => setInstanceUrl(e.target.value)} placeholder="https://evo.seuservidor.com" />
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
            <Button onClick={testConnection} disabled={testing} variant="outline" className="gap-2">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Testar conexão
            </Button>
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
