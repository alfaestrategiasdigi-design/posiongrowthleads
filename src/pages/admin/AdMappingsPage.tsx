import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Trash2, X, AlertTriangle, RefreshCw } from "lucide-react";

interface Tenant { id: string; nome: string; }
interface Mapping {
  id: string;
  tenant_id: string;
  label: string | null;
  facebook_ad_account_id: string | null;
  facebook_page_id: string | null;
  lead_form_ids: string[];
  campaign_ids: string[];
  is_active: boolean;
}
interface Unrouted {
  id: string;
  received_at: string;
  form_id: string | null;
  ad_account_id: string | null;
  page_id: string | null;
  facebook_lead_id: string | null;
  nome: string | null;
  whatsapp: string | null;
  email: string | null;
  resolved: boolean;
  raw_payload: any;
}

const emptyForm = {
  tenant_id: "",
  label: "",
  facebook_ad_account_id: "",
  facebook_page_id: "",
  lead_form_ids: [] as string[],
  campaign_ids: [] as string[],
  is_active: true,
};

export default function AdMappingsPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [unrouted, setUnrouted] = useState<Unrouted[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Mapping | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [formInput, setFormInput] = useState("");
  const [campInput, setCampInput] = useState("");
  const [routeOpen, setRouteOpen] = useState<Unrouted | null>(null);
  const [routeTenant, setRouteTenant] = useState<string>("");

  const load = async () => {
    setLoading(true);
    const [t, m, u] = await Promise.all([
      supabase.from("tenants").select("id, nome").order("nome"),
      supabase.from("ad_account_mappings").select("*").order("created_at", { ascending: false }),
      supabase.from("unrouted_leads").select("*").eq("resolved", false).order("received_at", { ascending: false }).limit(100),
    ]);
    setTenants((t.data as any) ?? []);
    setMappings((m.data as any) ?? []);
    setUnrouted((u.data as any) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openNew = () => {
    setEditing(null);
    setForm({ ...emptyForm });
    setFormInput(""); setCampInput("");
    setOpen(true);
  };
  const openEdit = (m: Mapping) => {
    setEditing(m);
    setForm({
      tenant_id: m.tenant_id,
      label: m.label ?? "",
      facebook_ad_account_id: m.facebook_ad_account_id ?? "",
      facebook_page_id: m.facebook_page_id ?? "",
      lead_form_ids: m.lead_form_ids ?? [],
      campaign_ids: m.campaign_ids ?? [],
      is_active: m.is_active,
    });
    setFormInput(""); setCampInput("");
    setOpen(true);
  };

  const save = async () => {
    if (!form.tenant_id) return toast.error("Selecione a clínica.");
    const payload = {
      tenant_id: form.tenant_id,
      label: form.label || null,
      facebook_ad_account_id: form.facebook_ad_account_id || null,
      facebook_page_id: form.facebook_page_id || null,
      lead_form_ids: form.lead_form_ids,
      campaign_ids: form.campaign_ids,
      is_active: form.is_active,
    };
    const q = editing
      ? supabase.from("ad_account_mappings").update(payload).eq("id", editing.id)
      : supabase.from("ad_account_mappings").insert(payload);
    const { error } = await q;
    if (error) return toast.error(error.message);
    toast.success(editing ? "Mapeamento atualizado" : "Mapeamento criado");
    setOpen(false); load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remover este mapeamento?")) return;
    const { error } = await supabase.from("ad_account_mappings").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removido"); load();
  };

  const tenantName = (id: string) => tenants.find(t => t.id === id)?.nome ?? "—";

  const routeManually = async () => {
    if (!routeOpen || !routeTenant) return;
    const u = routeOpen;
    // 1) cria o lead no tenant escolhido
    const { data: lead, error: lErr } = await supabase.from("leads").insert({
      nome_completo: u.nome ?? "Lead Facebook Ads",
      whatsapp: u.whatsapp ?? "",
      email: u.email,
      status: "lead",
      origem: "facebook_ads",
      revendedor_iniciante: false,
      facebook_lead_id: u.facebook_lead_id,
      facebook_form_id: u.form_id,
      tenant_id: routeTenant,
    } as any).select("id").single();
    if (lErr) return toast.error("Erro ao criar lead: " + lErr.message);

    // 2) cria mapeamento automático para próximos leads (form_id → tenant)
    if (u.form_id) {
      const existing = mappings.find(
        m => m.tenant_id === routeTenant && (m.lead_form_ids ?? []).includes(u.form_id!),
      );
      if (!existing) {
        // procura mapeamento do tenant p/ anexar o form
        const own = mappings.find(m => m.tenant_id === routeTenant);
        if (own) {
          await supabase.from("ad_account_mappings")
            .update({ lead_form_ids: Array.from(new Set([...(own.lead_form_ids ?? []), u.form_id])) })
            .eq("id", own.id);
        } else {
          await supabase.from("ad_account_mappings").insert({
            tenant_id: routeTenant,
            label: `Auto — ${tenantName(routeTenant)}`,
            lead_form_ids: [u.form_id],
            facebook_page_id: u.page_id,
            facebook_ad_account_id: u.ad_account_id,
          } as any);
        }
      }
    }

    // 3) marca como resolvido
    await supabase.from("unrouted_leads").update({
      resolved: true,
      resolved_tenant_id: routeTenant,
      resolved_at: new Date().toISOString(),
    }).eq("id", u.id);


    toast.success("Lead roteado e mapeamento salvo para próximos");
    setRouteOpen(null); setRouteTenant(""); load();
  };

  const addFormId = () => {
    const v = formInput.trim();
    if (!v) return;
    setForm(f => ({ ...f, lead_form_ids: Array.from(new Set([...f.lead_form_ids, v])) }));
    setFormInput("");
  };
  const addCampId = () => {
    const v = campInput.trim();
    if (!v) return;
    setForm(f => ({ ...f, campaign_ids: Array.from(new Set([...f.campaign_ids, v])) }));
    setCampInput("");
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Meta Ads — Roteamento por Tenant</h1>
          <p className="text-sm text-muted-foreground">
            Vincule contas de anúncios, páginas e formulários do Facebook a cada clínica.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Atualizar
          </Button>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" /> Novo Mapeamento</Button>
        </div>
      </div>

      {unrouted.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-500 flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4" /> {unrouted.length} lead(s) sem tenant mapeado
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Roteie manualmente abaixo — ao salvar, criamos o mapeamento para automatizar os próximos.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Mapeamentos ativos ({mappings.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr className="border-b">
                  <th className="text-left py-2 px-2">Clínica</th>
                  <th className="text-left py-2 px-2">Rótulo</th>
                  <th className="text-left py-2 px-2">Page ID</th>
                  <th className="text-left py-2 px-2">Ad Account</th>
                  <th className="text-left py-2 px-2">Forms</th>
                  <th className="text-left py-2 px-2">Status</th>
                  <th className="text-right py-2 px-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map(m => (
                  <tr key={m.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 px-2 font-medium">{tenantName(m.tenant_id)}</td>
                    <td className="py-2 px-2">{m.label ?? "—"}</td>
                    <td className="py-2 px-2 font-mono text-xs">{m.facebook_page_id ?? "—"}</td>
                    <td className="py-2 px-2 font-mono text-xs">{m.facebook_ad_account_id ?? "—"}</td>
                    <td className="py-2 px-2">{(m.lead_form_ids ?? []).length} form(s)</td>
                    <td className="py-2 px-2">
                      {m.is_active
                        ? <Badge className="bg-emerald-500/20 text-emerald-500">Ativo</Badge>
                        : <Badge variant="secondary">Inativo</Badge>}
                    </td>
                    <td className="py-2 px-2 text-right">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(m)}>Editar</Button>
                      <Button size="sm" variant="ghost" onClick={() => remove(m.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {!mappings.length && (
                  <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Nenhum mapeamento ainda.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Leads não roteados ({unrouted.length})</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground uppercase">
                <tr className="border-b">
                  <th className="text-left py-2 px-2">Recebido</th>
                  <th className="text-left py-2 px-2">Nome</th>
                  <th className="text-left py-2 px-2">Form ID</th>
                  <th className="text-left py-2 px-2">Ad Account</th>
                  <th className="text-left py-2 px-2">Page ID</th>
                  <th className="text-right py-2 px-2">Ação</th>
                </tr>
              </thead>
              <tbody>
                {unrouted.map(u => (
                  <tr key={u.id} className="border-b hover:bg-muted/30">
                    <td className="py-2 px-2 text-xs">{new Date(u.received_at).toLocaleString("pt-BR")}</td>
                    <td className="py-2 px-2">{u.nome ?? "—"}</td>
                    <td className="py-2 px-2 font-mono text-xs">{u.form_id ?? "—"}</td>
                    <td className="py-2 px-2 font-mono text-xs">{u.ad_account_id ?? "—"}</td>
                    <td className="py-2 px-2 font-mono text-xs">{u.page_id ?? "—"}</td>
                    <td className="py-2 px-2 text-right">
                      <Button size="sm" onClick={() => { setRouteOpen(u); setRouteTenant(""); }}>
                        Rotear manualmente
                      </Button>
                    </td>
                  </tr>
                ))}
                {!unrouted.length && (
                  <tr><td colSpan={6} className="py-8 text-center text-muted-foreground">Nenhum lead pendente. 🎉</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Modal mapping */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar" : "Novo"} Mapeamento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Clínica (tenant)</Label>
              <Select value={form.tenant_id} onValueChange={(v) => setForm(f => ({ ...f, tenant_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Rótulo</Label>
              <Input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="Ex: Dr. Alessandro — Transplante" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Page ID</Label>
                <Input value={form.facebook_page_id} onChange={e => setForm(f => ({ ...f, facebook_page_id: e.target.value }))} />
              </div>
              <div>
                <Label>Ad Account ID</Label>
                <Input value={form.facebook_ad_account_id} onChange={e => setForm(f => ({ ...f, facebook_ad_account_id: e.target.value }))} placeholder="act_..." />
              </div>
            </div>
            <div>
              <Label>Formulários (form_id)</Label>
              <div className="flex gap-2">
                <Input value={formInput} onChange={e => setFormInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addFormId())} placeholder="form_id" />
                <Button type="button" onClick={addFormId}>Adicionar</Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {form.lead_form_ids.map(id => (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {id}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setForm(f => ({ ...f, lead_form_ids: f.lead_form_ids.filter(x => x !== id) }))} />
                  </Badge>
                ))}
              </div>
            </div>
            <div>
              <Label>Campanhas (opcional)</Label>
              <div className="flex gap-2">
                <Input value={campInput} onChange={e => setCampInput(e.target.value)} onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addCampId())} placeholder="campaign_id" />
                <Button type="button" onClick={addCampId}>Adicionar</Button>
              </div>
              <div className="flex flex-wrap gap-1 mt-2">
                {form.campaign_ids.map(id => (
                  <Badge key={id} variant="secondary" className="gap-1">
                    {id}
                    <X className="h-3 w-3 cursor-pointer" onClick={() => setForm(f => ({ ...f, campaign_ids: f.campaign_ids.filter(x => x !== id) }))} />
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm(f => ({ ...f, is_active: v }))} />
              <Label>Ativo</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={save}>Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal roteamento manual */}
      <Dialog open={!!routeOpen} onOpenChange={(o) => !o && setRouteOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Rotear lead para clínica</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div><strong>Nome:</strong> {routeOpen?.nome ?? "—"}</div>
            <div><strong>WhatsApp:</strong> {routeOpen?.whatsapp ?? "—"}</div>
            <div><strong>Form ID:</strong> <span className="font-mono">{routeOpen?.form_id ?? "—"}</span></div>
            <div>
              <Label>Enviar para clínica</Label>
              <Select value={routeTenant} onValueChange={setRouteTenant}>
                <SelectTrigger><SelectValue placeholder="Selecione…" /></SelectTrigger>
                <SelectContent>
                  {tenants.map(t => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              Ao salvar, criamos automaticamente o mapeamento <span className="font-mono">form_id → tenant</span> para os próximos leads.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRouteOpen(null)}>Cancelar</Button>
            <Button onClick={routeManually} disabled={!routeTenant}>Rotear e salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
