import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Target, Save, Loader2, Zap, Eye, EyeOff, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

interface Tenant {
  id: string;
  name: string;
  slug: string;
}

interface CapiRow {
  tenant_id: string;
  pixel_id: string | null;
  access_token: string | null;
  default_event: string | null;
  test_event_code: string | null;
  enabled: boolean | null;
}

export default function CapiConfigPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [configs, setConfigs] = useState<Record<string, CapiRow>>({});
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  const [pixel, setPixel] = useState("");
  const [token, setToken] = useState("");
  const [event, setEvent] = useState("Purchase");
  const [testCode, setTestCode] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: ts }, { data: cs }] = await Promise.all([
        supabase.from("tenants").select("id,name,slug").order("name"),
        supabase.from("tenant_capi_config").select("*"),
      ]);
      const map: Record<string, CapiRow> = {};
      (cs || []).forEach((c: any) => { map[c.tenant_id] = c; });
      setTenants((ts || []) as Tenant[]);
      setConfigs(map);
      if (ts && ts.length && !selectedId) setSelectedId(ts[0].id);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    const c = configs[selectedId];
    setPixel(c?.pixel_id || "");
    setToken(c?.access_token || "");
    setEvent(c?.default_event || "Purchase");
    setTestCode(c?.test_event_code || "");
    setEnabled(c?.enabled !== false);
    setReveal(false);
  }, [selectedId, configs]);

  const save = async () => {
    if (!selectedId) return;
    setSaving(true);
    const payload = {
      tenant_id: selectedId,
      pixel_id: pixel.trim() || null,
      access_token: token.trim() || null,
      default_event: event || "Purchase",
      test_event_code: testCode.trim() || null,
      enabled,
    };
    const { error } = await supabase.from("tenant_capi_config").upsert(payload, { onConflict: "tenant_id" });
    setSaving(false);
    if (error) return toast.error("Erro: " + error.message);
    setConfigs((p) => ({ ...p, [selectedId]: payload as any }));
    toast.success("Configuração CAPI salva");
  };

  const test = async () => {
    if (!selectedId) return;
    if (!pixel || !token) return toast.error("Preencha Pixel ID e Access Token");
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("facebook-capi-event", {
      body: { tenant_id: selectedId, event_name: event || "Purchase", test: true, lead_name: "Teste CAPI" },
    });
    setTesting(false);
    if (error) return toast.error("Falha: " + error.message);
    if ((data as any)?.ok) toast.success("Evento de teste enviado!");
    else toast.error("Falha: " + JSON.stringify(data));
  };

  const selected = tenants.find((t) => t.id === selectedId);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Target className="w-7 h-7 text-indigo-400" /> Facebook Conversions API
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure o Pixel e o Access Token de cada cliente. Disparo server-side automático quando um lead é movido para <strong>Ganho</strong> no Kanban.
        </p>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-6">
        {/* Tenants list */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Clínicas</CardTitle>
            <CardDescription>{tenants.length} clientes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {tenants.map((t) => {
              const c = configs[t.id];
              const configured = !!(c?.pixel_id && c?.access_token);
              const on = configured && c?.enabled !== false;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition ${
                    selectedId === t.id ? "bg-indigo-500/15 border border-indigo-500/40" : "hover:bg-muted/50 border border-transparent"
                  }`}
                >
                  <span className="truncate">{t.name}</span>
                  {on ? (
                    <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400 gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Ativo
                    </Badge>
                  ) : configured ? (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">Pausado</Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-muted text-muted-foreground gap-1">
                      <XCircle className="w-3 h-3" /> Sem config
                    </Badge>
                  )}
                </button>
              );
            })}
          </CardContent>
        </Card>

        {/* Editor */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-indigo-400" />
              {selected ? selected.name : "Selecione uma clínica"}
            </CardTitle>
            <CardDescription>
              Telefone e e-mail são hasheados (SHA-256) antes do envio para a Meta.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium">Envio automático ao marcar como Ganho</p>
                <p className="text-xs text-muted-foreground">Desligue para pausar sem perder a configuração.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!selectedId} />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Pixel ID</Label>
                <Input value={pixel} onChange={(e) => setPixel(e.target.value)} placeholder="1234567890" disabled={!selectedId} />
              </div>
              <div className="space-y-2">
                <Label>Evento padrão</Label>
                <Select value={event} onValueChange={setEvent} disabled={!selectedId}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Purchase">Purchase</SelectItem>
                    <SelectItem value="Lead">Lead</SelectItem>
                    <SelectItem value="CompleteRegistration">CompleteRegistration</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Access Token (API de Conversões)</Label>
              <div className="flex gap-2">
                <Input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="EAAB... (token gerado no Gerenciador de Eventos)"
                  type={reveal ? "text" : "password"}
                  disabled={!selectedId}
                />
                <Button type="button" variant="outline" size="icon" onClick={() => setReveal((v) => !v)}>
                  {reveal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Gere em: Gerenciador de Eventos → Configurações → API de Conversões → Gerar token de acesso.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Test Event Code (opcional)</Label>
              <Input value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder="TEST12345" disabled={!selectedId} />
              <p className="text-[11px] text-muted-foreground">
                Usado apenas pelo botão "Testar evento". Em disparos reais, não é enviado.
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={save} disabled={saving || !selectedId} className="gap-2">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Salvar
              </Button>
              <Button onClick={test} disabled={testing || !selectedId} variant="outline" className="gap-2">
                {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />} Testar evento
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
