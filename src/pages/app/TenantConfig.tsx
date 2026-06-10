import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Copy, Save, Loader2, MessageCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;

export default function TenantConfig() {
  const { tenant } = useTenant();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState("zapi");
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [clientToken, setClientToken] = useState("");
  const [status, setStatus] = useState<string>("disconnected");
  const [connectionId, setConnectionId] = useState<string | null>(null);

  const webhookUrl = tenant
    ? `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/whatsapp-webhook?tenant=${tenant.slug}`
    : "";

  useEffect(() => {
    if (!tenant) return;
    setLoading(true);
    supabase.from("zapi_connections").select("*").eq("tenant_id", tenant.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setConnectionId(data.id);
          setInstanceId(data.instance_id || "");
          setToken(data.token || "");
          setClientToken(data.client_token || "");
          setStatus(data.status || "disconnected");
        }
        setLoading(false);
      });
  }, [tenant]);

  const save = async () => {
    if (!tenant) return;
    setSaving(true);
    const payload = {
      tenant_id: tenant.id,
      instance_id: instanceId,
      token,
      client_token: clientToken,
      webhook_url: webhookUrl,
      status,
    };
    const { error } = connectionId
      ? await supabase.from("zapi_connections").update(payload).eq("id", connectionId)
      : await supabase.from("zapi_connections").insert(payload).select().single().then((r) => {
          if (r.data) setConnectionId(r.data.id);
          return r;
        });
    setSaving(false);
    if (error) toast.error("Erro ao salvar: " + error.message);
    else toast.success("Configurações salvas!");
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Configurações</h1>
        <p className="text-muted-foreground">{tenant?.name}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2"><MessageCircle className="w-4 h-4 text-primary" /> Integração WhatsApp</CardTitle>
              <CardDescription>Conecte sua API (Z-API ou compatível) para receber mensagens da clínica.</CardDescription>
            </div>
            <Badge variant={status === "connected" ? "default" : "outline"} className={status === "connected" ? "bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/20" : ""}>
              {status === "connected" ? <><CheckCircle2 className="w-3 h-3 mr-1" /> Conectado</> : "Desconectado"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Provider</Label>
            <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="zapi" />
            <p className="text-xs text-muted-foreground">Suportado hoje: Z-API. Outros providers em breve.</p>
          </div>
          <div className="space-y-2">
            <Label>Instance ID</Label>
            <Input value={instanceId} onChange={(e) => setInstanceId(e.target.value)} placeholder="3D...XXXX" />
          </div>
          <div className="space-y-2">
            <Label>Token</Label>
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token da instância" type="password" />
          </div>
          <div className="space-y-2">
            <Label>Client-Token</Label>
            <Input value={clientToken} onChange={(e) => setClientToken(e.target.value)} placeholder="Client token de segurança" type="password" />
          </div>

          <div className="space-y-2 pt-2">
            <Label>Webhook URL (cole isto no painel da sua API)</Label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={() => copy(webhookUrl, "Webhook URL")}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Configure este endereço como webhook de mensagens recebidas no painel da sua API.</p>
          </div>

          <Button onClick={save} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
