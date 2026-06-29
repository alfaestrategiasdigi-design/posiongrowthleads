import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Pencil, CreditCard, Ban, RefreshCw, CheckCircle2, FileText, Sparkles, Layers, ExternalLink, Copy, Settings2, ShieldCheck, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface Plan {
  id: string; code: string; interval: string; name: string; description: string | null;
  amount_cents: number; currency: string; lookup_key: string; active: boolean;
  mp_preapproval_plan_id: string | null; mp_reason: string | null; sort_order: number;
}
interface Tenant { id: string; slug: string; name: string; plan: string; status: string }
interface Sub {
  id: string; tenant_id: string; plan_code: string; interval: string; lookup_key: string | null;
  status: string; current_period_end: string | null; cancel_at_period_end: boolean;
  amount_cents: number | null; currency: string | null;
  mp_preapproval_id: string | null; mp_payer_email: string | null; mp_init_point: string | null;
}
interface Invoice {
  id: string; tenant_id: string | null; amount_paid_cents: number | null; currency: string | null;
  status: string | null; paid_at: string | null; receipt_url: string | null;
  period_start: string | null; period_end: string | null; mp_payment_id: string | null;
}
interface MpConfig {
  account_email: string | null; account_id: string | null; account_site: string | null;
  webhook_url: string | null; last_validated_at: string | null;
  last_validation_result: any;
}

const BRL = (cents: number, cur = "brl") =>
  ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: (cur || "brl").toUpperCase() });

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  authorized: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  approved: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  pending: "bg-sky-500/15 text-sky-300 border border-sky-500/30",
  paused: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  cancelled: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
  canceled: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
  rejected: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
};

