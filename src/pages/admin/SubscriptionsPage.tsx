import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Pencil, CreditCard, Ban, RefreshCw, CheckCircle2, XCircle, FileText, Sparkles, Layers, PlayCircle } from "lucide-react";
import { toast } from "sonner";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment, paymentsTokenAvailable } from "@/lib/stripe";

interface Plan {
  id: string; code: string; interval: string; name: string; description: string | null;
  amount_cents: number; currency: string; lookup_key: string; active: boolean;
  stripe_price_id: string | null; stripe_product_id: string | null; sort_order: number;
}
interface Tenant { id: string; slug: string; name: string; plan: string; status: string }
interface Sub {
  id: string; tenant_id: string; plan_code: string; interval: string; lookup_key: string | null;
  status: string; current_period_end: string | null; cancel_at_period_end: boolean;
  amount_cents: number | null; currency: string | null; stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
}
interface Invoice {
  id: string; tenant_id: string | null; amount_paid_cents: number | null; currency: string | null;
  status: string | null; paid_at: string | null; hosted_invoice_url: string | null;
  period_start: string | null; period_end: string | null;
}

const BRL = (cents: number, cur = "brl") =>
  ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: (cur || "brl").toUpperCase() });

const STATUS_BADGE: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
  trialing: "bg-sky-500/15 text-sky-300 border border-sky-500/30",
  past_due: "bg-amber-500/15 text-amber-300 border border-amber-500/30",
  canceled: "bg-rose-500/15 text-rose-300 border border-rose-500/30",
  incomplete: "bg-slate-500/15 text-slate-300 border border-slate-500/30",
  paused: "bg-violet-500/15 text-violet-300 border border-violet-500/30",
};

