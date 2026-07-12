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

const MASTER_ID = "00000000-0000-0000-0000-000000000000";

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
  send_appointment_event?: boolean | null;
  send_sale_event?: boolean | null;
  appointment_event_name?: string | null;
  sale_event_name?: string | null;
}

interface CapiLog {
  id: string;
  event_name: string | null;
  status: string;
  http_status: number | null;
  error: string | null;
  created_at: string;
  lead_id: string | null;
  appointment_id: string | null;
  sale_id: string | null;
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
  const [sendAppt, setSendAppt] = useState(false);
  const [sendSale, setSendSale] = useState(false);
  const [apptEventName, setApptEventName] = useState("Schedule");
  const [saleEventName, setSaleEventName] = useState("Purchase");
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [logs, setLogs] = useState<CapiLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: ts }, { data: cs }] = await Promise.all([
        supabase.from("tenants").select("id,name,slug").order("name"),
        supabase.from("tenant_capi_config").select("*"),
      ]);
      const map: Record<string, CapiRow> = {};
      (cs || []).forEach((c: any) => { map[c.tenant_id || MASTER_ID] = c; });
      const master: Tenant = { id: MASTER_ID, name: "👑 Admin Master (PosionLeads)", slug: "master" };
      setTenants([master, ...((ts || []) as Tenant[])]);
      setConfigs(map);
      if (!selectedId) setSelectedId(MASTER_ID);
      setLoading(false);
    })();
  }, []);

  const loadLogs = async (tid: string) => {
    if (!tid) return;
    setLogsLoading(true);
    const { data } = await supabase
      .from("facebook_capi_logs")
      .select("id,event_name,status,http_status,error,created_at,lead_id,appointment_id,sale_id")
      .eq("tenant_id", tid)
      .order("created_at", { ascending: false })
      .limit(25);
    setLogs((data as any) || []);
    setLogsLoading(false);
  };

  useEffect(() => {
    const c = configs[selectedId];
    setPixel(c?.pixel_id || "");
    setToken(c?.access_token || "");
    setEvent(c?.default_event || "Purchase");
    setTestCode(c?.test_event_code || "");
    setEnabled(c?.enabled !== false);
    setSendAppt(!!c?.send_appointment_event);
    setSendSale(!!c?.send_sale_event);
    setApptEventName(c?.appointment_event_name || "Schedule");
    setSaleEventName(c?.sale_event_name || "Purchase");
    setReveal(false);
    loadLogs(selectedId);
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
      send_appointment_event: sendAppt,
      send_sale_event: sendSale,
      appointment_event_name: apptEventName || "Schedule",
      sale_event_name: saleEventName || "Purchase",
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
                <p className="text-xs text-muted-foreground">Purchase ao mover lead para "Ganho" no Kanban.</p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={!selectedId} />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">📅 Consultas realizadas</p>
                    <p className="text-[11px] text-muted-foreground">Dispara ao marcar como compareceu/realizado.</p>
                  </div>
                  <Switch checked={sendAppt} onCheckedChange={setSendAppt} disabled={!selectedId || !enabled} />
                </div>
                <Select value={apptEventName} onValueChange={setApptEventName} disabled={!sendAppt}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Schedule">Schedule</SelectItem>
                    <SelectItem value="CompleteRegistration">CompleteRegistration</SelectItem>
                    <SelectItem value="Contact">Contact</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">💰 Vendas registradas</p>
                    <p className="text-[11px] text-muted-foreground">Purchase com valor real ao criar venda.</p>
                  </div>
                  <Switch checked={sendSale} onCheckedChange={setSendSale} disabled={!selectedId || !enabled} />
                </div>
                <Select value={saleEventName} onValueChange={setSaleEventName} disabled={!sendSale}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Purchase">Purchase</SelectItem>
                    <SelectItem value="Subscribe">Subscribe</SelectItem>
                    <SelectItem value="StartTrial">StartTrial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
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

      {/* Validação — KPIs + logs recentes */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Validação dos eventos enviados
            </CardTitle>
            <CardDescription>Últimos 25 disparos server-side desta clínica (dedup por event_id).</CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => loadLogs(selectedId)} disabled={logsLoading}>
            {logsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : "Atualizar"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {["Lead", "Schedule", "Purchase", "ViewContent", "InitiateCheckout"].map((ev) => {
              const rows = logs.filter((l) => l.event_name === ev);
              const success = rows.filter((r) => r.status === "success").length;
              return (
                <div key={ev} className="rounded-md border border-border p-3">
                  <p className="text-[11px] text-muted-foreground">{ev}</p>
                  <p className="text-lg font-semibold">{rows.length}</p>
                  <p className="text-[10px] text-emerald-400">{success} ok</p>
                </div>
              );
            })}
          </div>
          <div className="rounded-md border border-border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="text-left px-3 py-2">Quando</th>
                  <th className="text-left px-3 py-2">Evento</th>
                  <th className="text-left px-3 py-2">Origem</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2">HTTP</th>
                  <th className="text-left px-3 py-2">Erro</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 && (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Nenhum evento ainda.</td></tr>
                )}
                {logs.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2">{new Date(l.created_at).toLocaleString("pt-BR")}</td>
                    <td className="px-3 py-2">{l.event_name || "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {l.sale_id ? "venda" : l.appointment_id ? "consulta" : l.lead_id ? "lead" : "—"}
                    </td>
                    <td className="px-3 py-2">
                      {l.status === "success"
                        ? <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">ok</Badge>
                        : <Badge variant="outline" className="border-red-500/40 text-red-400">erro</Badge>}
                    </td>
                    <td className="px-3 py-2">{l.http_status ?? "—"}</td>
                    <td className="px-3 py-2 text-red-400 truncate max-w-[280px]">{l.error || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
