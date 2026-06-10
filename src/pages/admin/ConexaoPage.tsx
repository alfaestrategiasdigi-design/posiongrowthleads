import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Settings, Wifi, WifiOff, Loader2, Save, Trash2, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import type { ZapiConnection } from "@/types/admin";

const ConexaoPage = () => {
  const [connections, setConnections] = useState<ZapiConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [instanceId, setInstanceId] = useState("");
  const [token, setToken] = useState("");
  const [clientToken, setClientToken] = useState("");

  useEffect(() => { loadConnections(); }, []);

  const loadConnections = async () => {
    const { data } = await supabase.from("zapi_connections").select("*").order("created_at", { ascending: false });
    setConnections((data as ZapiConnection[]) || []);
    if (data && data.length > 0) {
      setInstanceId(data[0].instance_id);
      setToken(data[0].token);
      setClientToken(data[0].client_token);
    }
    setLoading(false);
  };

  const webhookUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/zapi-webhook`;

  const handleSave = async () => {
    if (!instanceId.trim() || !token.trim() || !clientToken.trim()) {
      toast.error("Preencha todos os campos");
      return;
    }
    setSaving(true);

    if (connections.length > 0) {
      const { error } = await supabase
        .from("zapi_connections")
        .update({
          instance_id: instanceId.trim(),
          token: token.trim(),
          client_token: clientToken.trim(),
          webhook_url: webhookUrl,
          updated_at: new Date().toISOString(),
        })
        .eq("id", connections[0].id);
      if (error) toast.error("Erro ao salvar");
      else { toast.success("Conexão atualizada!"); loadConnections(); }
    } else {
      const { error } = await supabase.from("zapi_connections").insert({
        instance_id: instanceId.trim(),
        token: token.trim(),
        client_token: clientToken.trim(),
        webhook_url: webhookUrl,
      });
      if (error) toast.error("Erro ao salvar");
      else { toast.success("Conexão criada!"); loadConnections(); }
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!connections.length || !confirm("Remover conexão?")) return;
    const { error } = await supabase.from("zapi_connections").delete().eq("id", connections[0].id);
    if (error) toast.error("Erro ao remover");
    else {
      toast.success("Conexão removida");
      setConnections([]);
      setInstanceId(""); setToken(""); setClientToken("");
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-accent" /></div>;
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Conexão Z-API</h1>
        <p className="text-muted-foreground text-sm">Configure a integração com o WhatsApp</p>
      </div>

      {/* Status */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${connections.length > 0 ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"}`}>
        {connections.length > 0 ? (
          <>
            <Wifi className="w-5 h-5 text-green-400" />
            <div>
              <p className="text-sm font-medium text-green-400">Conectado</p>
              <p className="text-xs text-muted-foreground">Instance: {connections[0].instance_id}</p>
            </div>
          </>
        ) : (
          <>
            <WifiOff className="w-5 h-5 text-red-400" />
            <div>
              <p className="text-sm font-medium text-red-400">Desconectado</p>
              <p className="text-xs text-muted-foreground">Configure suas credenciais abaixo</p>
            </div>
          </>
        )}
      </div>

      {/* Form */}
      <div className="bg-card rounded-xl border border-border/50 p-6 space-y-5">
        <div className="flex items-center gap-2 mb-2">
          <Settings className="w-5 h-5 text-accent" />
          <h2 className="font-semibold text-foreground">Credenciais Z-API</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="form-label">Instance ID</label>
            <Input placeholder="Seu Instance ID" value={instanceId} onChange={e => setInstanceId(e.target.value)} className="bg-muted/50" />
          </div>
          <div>
            <label className="form-label">Token</label>
            <Input placeholder="Seu Token" value={token} onChange={e => setToken(e.target.value)} className="bg-muted/50" type="password" />
          </div>
          <div>
            <label className="form-label">Client Token</label>
            <Input placeholder="Seu Client Token" value={clientToken} onChange={e => setClientToken(e.target.value)} className="bg-muted/50" type="password" />
          </div>
          <div>
            <label className="form-label">Webhook URL (copie para Z-API)</label>
            <div className="flex gap-2">
              <Input value={webhookUrl} readOnly className="bg-muted/50 text-xs font-mono" />
              <Button variant="outline" onClick={() => { navigator.clipboard.writeText(webhookUrl); toast.success("URL copiada!"); }}>
                Copiar
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Cole esta URL nas configurações de webhook da Z-API</p>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button onClick={handleSave} disabled={saving} className="gap-2 bg-accent hover:bg-accent/90">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {connections.length > 0 ? "Atualizar" : "Salvar"}
          </Button>
          {connections.length > 0 && (
            <Button variant="destructive" onClick={handleDelete} className="gap-2">
              <Trash2 className="w-4 h-4" /> Remover
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConexaoPage;