export default function SubscriptionsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const [editPlan, setEditPlan] = useState<Plan | null>(null);
  const [planAmount, setPlanAmount] = useState("");
  const [savingPlan, setSavingPlan] = useState(false);

  const [actionTenant, setActionTenant] = useState<Tenant | null>(null);
  const [selectedLookupKey, setSelectedLookupKey] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    const [planRes, tenantRes, subRes, invRes] = await Promise.all([
      supabase.from("plan_catalog").select("*").order("sort_order"),
      supabase.from("tenants").select("id,slug,name,plan,status").order("name"),
      supabase.from("subscriptions").select("*").order("created_at", { ascending: false }),
      supabase.from("subscription_invoices").select("*").order("paid_at", { ascending: false, nullsFirst: false }).limit(100),
    ]);
    setPlans((planRes.data || []) as Plan[]);
    setTenants((tenantRes.data || []) as Tenant[]);
    setSubs((subRes.data || []) as Sub[]);
    setInvoices((invRes.data || []) as Invoice[]);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, []);

  // Active sub per tenant (most recent)
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

  // ─── PLAN CATALOG ACTIONS ────────────────────────────────────────────
  const openEditPlan = (p: Plan) => {
    setEditPlan(p);
    setPlanAmount((p.amount_cents / 100).toString());
  };
  const savePlanPrice = async () => {
    if (!editPlan) return;
    const value = Number(planAmount.replace(",", "."));
    if (!isFinite(value) || value <= 0) { toast.error("Valor inválido"); return; }
    setSavingPlan(true);
    // Bump lookup_key version so a new Stripe Price is created on next checkout/change.
    const baseKey = editPlan.lookup_key.replace(/_v\d+$/, "");
    const m = editPlan.lookup_key.match(/_v(\d+)$/);
    const nextVer = m ? Number(m[1]) + 1 : 2;
    const newLookupKey = `${baseKey}_v${nextVer}`;
    const { error } = await supabase.from("plan_catalog").update({
      amount_cents: Math.round(value * 100),
      lookup_key: newLookupKey,
      stripe_price_id: null,        // force recreation on next ensureStripePriceForPlan
    }).eq("id", editPlan.id);
    setSavingPlan(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Plano atualizado. Próximas cobranças usarão o novo valor.");
    setEditPlan(null);
    refresh();
  };

  // ─── SUBSCRIPTION ACTIONS ────────────────────────────────────────────
  const openTenantActions = (t: Tenant) => {
    setActionTenant(t);
    const current = subByTenant.get(t.id);
    setSelectedLookupKey(current?.lookup_key || "");
  };

  const startCheckout = async () => {
    if (!actionTenant || !selectedLookupKey) return;
    if (!paymentsTokenAvailable()) { toast.error("Token Stripe não configurado"); return; }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("subscription-checkout", {
      body: {
        tenant_id: actionTenant.id,
        lookup_key: selectedLookupKey,
        environment: getStripeEnvironment(),
        return_url: `${window.location.origin}/admin/planos?session={CHECKOUT_SESSION_ID}`,
      },
    });
    setBusy(false);
    if (error || !data?.clientSecret) { toast.error(error?.message || "Falha ao iniciar checkout"); return; }
    setClientSecret(data.clientSecret);
    setCheckoutOpen(true);
  };

  const changePlanDirect = async () => {
    if (!actionTenant || !selectedLookupKey) return;
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("subscription-change-plan", {
      body: { action: "change_plan", tenant_id: actionTenant.id, lookup_key: selectedLookupKey, environment: getStripeEnvironment() },
    });
    setBusy(false);
    if (error) {
      const msg = (error as any)?.context?.error || error.message || "Erro";
      if (msg.includes("no_active_subscription")) {
        toast.error("Esta clínica ainda não tem assinatura ativa — use o checkout para iniciar.");
      } else toast.error(msg);
      return;
    }
    toast.success("Plano alterado. Atualizando…");
    setActionTenant(null);
    setTimeout(refresh, 1500);
  };

  const cancelSub = async (atPeriodEnd = true) => {
    if (!actionTenant) return;
    if (!confirm(atPeriodEnd ? "Cancelar ao final do período atual?" : "Cancelar imediatamente?")) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("subscription-change-plan", {
      body: { action: "cancel", tenant_id: actionTenant.id, environment: getStripeEnvironment(), at_period_end: atPeriodEnd },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Cancelamento agendado");
    setTimeout(refresh, 1200);
  };

  const reactivate = async () => {
    if (!actionTenant) return;
    setBusy(true);
    const { error } = await supabase.functions.invoke("subscription-change-plan", {
      body: { action: "reactivate", tenant_id: actionTenant.id, environment: getStripeEnvironment() },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Reativado");
    setTimeout(refresh, 1000);
  };

  const syncSub = async (tenantId: string) => {
    const { error } = await supabase.functions.invoke("subscription-change-plan", {
      body: { action: "sync", tenant_id: tenantId, environment: getStripeEnvironment() },
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Sincronizado");
    refresh();
  };

  const closeCheckout = () => {
    setCheckoutOpen(false);
    setClientSecret(null);
    setActionTenant(null);
    setTimeout(refresh, 2000);
  };

  return (
    <div className="min-h-screen">
      <PaymentTestModeBanner />
      <div className="p-4 md:p-8 max-w-[1500px] mx-auto space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-300/70 font-mono">Admin Master · POSION</div>
            <h1 className="text-3xl font-bold tracking-tight mt-1">Planos & Cobranças</h1>
            <p className="text-muted-foreground text-sm">Edite valores dos planos, atribua e gerencie assinaturas Stripe das clínicas clientes.</p>
          </div>
          <Button variant="outline" onClick={refresh} className="gap-2">
            <RefreshCw className="w-4 h-4" /> Atualizar
          </Button>
        </div>

        <Tabs defaultValue="tenants">
          <TabsList className="bg-[#0B1224] border border-white/10">
            <TabsTrigger value="tenants" className="gap-2"><Layers className="w-4 h-4" /> Clínicas</TabsTrigger>
            <TabsTrigger value="catalog" className="gap-2"><Sparkles className="w-4 h-4" /> Catálogo</TabsTrigger>
            <TabsTrigger value="invoices" className="gap-2"><FileText className="w-4 h-4" /> Faturas</TabsTrigger>
          </TabsList>

          {/* ─── TENANTS / ASSINATURAS ─── */}
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
                        <TableHead>Plano atual</TableHead>
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
                              {sub ? (
                                <Badge className={STATUS_BADGE[sub.status] || ""}>{sub.status}</Badge>
                              ) : <Badge variant="outline">—</Badge>}
                              {sub?.cancel_at_period_end && (
                                <div className="text-[10px] text-amber-400 mt-1">cancela ao final</div>
                              )}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                              {sub?.current_period_end ? new Date(sub.current_period_end).toLocaleDateString("pt-BR") : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-2">
                                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openTenantActions(t)}>
                                  <CreditCard className="w-3.5 h-3.5" /> Gerenciar
                                </Button>
                                {sub?.stripe_subscription_id && (
                                  <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => syncSub(t.id)} title="Sincronizar com Stripe">
                                    <RefreshCw className="w-3.5 h-3.5" />
                                  </Button>
                                )}
                              </div>
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

          {/* ─── CATÁLOGO DE PLANOS (EDITÁVEL) ─── */}
          <TabsContent value="catalog" className="mt-4">
            <Card className="bg-[#0E1730] border-white/10">
              <CardHeader>
                <CardTitle className="text-base">Catálogo POSION</CardTitle>
                <p className="text-xs text-muted-foreground">Alterar um valor cria um novo preço no Stripe; clientes existentes continuam no valor anterior até serem migrados.</p>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plano</TableHead>
                      <TableHead>Ciclo</TableHead>
                      <TableHead>Valor</TableHead>
                      <TableHead>Lookup key</TableHead>
                      <TableHead>Stripe Price</TableHead>
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
                          {p.stripe_price_id ? (
                            <span className="text-emerald-300 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> sincronizado</span>
                          ) : (
                            <span className="text-amber-300 inline-flex items-center gap-1"><PlayCircle className="w-3 h-3" /> criado no 1º uso</span>
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

          {/* ─── HISTÓRICO DE FATURAS ─── */}
          <TabsContent value="invoices" className="mt-4">
            <Card className="bg-[#0E1730] border-white/10">
              <CardHeader><CardTitle className="text-base">Últimas faturas</CardTitle></CardHeader>
              <CardContent className="p-0">
                {invoices.length === 0 ? (
                  <div className="p-10 text-center text-sm text-muted-foreground">Nenhuma fatura registrada ainda.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Clínica</TableHead>
                        <TableHead>Período</TableHead>
                        <TableHead>Valor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Fatura</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => {
                        const t = tenants.find((x) => x.id === inv.tenant_id);
                        return (
                          <TableRow key={inv.id}>
                            <TableCell className="text-xs">{inv.paid_at ? new Date(inv.paid_at).toLocaleString("pt-BR") : "—"}</TableCell>
                            <TableCell>{t?.name || <span className="text-muted-foreground italic">—</span>}</TableCell>
                            <TableCell className="text-xs">
                              {inv.period_start && inv.period_end
                                ? `${new Date(inv.period_start).toLocaleDateString("pt-BR")} → ${new Date(inv.period_end).toLocaleDateString("pt-BR")}`
                                : "—"}
                            </TableCell>
                            <TableCell className="tabular-nums">{BRL(inv.amount_paid_cents || 0, inv.currency || "brl")}</TableCell>
                            <TableCell>
                              <Badge className={inv.status === "paid" ? STATUS_BADGE.active : STATUS_BADGE.past_due}>
                                {inv.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {inv.hosted_invoice_url && (
                                <a className="text-primary hover:underline text-xs" href={inv.hosted_invoice_url} target="_blank" rel="noreferrer">
                                  Abrir →
                                </a>
                              )}
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
        </Tabs>
      </div>

      {/* ─── DIALOG: editar valor do plano ─── */}
      <Dialog open={!!editPlan} onOpenChange={(v) => !v && setEditPlan(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar valor — {editPlan?.name}</DialogTitle>
            <DialogDescription>
              Um novo preço será criado no Stripe na próxima cobrança ou checkout. Assinaturas atuais permanecem no valor anterior até serem migradas.
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

      {/* ─── DIALOG: gerenciar assinatura do tenant ─── */}
      <Dialog open={!!actionTenant && !checkoutOpen} onOpenChange={(v) => !v && setActionTenant(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Assinatura — {actionTenant?.name}</DialogTitle>
            <DialogDescription>
              {subByTenant.get(actionTenant?.id || "")?.stripe_subscription_id
                ? "Altere o plano (com proração) ou cancele a assinatura."
                : "Nenhuma assinatura ativa. Inicie via checkout para capturar o cartão."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
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

            {actionTenant && (() => {
              const sub = subByTenant.get(actionTenant.id);
              const tenantInvoices = invoicesByTenant.get(actionTenant.id) || [];
              return (
                <div className="space-y-3 text-sm">
                  {sub && (
                    <div className="rounded-lg bg-white/5 border border-white/10 p-3 space-y-1">
                      <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge className={STATUS_BADGE[sub.status]}>{sub.status}</Badge></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Próxima cobrança</span><span>{sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString("pt-BR") : "—"}</span></div>
                      {sub.stripe_subscription_id && <div className="flex justify-between"><span className="text-muted-foreground">Stripe</span><span className="font-mono text-[10px]">{sub.stripe_subscription_id}</span></div>}
                    </div>
                  )}
                  {tenantInvoices.length > 0 && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1">Últimas faturas</div>
                      <div className="space-y-1 max-h-32 overflow-y-auto">
                        {tenantInvoices.slice(0, 5).map((inv) => (
                          <div key={inv.id} className="flex justify-between text-xs px-2 py-1 rounded bg-white/5">
                            <span>{inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("pt-BR") : "—"}</span>
                            <span className="tabular-nums">{BRL(inv.amount_paid_cents || 0, inv.currency || "brl")}</span>
                            <Badge className={inv.status === "paid" ? STATUS_BADGE.active : STATUS_BADGE.past_due}>{inv.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            {(() => {
              const sub = actionTenant ? subByTenant.get(actionTenant.id) : null;
              const hasActive = !!sub?.stripe_subscription_id && sub.status !== "canceled";
              return (
                <>
                  {hasActive ? (
                    <>
                      {sub?.cancel_at_period_end ? (
                        <Button variant="outline" onClick={reactivate} disabled={busy} className="gap-2">
                          <CheckCircle2 className="w-4 h-4" /> Reativar
                        </Button>
                      ) : (
                        <Button variant="outline" onClick={() => cancelSub(true)} disabled={busy} className="gap-2 text-amber-300">
                          <Ban className="w-4 h-4" /> Cancelar
                        </Button>
                      )}
                      <Button onClick={changePlanDirect} disabled={busy || !selectedLookupKey} className="gap-2">
                        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Alterar plano
                      </Button>
                    </>
                  ) : (
                    <Button onClick={startCheckout} disabled={busy || !selectedLookupKey} className="gap-2">
                      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />} Iniciar assinatura
                    </Button>
                  )}
                </>
              );
            })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── EMBEDDED CHECKOUT ─── */}
      <Dialog open={checkoutOpen} onOpenChange={(v) => !v && closeCheckout()}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cadastro de pagamento — {actionTenant?.name}</DialogTitle>
            <DialogDescription>O cartão informado ficará vinculado à clínica para cobranças recorrentes.</DialogDescription>
          </DialogHeader>
          {clientSecret && (
            <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret: async () => clientSecret }}>
              <EmbeddedCheckout />
            </EmbeddedCheckoutProvider>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
