import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  MessageCircle, CheckCircle2, XCircle, AlertCircle, Loader2, Copy, Webhook,
  ShieldCheck, Smartphone, KeyRound, Building2, Save, PlayCircle, QrCode,
} from "lucide-react";

type WAConn = {
  id: string;
  provider: "cloud" | "zapi";
  display_name: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  display_phone_number: string | null;
  business_account_name: string | null;
  access_token: string | null;
  app_secret: string | null;
  verify_token: string | null;
  webhook_subscribed: boolean;
  status: "pending" | "connected" | "error" | "disconnected";
  last_error: string | null;
  last_validated_at: string | null;
  metadata: any;
  is_default: boolean;
};

const PROJECT_REF = "mbhbflbuawkmtmpjazcj";
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/whatsapp-cloud-webhook`;

export default function ConexaoWhatsappPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [conn, setConn] = useState<WAConn | null>(null);

  // form state
  const [waba, setWaba] = useState("");
  const [phoneId, setPhoneId] = useState("");
  const [token, setToken] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [verifyToken, setVerifyToken] = useState("");

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("whatsapp_connections")
      .select("*")
      .eq("provider", "cloud")
      .order("is_default", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      setConn(data as any);
      setWaba(data.waba_id ?? "");
      setPhoneId(data.phone_number_id ?? "");
      setToken(data.access_token ?? "");
      setAppSecret(data.app_secret ?? "");
      setVerifyToken(data.verify_token ?? "");
    } else {
      // pre-generate a strong verify token suggestion
      setVerifyToken(crypto.randomUUID().replace(/-/g, ""));
    }
    setLoading(false);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        provider: "cloud" as const,
        waba_id: waba.trim() || null,
        phone_number_id: phoneId.trim() || null,
        access_token: token.trim() || null,
        app_secret: appSecret.trim() || null,
        verify_token: verifyToken.trim() || null,
        is_default: true,
      };
      if (conn) {
        const { error } = await supabase.from("whatsapp_connections").update(payload).eq("id", conn.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("whatsapp_connections").insert(payload);
        if (error) throw error;
      }
      toast.success("Credenciais salvas");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  async function validate() {
    if (!conn) {
      toast.error("Salve primeiro as credenciais");
      return;
    }
    setValidating(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-validate", {
        body: { connection_id: conn.id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Validação falhou");
      toast.success("Conexão validada ✓");
      await load();
    } catch (e: any) {
      toast.error(e.message ?? "Erro na validação");
    } finally {
      setValidating(false);
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  }

  const StatusBadge = () => {
    if (!conn) return <Badge variant="outline" className="gap-1"><AlertCircle className="w-3 h-3" />Não configurado</Badge>;
    if (conn.status === "connected") return <Badge className="gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"><CheckCircle2 className="w-3 h-3" />Conectado</Badge>;
    if (conn.status === "error") return <Badge variant="destructive" className="gap-1"><XCircle className="w-3 h-3" />Erro</Badge>;
    return <Badge variant="outline" className="gap-1"><AlertCircle className="w-3 h-3" />Pendente</Badge>;
  };

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <MessageCircle className="w-8 h-8 text-emerald-500" />
            Conexão WhatsApp
          </h1>
          <p className="text-muted-foreground mt-1">
            Configure a integração oficial Meta (Cloud API). Todas as validações acontecem aqui dentro.
          </p>
        </div>
        <StatusBadge />
      </div>

      <Tabs defaultValue="cloud" className="w-full">
        <TabsList>
          <TabsTrigger value="cloud" className="gap-2"><ShieldCheck className="w-4 h-4" />Cloud API (Oficial)</TabsTrigger>
          <TabsTrigger value="webhook" className="gap-2"><Webhook className="w-4 h-4" />Webhook</TabsTrigger>
        </TabsList>


        {/* ============== CLOUD API ============== */}
        <TabsContent value="cloud" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5" />Credenciais da conta WhatsApp Business</CardTitle>
              <CardDescription>
                Obtenha estes valores em <span className="font-mono text-xs">developers.facebook.com → seu app → WhatsApp → API Setup</span>.
                Tudo fica salvo de forma segura no banco — apenas administradores acessam.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="waba">WhatsApp Business Account ID (WABA ID)</Label>
                  <Input id="waba" value={waba} onChange={(e) => setWaba(e.target.value)} placeholder="ex: 123456789012345" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone" className="flex items-center gap-1"><Smartphone className="w-3.5 h-3.5" />Phone Number ID</Label>
                  <Input id="phone" value={phoneId} onChange={(e) => setPhoneId(e.target.value)} placeholder="ex: 109876543210987" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="token" className="flex items-center gap-1"><KeyRound className="w-3.5 h-3.5" />Access Token (permanente ou longa duração)</Label>
                <Input id="token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="EAAG..." className="font-mono" />
                <p className="text-xs text-muted-foreground">Gere um token de Sistema de Usuário (System User) para evitar expiração.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="secret">App Secret (opcional — habilita verificação de assinatura)</Label>
                <Input id="secret" type="password" value={appSecret} onChange={(e) => setAppSecret(e.target.value)} placeholder="abcdef..." className="font-mono" />
              </div>

              {conn?.last_error && (
                <div className="p-3 rounded-md bg-destructive/10 border border-destructive/30 text-sm text-destructive">
                  <strong>Último erro:</strong> {conn.last_error}
                </div>
              )}

              {conn?.status === "connected" && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                  <div className="p-3 rounded-md bg-emerald-500/5 border border-emerald-500/20">
                    <div className="text-xs text-muted-foreground">Número</div>
                    <div className="font-semibold">{conn.display_phone_number ?? "—"}</div>
                  </div>
                  <div className="p-3 rounded-md bg-emerald-500/5 border border-emerald-500/20">
                    <div className="text-xs text-muted-foreground">Conta</div>
                    <div className="font-semibold truncate">{conn.business_account_name ?? "—"}</div>
                  </div>
                  <div className="p-3 rounded-md bg-emerald-500/5 border border-emerald-500/20">
                    <div className="text-xs text-muted-foreground">Webhook</div>
                    <div className="font-semibold">{conn.webhook_subscribed ? "Inscrito ✓" : "Não inscrito"}</div>
                  </div>
                </div>
              )}

              <Separator />

              <div className="flex flex-wrap gap-2">
                <Button onClick={save} disabled={saving || loading} className="gap-2">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Salvar credenciais
                </Button>
                <Button onClick={validate} disabled={validating || !conn} variant="secondary" className="gap-2">
                  {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}
                  Validar conexão
                </Button>
                {conn?.last_validated_at && (
                  <span className="text-xs text-muted-foreground self-center">
                    Última validação: {new Date(conn.last_validated_at).toLocaleString("pt-BR")}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>




        {/* ============== WEBHOOK ============== */}
        <TabsContent value="webhook">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Webhook className="w-5 h-5" />Configuração do Webhook (Meta)</CardTitle>
              <CardDescription>
                Cole estes valores em <span className="font-mono text-xs">App → WhatsApp → Configuration → Webhook</span> e assine o campo <strong>messages</strong>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Callback URL</Label>
                <div className="flex gap-2">
                  <Input readOnly value={WEBHOOK_URL} className="font-mono text-xs" />
                  <Button variant="outline" size="icon" onClick={() => copy(WEBHOOK_URL, "Webhook URL")}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Verify Token</Label>
                <div className="flex gap-2">
                  <Input
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                    className="font-mono text-xs"
                    placeholder="Cole o mesmo valor no Meta"
                  />
                  <Button variant="outline" size="icon" onClick={() => copy(verifyToken, "Verify Token")}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Salve as credenciais (aba Cloud API) após alterar este valor para que a verificação funcione.
                </p>
              </div>

              <Separator />

              <div className="text-sm space-y-2">
                <p className="font-semibold">Passo a passo:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Cole a Callback URL acima no campo "Callback URL" do Meta.</li>
                  <li>Cole o Verify Token acima no campo "Verify Token" do Meta.</li>
                  <li>Salve no Meta — a verificação será feita automaticamente.</li>
                  <li>Em "Webhook fields", assine pelo menos <code className="font-mono text-xs bg-muted px-1 rounded">messages</code>.</li>
                  <li>Volte aqui e clique em <strong>Validar conexão</strong>.</li>
                </ol>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