export default function SubscriptionsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [mpConfig, setMpConfig] = useState<MpConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [planAmount, setPlanAmount] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);

  const [actionTenant, setActionTenant] = useState<Tenant | null>(null);
  const [selectedLookupKey, setSelectedLookupKey] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [validating, setValidating] = useState(false);

  const refresh = async () => {
    setLoading(true);
    const [planRes, tenantRes, subRes, invRes, cfgRes] = await Promise.all([
      supabase.from("plan_catalog").select("*").order("sort_order"),
      supabase.from("tenants").select("id,slug,name,plan,status").order("name"),
      supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
      supabase.from("subscription_invoices").select("*").order("paid_at", { ascending: false, nullsFirst: false }).limit(100),
      supabase.from("payment_provider_config").select("*").eq("provider", "mercadopago").maybeSingle(),
    ]);
    setPlans((planRes.data || []) as Plan[]);
    setTenants((tenantRes.data || []) as Tenant[]);
    setSubs((subRes.data || []) as Sub[]);
    setInvoices((invRes.data || []) as Invoice[]);
    setMpConfig((cfgRes.data as any) || null);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  const subByTenant = useMemo(() => {
    const map = new Map<string, Sub>();
    for (const s of subs) if (!map.has(s.tenant_id)) map.set(s.tenant_id, s);
    return map;
  }, [subs]);

  const invoicesByTenant = useMemo(() => {
    const map = new Map<string, Invoice[]>();
    for (const inv of invoices) {
      if (!inv.tenant_id) continue;
      if (!map.has(inv.tenant_id)) map.set(inv.tenant_id, []);
      map.get(inv.tenant_id)!.push(inv);
    }
    return map;
  }, [invoices]);

  // ── Plan catalog ────────────────────────────────────────────────
  const openEditPlan = (p: Plan) => {
    setEditPlan(p);
    setPlanAmount((p.amount_cents / 100).toString());
  };
  const savePlanPrice = async () => {
    if (!editPlan) return;
    const value = Number(planAmount.replace(",", "."));
    if (!isFinite(value) || value <= 0) { toast.error("Valor inválido"); return; }
    setSavingPlan(true);
    // Force new MP preapproval plan creation on next checkout
    const baseKey = editPlan.lookup_key.replace(/_v\d+$/, "");
    const m = editPlan.lookup_key.match(/_v(\d+)$/);
    const nextVer = m ? Number(m[1]) + 1 : 2;
    const newLookupKey = `${baseKey}_v${nextVer}`;
    const { error } = await supabase.from("plan_catalog").update({
      amount_cents: Math.round(value * 100),
      lookup_key: newLookupKey,
      mp_preapproval_plan_id: null,
    }).eq("id", editPlan.id);
    setSavingPlan(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Plano atualizado. Próximas assinaturas usarão o novo valor.");
    setEditPlan(null);
    refresh();
  };

  // ── Subscription actions ────────────────────────────────────────
  const openTenantActions = (t: Tenant) => {
    setActionTenant(t);
    const current = subByTenant.get(t.id);
    setSelectedLookupKey(current?.lookup_key || "");
  };

  const startCheckout = async () => {
    if (!actionTenant || !selectedLookupKey) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("mp-subscription-checkout", {
      body: {
        tenant_id: actionTenant.id,
        lookup_key: selectedLookupKey,
        back_url: `${window.location.origin}/admin/planos?mp=success`,
      },
    });
    setBusy(false);
    if (error || !(data as any)?.init_point) {
      const msg = (error as any)?.context?.error || (error as any)?.message || "Falha ao gerar checkout";
      toast.error(msg);
      return;
    }
    window.open((data as any).init_point, "_blank", "noopener");
    toast.success("Checkout aberto em nova aba");
    setActionTenant(null);
    setTimeout(refresh, 1500);
  };

  const cancelSub = async () => {
    if (!actionTenant) return;
    const sub = subByTenant.get(actionTenant.id);
    if (!sub?.mp_preapproval_id) { toast.error("Assinatura sem ID do Mercado Pago"); return; }
    if (!confirm("Cancelar a assinatura agora?")) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("mp-cancel", {
      body: { preapproval_id: sub.mp_preapproval_id, action: "cancel" },
    });
    setBusy(false);
    if (error) { toast.error((error as any).message); return; }
    toast.success("Assinatura cancelada");
    setActionTenant(null);
    setTimeout(refresh, 1200);
  };

  const togglePause = async (resume: boolean) => {
    if (!actionTenant) return;
    const sub = subByTenant.get(actionTenant.id);
    if (!sub?.mp_preapproval_id) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("mp-cancel", {
      body: { preapproval_id: sub.mp_preapproval_id, action: resume ? "resume" : "pause" },
    });
    setBusy(false);
    if (error) { toast.error((error as any).message); return; }
    toast.success(resume ? "Reativada" : "Pausada");
    setTimeout(refresh, 1000);
  };

  // ── MP config ───────────────────────────────────────────────────
  const validateMp = async () => {
    setValidating(true);
    const { data, error } = await supabase.functions.invoke("mp-validate", { body: {} });
    setValidating(false);
    if (error || !(data as any)?.ok) {
      toast.error((data as any)?.error || (error as any)?.message || "Falha na validação");
    } else {
      toast.success("Mercado Pago conectado");
    }
    refresh();
  };

  const savePublicKey = async (pk: string) => {
    const v = pk.trim();
    if (v && !/^(APP_USR-|TEST-)/.test(v)) {
      toast.error("Public key deve começar com APP_USR- ou TEST-");
      return;
    }
    const { error } = await supabase.from("payment_provider_config")
      .upsert({ provider: "mercadopago", public_key: v || null }, { onConflict: "provider" });
    if (error) { toast.error(error.message); return; }
    toast.success("Public key salva");
    refresh();
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copiado`);
  };

  const activeSubs = subs.filter((s) => ["active", "authorized"].includes(s.status));
  const mrr = activeSubs.reduce((acc, s) => {
    const monthly = s.interval === "quarter" ? (s.amount_cents || 0) / 3 : (s.amount_cents || 0);
    return acc + monthly;
  }, 0);

  return (
    <div className="min-h-screen">
      <div className="p-4 md:p-8 max-w-[1500px] mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-300/70 font-mono">Admin Master · POSION</div>
            <h1 className="text-3xl font-bold tracking-tight mt-1">Planos & Cobranças</h1>
            <p className="text-muted-foreground text-sm">Gerencie planos, assinaturas e a integração com Mercado Pago.</p>
          </div>
          <div className="flex gap-2">
            <div className="px-4 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
              <div className="text-[10px] uppercase tracking-wider text-emerald-300/80">MRR (ativos)</div>
              <div className="font-bold text-lg tabular-nums">{BRL(mrr)}</div>
            </div>
            <Button variant="outline" onClick={refresh} className="gap-2">
              <RefreshCw className="w-4 h-4" /> Atualizar
            </Button>
          </div>
        </div>

        <Tabs defaultValue="tenants">
          <TabsList className="bg-[#0B1224] border border-white/10">
            <TabsTrigger value="tenants" className="gap-2"><Layers className="w-4 h-4" /> Clínicas</TabsTrigger>
            <TabsTrigger value="catalog" className="gap-2"><Sparkles className="w-4 h-4" /> Catálogo</TabsTrigger>
            <TabsTrigger value="invoices" className="gap-2"><FileText className="w-4 h-4" /> Faturas</TabsTrigger>
            <TabsTrigger value="mercadopago" className="gap-2"><Settings2 className="w-4 h-4" /> Mercado Pago</TabsTrigger>
          </TabsList>

          {/* ─── TENANTS ─── */}
          <TabsContent value="tenants" className="mt-4">
            <Card className="bg-[#0E1730] border-white/10">
              <CardHeader><CardTitle className="text-base">Assinaturas por clínica</CardTitle></CardHeader>
              <CardContent className="p-0">
                {loading ? (
                  <div className="p-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Clínica</TableHead>
                        <TableHead>Plano</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Próxima cobrança</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tenants.map((t) => {
                        const sub = subByTenant.get(t.id);
                        return (
                          <TableRow key={t.id}>
                            <TableCell>
                              <div className="font-medium">{t.name}</div>
                              <div className="text-xs text-muted-foreground font-mono">{t.slug}</div>
                            </TableCell>
                            <TableCell>
                              {sub ? (
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className="capitalize">{sub.plan_code}</Badge>
                                  <span className="text-xs text-muted-foreground">{sub.interval === "quarter" ? "trimestral" : "mensal"}</span>
                                </div>
                              ) : <span className="text-xs text-muted-foreground italic">sem assinatura</span>}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {sub?.amount_cents ? BRL(sub.amount_cents, sub.currency || "brl") : "—"}
                            </TableCell>
                            <TableCell>
                              {sub ? <Badge className={STATUS_BADGE[sub.status] || ""}>{sub.status}</Badge> : <Badge variant="outline">—</Badge>}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString("pt-BR") : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openTenantActions(t)}>
                                <CreditCard className="w-3.5 h-3.5" /> Gerenciar
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── CATALOG ─── */}
          <TabsContent value="catalog" className="mt-4">
            <Card className="bg-[#0E1730] border-white/10">
              <CardHeader>
                <CardTitle className="text-base">Catálogo POSION</CardTitle>
                <p className="text-xs text-muted-foreground">Alterar um valor cria um novo plano de assinatura no Mercado Pago; clientes existentes seguem no valor anterior até migrarem.</p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plano</TableHead>
                      <TableHead>Ciclo</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Lookup key</TableHead>
                      <TableHead>Plano MP</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {plans.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className="font-medium">{p.name}</div>
                          {p.description && <div className="text-xs text-muted-foreground">{p.description}</div>}
                        </TableCell>
                        <TableCell><Badge variant="outline">{p.interval === "quarter" ? "Trimestral" : "Mensal"}</Badge></TableCell>
                        <TableCell className="tabular-nums font-semibold">{BRL(p.amount_cents, p.currency)}</TableCell>
                        <TableCell className="font-mono text-[11px] text-muted-foreground">{p.lookup_key}</TableCell>
                        <TableCell className="font-mono text-[11px]">
                          {p.mp_preapproval_plan_id ? (
                            <span className="text-emerald-300 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {p.mp_preapproval_plan_id.slice(0, 12)}…</span>
                          ) : (
                            <span className="text-amber-300">criado no 1º checkout</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openEditPlan(p)}>
                            <Pencil className="w-3.5 h-3.5" /> Editar valor
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── INVOICES ─── */}
          <TabsContent value="invoices" className="mt-4">
            <Card className="bg-[#0E1730] border-white/10">
              <CardHeader><CardTitle className="text-base">Últimos pagamentos</CardTitle></CardHeader>
              <CardContent className="p-0">
                {invoices.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">Nenhum pagamento registrado.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Clínica</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Recibo</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => {
                        const t = tenants.find((x) => x.id === inv.tenant_id);
                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="text-xs">{inv.paid_at ? new Date(inv.paid_at).toLocaleString("pt-BR") : "—"}</TableCell>
                            <TableCell>{t?.name || <span className="text-muted-foreground italic">—</span>}</TableCell>
                            <TableCell className="tabular-nums">{BRL(inv.amount_paid_cents || 0, inv.currency || "brl")}</TableCell>
                            <TableCell>
                              <Badge className={STATUS_BADGE[inv.status || ""] || ""}>{inv.status}</Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {inv.receipt_url ? (
                                <a className="text-primary hover:underline text-xs inline-flex items-center gap-1" href={inv.receipt_url} target="_blank" rel="noreferrer">
                                  Abrir <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : "—"}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ─── MERCADO PAGO ─── */}
          <TabsContent value="mercadopago" className="mt-4">
            <MercadoPagoTab
              config={mpConfig}
              validating={validating}
              onValidate={validateMp}
              onSavePk={savePublicKey}
              onCopy={copy}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* edit plan */}
      <Dialog open={!!editPlan} onOpenChange={(v) => !v && setEditPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar valor — {editPlan?.name}</DialogTitle>
            <DialogDescription>
              Um novo plano de assinatura será criado no Mercado Pago no próximo checkout.
              Assinaturas existentes permanecem no valor anterior.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Label>Valor (R$)</Label>
            <Input value={planAmount} onChange={(e) => setPlanAmount(e.target.value)} type="number" step="0.01" min="0" />
            <p className="text-xs text-muted-foreground">Atual: {editPlan && BRL(editPlan.amount_cents, editPlan.currency)}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPlan(null)}>Cancelar</Button>
            <Button onClick={savePlanPrice} disabled={savingPlan} className="gap-2">
              {savingPlan && <Loader2 className="w-4 h-4 animate-spin" />} Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* tenant action */}
      <Dialog open={!!actionTenant} onOpenChange={(v) => !v && setActionTenant(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assinatura — {actionTenant?.name}</DialogTitle>
            <DialogDescription>
              {subByTenant.get(actionTenant?.id || "")?.mp_preapproval_id
                ? "Gerencie a assinatura ativa no Mercado Pago."
                : "Nenhuma assinatura. Inicie um checkout para gerar o link de cobrança."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {(() => {
              const sub = actionTenant ? subByTenant.get(actionTenant.id) : null;
              const tenantInvoices = actionTenant ? invoicesByTenant.get(actionTenant.id) || [] : [];
              return (
                <>
                  <div>
                    <Label>Plano</Label>
                    <Select value={selectedLookupKey} onValueChange={setSelectedLookupKey}>
                      <SelectTrigger><SelectValue placeholder="Escolha um plano" /></SelectTrigger>
                      <SelectContent>
                        {plans.filter((p) => p.active).map((p) => (
                          <SelectItem key={p.id} value={p.lookup_key}>
                            {p.name} — {BRL(p.amount_cents, p.currency)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {sub && (
                    <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-1 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge className={STATUS_BADGE[sub.status]}>{sub.status}</Badge></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Próxima cobrança</span><span>{sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString("pt-BR") : "—"}</span></div>
                      {sub.mp_preapproval_id && <div className="flex justify-between"><span className="text-muted-foreground">MP ID</span><span className="font-mono text-[10px]">{sub.mp_preapproval_id}</span></div>}
                      {sub.mp_init_point && (
                        <a className="text-primary hover:underline text-xs inline-flex items-center gap-1 mt-1" href={sub.mp_init_point} target="_blank" rel="noreferrer">
                          Link de pagamento <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}
                  {tenantInvoices.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Últimos pagamentos</div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {tenantInvoices.slice(0, 5).map((inv) => (
                          <div key={inv.id} className="flex justify-between text-xs px-2 py-1 rounded bg-white/5">
                            <span>{inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("pt-BR") : "—"}</span>
                            <span className="tabular-nums">{BRL(inv.amount_paid_cents || 0, inv.currency || "brl")}</span>
                            <Badge className={STATUS_BADGE[inv.status || ""] || ""}>{inv.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              );
            })()}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            {(() => {
              const sub = actionTenant ? subByTenant.get(actionTenant.id) : null;
              const hasActive = sub && ["authorized", "active"].includes(sub.status);
              const isPaused = sub?.status === "paused";
              return (
                <>
                  {hasActive && (
                    <>
                      <Button variant="outline" onClick={() => togglePause(false)} disabled={busy} className="gap-2">
                        <Ban className="w-4 h-4" /> Pausar
                      </Button>
                      <Button variant="outline" onClick={cancelSub} disabled={busy} className="gap-2 text-rose-300 border-rose-500/30">
                        <Ban className="w-4 h-4" /> Cancelar
                      </Button>
                    </>
                  )}
                  {isPaused && (
                    <Button variant="outline" onClick={() => togglePause(true)} disabled={busy} className="gap-2">
                      <CheckCircle2 className="w-4 h-4" /> Reativar
                    </Button>
                  )}
                  <Button onClick={startCheckout} disabled={busy || !selectedLookupKey} className="gap-2">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
                    {hasActive ? "Novo checkout (troca de plano)" : "Iniciar assinatura"}
                  </Button>
                </>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MercadoPagoTab({
  config, validating, onValidate, onSavePk, onCopy,
}: {
  config: MpConfig | null;
  validating: boolean;
  onValidate: () => void;
  onSavePk: (pk: string) => void;
  onCopy: (text: string, label: string) => void;
}) {
  const [pk, setPk] = useState(config?.public_key || "");
  useEffect(() => { setPk(config?.public_key || ""); }, [config?.public_key]);
  const connected = !!config?.account_id;
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card className="bg-[#0E1730] border-white/10">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" /> Conta Mercado Pago
          </CardTitle>
          <CardDescription>
            O Access Token de produção (APP_USR-…) está armazenado como segredo na nuvem.
            Para trocar o token, use o botão "Atualizar token" abaixo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {connected ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm space-y-1">
              <div className="flex items-center gap-2 text-emerald-300 font-medium">
                <CheckCircle2 className="w-4 h-4" /> Conectado
              </div>
              <div className="text-xs text-muted-foreground">Conta {config?.account_email} (#{config?.account_id}) — {config?.account_site}</div>
              {config?.last_validated_at && (
                <div className="text-[10px] text-muted-foreground">Validado em {new Date(config.last_validated_at).toLocaleString("pt-BR")}</div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-300 mt-0.5" />
              <div>Conta ainda não validada. Clique em "Testar conexão" para confirmar o Access Token.</div>
            </div>
          )}

          <Button onClick={onValidate} disabled={validating} className="gap-2 w-full">
            {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Testar conexão
          </Button>

          <div className="border-t border-white/5 pt-3 space-y-2">
            <Label>Public Key (opcional)</Label>
            <div className="flex gap-2">
              <Input value={pk} onChange={(e) => setPk(e.target.value)} placeholder="APP_USR-xxxxxxxx" className="font-mono text-xs" />
              <Button variant="outline" onClick={() => onSavePk(pk)}>Salvar</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Usada para Checkout Bricks futuro. O checkout atual (redirect) não precisa dela.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#0E1730] border-white/10">
        <CardHeader>
          <CardTitle className="text-base">Webhook</CardTitle>
          <CardDescription>
            No painel Mercado Pago → <strong>Suas integrações → Notificações</strong>, cole a URL abaixo
            (eventos: <code>preapproval</code>, <code>subscription_authorized_payment</code>, <code>payment</code>).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>URL do Webhook</Label>
            <div className="flex gap-2">
              <Input value={config?.webhook_url ? `${config.webhook_url}?secret=••••••` : "—"} readOnly className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => config?.webhook_url && onCopy(`${config.webhook_url}?secret=${getSecretPlaceholder()}`, "Webhook")}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              O parâmetro <code>?secret=</code> é o <code>MP_WEBHOOK_SECRET</code> guardado no servidor.
              Use o botão "Copiar URL completa" para colar no MP.
            </p>
            <Button variant="outline" className="w-full" onClick={async () => {
              const { data } = await supabase.functions.invoke("mp-validate", { body: {} });
              if ((data as any)?.webhook_url) {
                // The real secret is server-side; we expose it once via clipboard from server
                const url = `${(data as any).webhook_url}?secret=${(data as any).webhook_secret_hint || "use-MP_WEBHOOK_SECRET"}`;
                onCopy(url, "URL");
              }
            }}>
              Copiar URL (sem token)
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function getSecretPlaceholder() { return "MP_WEBHOOK_SECRET"; }

// Re-export supabase for handlers used inside child components
import { supabase as _sb } from "@/integrations/supabase/client";
