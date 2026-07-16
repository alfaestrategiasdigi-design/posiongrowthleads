import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw, Wrench } from "lucide-react";
import { toast } from "sonner";

type Check = { ok: boolean | "warn"; label: string; detail?: any; hint?: string; fix?: string };
type AuditResult = {
  ok: boolean;
  tenant_id: string | null;
  connection: { id: string; instance_name: string; instance_url: string; status: string };
  summary: { healthy: number; warnings: number; failing: number };
  checks: Check[];
  last_messages: any[];
};

export default function WhatsAppAuditPage() {
  const [tenants, setTenants] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [selected, setSelected] = useState<string>("master");
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [result, setResult] = useState<AuditResult | null>(null);

  const runWamidReconcile = async (dryRun: boolean) => {
    setReconciling(true);
    try {
      const tenant_id = selected === "master" ? null : selected;
      const { data, error } = await supabase.functions.invoke("whatsapp-wamid-reconcile", {
        body: { tenant_id, dry_run: dryRun, window_minutes: 5, limit: 500 },
      });
      if (error) throw error;
      const s = (data as any)?.stats ?? {};
      toast.success(
        `${dryRun ? "Simulação" : "Reconciliação"}: ${s.scanned} escaneadas · ${s.updated} preenchidas · ${s.duplicates_deleted} duplicatas · ${s.unmatched} sem par`,
      );
    } catch (e: any) {
      toast.error("Falha ao reconciliar wamid: " + (e?.message ?? e));
    } finally {
      setReconciling(false);
    }
  };

  useEffect(() => {
    supabase.from("tenants").select("id, name, slug").order("name").then(({ data }) => {
      setTenants(data ?? []);
    });
  }, []);

  const runAudit = async () => {
    setLoading(true);
    setResult(null);
    try {
      const tenant_id = selected === "master" ? null : selected;
      const { data, error } = await supabase.functions.invoke("whatsapp-audit", {
        body: { tenant_id },
      });
      if (error) throw error;
      setResult(data as AuditResult);
    } catch (e: any) {
      toast.error("Falha na auditoria: " + (e?.message ?? e));
    } finally {
      setLoading(false);
    }
  };

  const runResubscribe = async () => {
    if (!result) return;
    setFixing(true);
    try {
      const tenant_id = selected === "master" ? null : selected;
      const { error } = await supabase.functions.invoke("evolution-webhook-audit", {
        body: { tenant_id, dry_run: false },
      });
      if (error) throw error;
      toast.success("Webhook reassinado. Rodando auditoria novamente...");
      await runAudit();
    } catch (e: any) {
      toast.error("Falha ao reassinar: " + (e?.message ?? e));
    } finally {
      setFixing(false);
    }
  };

  const iconFor = (ok: Check["ok"]) => {
    if (ok === true) return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    if (ok === "warn") return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    return <XCircle className="h-5 w-5 text-red-500" />;
  };

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Auditoria WhatsApp</h1>
        <p className="text-muted-foreground text-sm">
          Diagnóstico completo da integração Evolution por tenant.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-sm font-medium mb-1 block">Escopo</label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="master">Master (sem tenant)</SelectItem>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runAudit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Rodar auditoria
          </Button>
        </CardContent>
      </Card>

      {result && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{result.connection.instance_name}</span>
                <div className="flex gap-2 text-sm">
                  <Badge variant="outline" className="text-green-600">{result.summary.healthy} ok</Badge>
                  <Badge variant="outline" className="text-amber-600">{result.summary.warnings} alertas</Badge>
                  <Badge variant="outline" className="text-red-600">{result.summary.failing} falhas</Badge>
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.checks.some((c) => c.fix?.toLowerCase().includes("reassinar")) && (
                <Alert>
                  <Wrench className="h-4 w-4" />
                  <AlertDescription className="flex items-center justify-between">
                    <span>Um ou mais itens sugerem reassinar o webhook.</span>
                    <Button size="sm" onClick={runResubscribe} disabled={fixing}>
                      {fixing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Reassinar agora
                    </Button>
                  </AlertDescription>
                </Alert>
              )}

              {result.checks.map((c, i) => (
                <div key={i} className="border rounded-lg p-3 flex gap-3">
                  <div className="pt-0.5">{iconFor(c.ok)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{c.label}</div>
                    {c.hint && <div className="text-sm text-muted-foreground mt-1">{c.hint}</div>}
                    {c.fix && <div className="text-sm text-blue-600 mt-1">Correção: {c.fix}</div>}
                    {c.detail !== undefined && (
                      <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto">
                        {JSON.stringify(c.detail, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Últimas 20 mensagens</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-1 text-xs font-mono">
                {result.last_messages.map((m) => (
                  <div key={m.id} className="flex gap-2 border-b py-1">
                    <span className="text-muted-foreground w-40 shrink-0">
                      {new Date(m.created_at).toLocaleString()}
                    </span>
                    <Badge variant="outline" className="shrink-0 w-24 justify-center">
                      {m.direction}
                    </Badge>
                    <Badge variant="outline" className="shrink-0 w-20 justify-center">
                      {m.sender}
                    </Badge>
                    <span className="truncate">{m.conteudo ?? "(mídia)"}</span>
                  </div>
                ))}
                {result.last_messages.length === 0 && (
                  <div className="text-muted-foreground">Nenhuma mensagem.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
