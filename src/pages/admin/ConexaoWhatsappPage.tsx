import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";
import TenantWhatsAppNumbersCard from "@/components/tenant/TenantWhatsAppNumbersCard";
import {
  MessageCircle, CheckCircle2, XCircle, AlertCircle, Loader2, Copy, Webhook,
  ShieldCheck, Smartphone, KeyRound, Building2, Save, PlayCircle, QrCode,
  Send, Inbox, Activity, SendHorizonal,
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

  // traffic state
  const [traffic, setTraffic] = useState<{
    sent24: number; recv24: number; sent7: number; recv7: number; sent30: number; recv30: number;
    last: { sender: string; created_at: string } | null;
  }>({ sent24: 0, recv24: 0, sent7: 0, recv7: 0, sent30: 0, recv30: 0, last: null });

  // test-send state
  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testMsg, setTestMsg] = useState("Mensagem de teste do painel Posion ✅");
  const [sending, setSending] = useState(false);

  useEffect(() => { load(); loadTraffic(); }, []);

  useEffect(() => {
    const ch = supabase.channel("wa-traffic")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => loadTraffic())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  async function loadTraffic() {
    const now = Date.now();
    const d24 = new Date(now - 24 * 3600_000).toISOString();
    const d7 = new Date(now - 7 * 86400_000).toISOString();
    const d30 = new Date(now - 30 * 86400_000).toISOString();
    const [m24, m7, m30, last] = await Promise.all([
      supabase.from("messages").select("sender", { count: "exact", head: false }).gte("created_at", d24).limit(5000),
      supabase.from("messages").select("sender", { count: "exact", head: false }).gte("created_at", d7).limit(10000),
      supabase.from("messages").select("sender", { count: "exact", head: false }).gte("created_at", d30).limit(20000),
      supabase.from("messages").select("sender, created_at").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    const count = (rows: any[] | null, who: string) => (rows ?? []).filter((r: any) => r.sender === who).length;
    setTraffic({
      sent24: count(m24.data as any, "usuario"),
      recv24: count(m24.data as any, "cliente"),
      sent7: count(m7.data as any, "usuario"),
      recv7: count(m7.data as any, "cliente"),
      sent30: count(m30.data as any, "usuario"),
      recv30: count(m30.data as any, "cliente"),
      last: (last.data as any) ?? null,
    });
  }


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

  async function sendTest() {
    if (!conn) { toast.error("Salve as credenciais primeiro"); return; }
    const to = testTo.replace(/\D/g, "");
    if (to.length < 10) { toast.error("Informe um número E.164 válido (ex: 5511999998888)"); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-cloud-send", {
        body: { connection_id: conn.id, to, type: "text", text: testMsg },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error ?? "Falha ao enviar");
      toast.success("Mensagem enviada — confira no WhatsApp do destinatário");
      setTestOpen(false);
      loadTraffic();
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao enviar");
    } finally {
      setSending(false);
    }
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

      {/* Números do Admin Master (isolados dos tenants) */}
      <TenantWhatsAppNumbersCard tenantId={null} />

      <Tabs defaultValue="cloud" className="w-full">
        <TabsList>
          <TabsTrigger value="cloud" className="gap-2"><ShieldCheck className="w-4 h-4" />Cloud API (Oficial)</TabsTrigger>
          <TabsTrigger value="webhook" className="gap-2"><Webhook className="w-4 h-4" />Webhook</TabsTrigger>
        </TabsList>


        {/* ============== CLOUD API ============== */}
        <TabsContent value="cloud" className="space-y-6">
          {/* Diagnóstico da API Oficial */}
          {(() => {
            const credsOk = !!(conn?.waba_id && conn?.phone_number_id && conn?.access_token);
            const tokenOk = conn?.status === "connected";
            const webhookOk = !!conn?.webhook_subscribed;
            const noTraffic = traffic.sent30 === 0 && traffic.recv30 === 0;
            const Item = ({ ok, label, hint }: { ok: boolean | null; label: string; hint?: string }) => (
              <div className="flex items-start gap-3 p-3 rounded-md border border-border/40 bg-card/40">
                {ok === null
                  ? <AlertCircle className="w-4 h-4 mt-0.5 text-muted-foreground" />
                  : ok
                    ? <CheckCircle2 className="w-4 h-4 mt-0.5 text-emerald-400" />
                    : <XCircle className="w-4 h-4 mt-0.5 text-rose-400" />}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{label}</div>
                  {hint && <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{hint}</div>}
                </div>
              </div>
            );
            return (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" />Diagnóstico da API Oficial</CardTitle>
                  <CardDescription>
                    Estado da integração Meta Cloud em tempo real. Use isto para diagnosticar problemas no envio/recebimento.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <Item ok={credsOk} label="Credenciais salvas" hint={credsOk ? `WABA ${conn?.waba_id} · Phone ${conn?.phone_number_id}` : "Preencha WABA, Phone Number ID e Access Token"} />
                    <Item ok={tokenOk} label="Token validado pela Meta" hint={tokenOk ? `${conn?.display_phone_number ?? "—"} · ${conn?.business_account_name ?? ""}` : "Clique em Validar conexão"} />
                    <Item ok={webhookOk} label="Webhook assinado" hint={webhookOk ? "Eventos chegando neste backend" : "Assine o campo messages no painel Meta"} />
                    <Item ok={!conn?.last_error} label="Sem erros recentes" hint={conn?.last_error ?? "Nenhum erro reportado"} />
                  </div>
                  {noTraffic && credsOk && (
                    <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-sm text-amber-300">
                      <strong>Sem tráfego nos últimos 30 dias.</strong>{" "}
                      {!tokenOk && "A conexão ainda está pendente — clique em Validar conexão. "}
                      {tokenOk && !webhookOk && "O token está OK mas o webhook não foi assinado: copie a Callback URL/Verify Token (aba Webhook) e configure no app Meta. "}
                      {tokenOk && webhookOk && "Envie uma mensagem de teste para confirmar o envio end-to-end."}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Tráfego de mensagens */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" />Tráfego de mensagens</CardTitle>
              <CardDescription>
                Atualizado em tempo real a partir da tabela <span className="font-mono text-xs">messages</span>.
                {traffic.last && <> Última: <span className="font-mono text-xs">{new Date(traffic.last.created_at).toLocaleString("pt-BR")}</span> ({traffic.last.sender === "cliente" ? "recebida" : "enviada"})</>}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: "24 horas", sent: traffic.sent24, recv: traffic.recv24 },
                  { label: "7 dias", sent: traffic.sent7, recv: traffic.recv7 },
                  { label: "30 dias", sent: traffic.sent30, recv: traffic.recv30 },
                ].map((b) => (
                  <div key={b.label} className="rounded-lg border border-border/40 bg-card/40 p-4">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">{b.label}</div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-emerald-400">
                        <Send className="w-4 h-4" />
                        <div>
                          <div className="text-xl font-bold tabular-nums">{b.sent}</div>
                          <div className="text-[10px] text-muted-foreground">Enviadas</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sky-400">
                        <Inbox className="w-4 h-4" />
                        <div>
                          <div className="text-xl font-bold tabular-nums">{b.recv}</div>
                          <div className="text-[10px] text-muted-foreground">Recebidas</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end mt-4">
                <Button variant="secondary" size="sm" onClick={() => setTestOpen(true)} disabled={!conn} className="gap-2">
                  <SendHorizonal className="w-4 h-4" /> Enviar mensagem de teste
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Dialog de teste */}
          <Dialog open={testOpen} onOpenChange={setTestOpen}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Enviar mensagem de teste</DialogTitle>
                <DialogDescription>O número precisa ter aceitado a sessão de 24h ou estar na sandbox da Meta.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Número (E.164)</Label>
                  <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="5511999998888" className="font-mono" />
                </div>
                <div>
                  <Label>Mensagem</Label>
                  <Input value={testMsg} onChange={(e) => setTestMsg(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setTestOpen(false)}>Cancelar</Button>
                <Button onClick={sendTest} disabled={sending} className="gap-2">
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonal className="w-4 h-4" />}
                  Enviar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>


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
