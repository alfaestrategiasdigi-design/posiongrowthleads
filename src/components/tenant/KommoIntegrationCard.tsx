import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, PlugZap, Download, CheckCircle2, AlertCircle, Copy } from "lucide-react";
import { toast } from "sonner";

const SUPABASE_PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID;
const REDIRECT_URI = `https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/kommo-oauth-callback`;

interface Props { tenantId: string; }

interface KommoStatus {
  status: string;
  account_name: string | null;
  subdomain: string | null;
  last_import_at: string | null;
  last_import_stats: Record<string, any> | null;
  expires_at: string | null;
}

export default function KommoIntegrationCard({ tenantId }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [subdomain, setSubdomain] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [status, setStatus] = useState<KommoStatus | null>(null);
  const pollRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const { data: conn } = await supabase.from("kommo_connections")
      .select("subdomain, client_id, status, account_name, last_import_at, last_import_stats, expires_at")
      .eq("tenant_id", tenantId).maybeSingle();
    if (conn) {
      setSubdomain(conn.subdomain ?? "");
      setClientId(conn.client_id ?? "");
      setStatus({
        status: conn.status,
        account_name: conn.account_name,
        subdomain: conn.subdomain,
        last_import_at: conn.last_import_at,
        last_import_stats: (conn.last_import_stats as any) ?? null,
        expires_at: conn.expires_at,
      });
      if (conn.status === "importing") setImporting(true);
    } else {
      setStatus(null);
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Poll while importing
  useEffect(() => {
    if (!importing) return;
    const tick = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const r = await fetch(`https://${SUPABASE_PROJECT_ID}.supabase.co/functions/v1/kommo-import-status?tenant_id=${tenantId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const j = await r.json();
      if (j?.connection) {
        setStatus(j.connection);
        if (j.connection.status !== "importing") {
          setImporting(false);
          if (j.connection.status === "connected") toast.success("Importação Kommo concluída");
          if (j.connection.status === "error") toast.error("Erro no import Kommo");
        }
      }
    };
    tick();
    pollRef.current = window.setInterval(tick, 2500);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [importing, tenantId]);

  const saveCredentials = async () => {
    if (!subdomain.trim() || !clientId.trim() || !clientSecret.trim()) {
      toast.error("Preencha subdomain, client_id e client_secret");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("kommo_connections").upsert({
      tenant_id: tenantId,
      subdomain: subdomain.trim(),
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
      status: status?.status === "connected" ? "connected" : "disconnected",
    }, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Credenciais salvas");
    setClientSecret("");
    refresh();
  };

  const connect = async () => {
    if (!clientId && !status?.subdomain) {
      toast.error("Salve as credenciais primeiro");
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("kommo-oauth-start", { body: { tenant_id: tenantId } });
      if (error) throw error;
      const popup = window.open(data.url, "kommo-oauth", "width=560,height=720");
      if (!popup) { toast.error("Popup bloqueado"); setConnecting(false); return; }
      const onMsg = (ev: MessageEvent) => {
        if (ev.data?.source !== "kommo-oauth") return;
        window.removeEventListener("message", onMsg);
        setConnecting(false);
        if (ev.data.ok) { toast.success(`Kommo conectado: ${ev.data.account ?? ""}`); refresh(); }
        else toast.error(ev.data.error ?? "Falha na autenticação");
      };
      window.addEventListener("message", onMsg);
    } catch (e: any) {
      setConnecting(false);
      toast.error(e.message ?? "Erro ao conectar");
    }
  };

  const runImport = async () => {
    setImporting(true);
    const { error } = await supabase.functions.invoke("kommo-import-run", { body: { tenant_id: tenantId } });
    if (error) { setImporting(false); toast.error(error.message); return; }
    toast.info("Import iniciado. Acompanhe o progresso abaixo.");
    refresh();
  };

  const disconnect = async () => {
    if (!confirm("Desconectar Kommo? Os leads/conversas já importados são mantidos.")) return;
    await supabase.from("kommo_connections").update({
      status: "disconnected",
      access_token: null, refresh_token: null, expires_at: null,
    }).eq("tenant_id", tenantId);
    toast.success("Desconectado");
    refresh();
  };

  if (loading) {
    return <Card><CardContent className="p-6 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Carregando Kommo...</CardContent></Card>;
  }

  const stats = status?.last_import_stats ?? null;
  const connected = status?.status === "connected" || status?.status === "importing";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlugZap className="w-5 h-5" /> Kommo CRM
          {connected && <Badge className="bg-green-600">Conectado{status?.account_name ? ` — ${status.account_name}` : ""}</Badge>}
          {status?.status === "error" && <Badge variant="destructive">Erro</Badge>}
        </CardTitle>
        <CardDescription>
          Importe leads, conversas, tarefas e notas do seu Kommo CRM. Duplicados (mesmo telefone) são pulados.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md bg-muted/40 p-3 text-xs space-y-2">
          <p className="font-semibold">Passo a passo para conectar:</p>
          <ol className="list-decimal ml-5 space-y-1">
            <li>No Kommo → <b>Configurações → Integrações → + Criar Integração</b>.</li>
            <li>Redirect URI: <code className="bg-background px-1 py-0.5 rounded">{REDIRECT_URI}</code>
              <Button size="sm" variant="ghost" className="ml-2 h-6 px-2" onClick={() => { navigator.clipboard.writeText(REDIRECT_URI); toast.success("Copiado"); }}><Copy className="w-3 h-3" /></Button>
            </li>
            <li>Marque todos os escopos disponíveis (crm, notifications, push_notifications).</li>
            <li>Copie <b>Integration ID</b>, <b>Secret Key</b> e o <b>subdomain</b> (ex: <code className="bg-background px-1 rounded">roar</code> de <code className="bg-background px-1 rounded">roar.kommo.com</code>).</li>
            <li>Cole abaixo, salve, conecte e importe.</li>
          </ol>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label>Subdomain</Label>
            <Input value={subdomain} onChange={(e) => setSubdomain(e.target.value)} placeholder="roar" />
          </div>
          <div>
            <Label>Client ID (Integration ID)</Label>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="uuid" />
          </div>
          <div>
            <Label>Client Secret</Label>
            <Input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} placeholder={connected ? "•••• (salvo)" : "cole a Secret Key"} type="password" />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button onClick={saveCredentials} disabled={saving} variant="outline">
            {saving && <Loader2 className="w-4 h-4 animate-spin mr-2" />} Salvar credenciais
          </Button>
          <Button onClick={connect} disabled={connecting || !subdomain || !clientId}>
            {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <PlugZap className="w-4 h-4 mr-2" />}
            {connected ? "Reconectar" : "Conectar Kommo"}
          </Button>
          <Button onClick={runImport} disabled={!connected || importing} className="bg-primary">
            {importing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Download className="w-4 h-4 mr-2" />}
            Importar tudo do Kommo
          </Button>
          {connected && (
            <Button onClick={disconnect} variant="ghost" className="text-destructive">Desconectar</Button>
          )}
        </div>

        {stats && (
          <div className="rounded-md border p-3 text-sm space-y-1">
            <p className="flex items-center gap-2 font-semibold">
              {stats.phase === "done" ? <CheckCircle2 className="w-4 h-4 text-green-600" /> :
               stats.phase === "error" ? <AlertCircle className="w-4 h-4 text-destructive" /> :
               <Loader2 className="w-4 h-4 animate-spin" />}
              Fase: {stats.phase ?? "—"}
            </p>
            <ul className="text-xs text-muted-foreground grid grid-cols-2 md:grid-cols-3 gap-x-4">
              {stats.pipelines != null && <li>Pipelines: {stats.pipelines}</li>}
              {stats.custom_fields != null && <li>Custom fields: {stats.custom_fields}</li>}
              {stats.contacts_seen != null && <li>Contatos vistos: {stats.contacts_seen}</li>}
              {stats.leads_seen != null && <li>Leads vistos: {stats.leads_seen}</li>}
              {stats.leads_created != null && <li>Leads criados: {stats.leads_created}</li>}
              {stats.leads_skipped != null && <li>Duplicados pulados: {stats.leads_skipped}</li>}
              {stats.chats_created != null && <li>Conversas: {stats.chats_created}</li>}
              {stats.messages_created != null && <li>Mensagens: {stats.messages_created}</li>}
              {stats.tasks_created != null && <li>Tarefas: {stats.tasks_created}</li>}
              {stats.notes_created != null && <li>Notas: {stats.notes_created}</li>}
            </ul>
            {stats.error && <p className="text-xs text-destructive mt-2">Erro: {stats.error}</p>}
            {stats.chats_error && <p className="text-xs text-amber-600 mt-1">Chats: {stats.chats_error}</p>}
            {stats.tasks_error && <p className="text-xs text-amber-600 mt-1">Tarefas: {stats.tasks_error}</p>}
            {stats.notes_error && <p className="text-xs text-amber-600 mt-1">Notas: {stats.notes_error}</p>}
            {status?.last_import_at && <p className="text-xs mt-2">Última importação: {new Date(status.last_import_at).toLocaleString("pt-BR")}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
