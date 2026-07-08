import { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { Check, Sparkles, Loader2, ShieldCheck, FileText, CreditCard, RefreshCw, ExternalLink, Clock, Lock, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const REFERENCE_MONTHLY_CENTS = 45000; // R$ 450/mês (valor de referência para ancoragem)

const PLAN_META = {
  tagline: "Tudo do POSION em um único plano — usuários ilimitados",
  features: [
    "Usuários ilimitados",
    "CRM Kanban sem limite de leads",
    "WhatsApp integrado",
    "Recall automatizado por WhatsApp",
    "Funil de avaliações + relatórios completos",
    "Integração com Meta Ads",
    "Agenda e prontuário",
    "Suporte prioritário",
  ],
};

const BRL = (cents: number, cur = "brl") =>
  ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: (cur || "brl").toUpperCase() });

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  active: { label: "Ativa", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  authorized: { label: "Ativa", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  pending: { label: "Aguardando pagamento", className: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  paused: { label: "Pausada", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  cancelled: { label: "Cancelada", className: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  canceled: { label: "Cancelada", className: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
};

interface Plan {
  id: string; code: string; interval: string; name: string; description: string | null;
  amount_cents: number; currency: string; lookup_key: string; active: boolean; sort_order: number;
}

export default function TenantPlans() {
  const { tenant, user } = useTenant();
  const [sub, setSub] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const refresh = async () => {
    if (!tenant?.id) return;
    setLoading(true);
    const [subRes, invRes, planRes] = await Promise.all([
      supabase.from("subscriptions").select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("subscription_invoices").select("*").eq("tenant_id", tenant.id).order("paid_at", { ascending: false, nullsFirst: false }).limit(10),
      supabase.from("plan_catalog").select("*").eq("active", true).order("sort_order"),
    ]);
    setSub(subRes.data);
    setInvoices(invRes.data || []);
    setPlans((planRes.data || []) as Plan[]);
    setLoading(false);
  };
  useEffect(() => { refresh(); }, [tenant?.id]);

  const planByInterval = useMemo(() => {
    const by: { month?: Plan; quarter?: Plan; semester?: Plan } = {};
    for (const p of plans) {
      if (p.interval === "month") by.month = p;
      else if (p.interval === "quarter") by.quarter = p;
      else if (p.interval === "semester") by.semester = p;
    }
    return by;
  }, [plans]);

  const startCheckout = async (lookup_key: string) => {
    if (!tenant?.id) return;
    setBusyKey(lookup_key);
    const { data, error } = await supabase.functions.invoke("mp-subscription-checkout", {
      body: {
        tenant_id: tenant.id,
        lookup_key,
        payer_email: user?.email,
        back_url: `${window.location.origin}/app/${tenant.slug}/planos?mp=success`,
      },
    });
    setBusyKey(null);
    if (error || !(data as any)?.init_point) {
      toast.error((error as any)?.message || (data as any)?.error || "Falha ao gerar checkout");
      return;
    }
    window.open((data as any).init_point, "_blank", "noopener");
    toast.success("Checkout aberto em nova aba do Mercado Pago");
    setTimeout(refresh, 3000);
  };

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const statusInfo = sub ? (STATUS_LABEL[sub.status] || { label: sub.status, className: "bg-slate-500/15 text-slate-300 border-slate-500/30" }) : null;
  const hasActiveSub = sub && ["active", "authorized", "pending", "paused"].includes(sub.status);

  const intervalLabel = (i?: string) =>
    i === "semester" ? "Semestral" : i === "quarter" ? "Trimestral" : "Mensal";
  const intervalUnit = (i?: string) =>
    i === "semester" ? "a cada 6 meses" : i === "quarter" ? "a cada 3 meses" : "por mês";
  const monthlyEquivalent = (cents: number, i?: string) => {
    const div = i === "semester" ? 6 : i === "quarter" ? 3 : 1;
    return cents / div;
  };

  return (
    <div className="min-h-screen">
      <div className="p-4 md:p-10 max-w-[1200px] mx-auto space-y-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80 font-mono">Plano POSION</div>
            <h1 className="font-display text-3xl md:text-4xl tracking-tight">
              Plano da <span className="gold-gradient-text">{tenant?.name ?? "sua clínica"}</span>
            </h1>
            <p className="text-muted-foreground text-sm max-w-2xl">
              POSION Pro — usuários ilimitados. Escolha Mensal, Trimestral ou Semestral e pague com cartão pelo Mercado Pago.
            </p>
          </div>
          <Button variant="outline" onClick={refresh} className="gap-2"><RefreshCw className="w-4 h-4" /> Atualizar</Button>
        </div>

        {hasActiveSub && (
          <Card className="bg-[#0E1730] border-primary/30">
            <CardHeader className="flex flex-row items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Sparkles className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-xl">POSION Pro {intervalLabel(sub.interval)}</CardTitle>
                  <p className="text-xs text-muted-foreground">{PLAN_META.tagline}</p>
                </div>
              </div>
              {statusInfo && <Badge className={`border ${statusInfo.className}`}>{statusInfo.label}</Badge>}
            </CardHeader>
            <CardContent className="grid sm:grid-cols-3 gap-4 pt-2 border-t border-white/5">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor</div>
                <div className="font-display text-2xl tabular-nums mt-1">{BRL(sub.amount_cents || 0, sub.currency || "brl")}</div>
                <div className="text-xs text-muted-foreground">{intervalUnit(sub.interval)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Próxima cobrança</div>
                <div className="font-display text-2xl mt-1">
                  {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString("pt-BR") : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Pagamento</div>
                <div className="font-display text-2xl mt-1">Mercado Pago</div>
                {sub.mp_init_point && sub.status === "pending" && (
                  <a className="text-primary text-xs inline-flex items-center gap-1 hover:underline" href={sub.mp_init_point} target="_blank" rel="noreferrer">
                    Concluir pagamento <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <TrialGate tenant={tenant as any}>
          <div>
            <h2 className="font-display text-xl mb-4">{hasActiveSub ? "Trocar de plano" : "Escolha seu compromisso"}</h2>

            <Card className="bg-[#0E1730] border-primary/30 relative overflow-hidden">
              <div className="absolute -top-2 left-6 text-[10px] uppercase tracking-widest bg-primary text-primary-foreground px-2 py-0.5 rounded">
                Plano único
              </div>
              <CardHeader className="pt-8">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                      <Sparkles className="w-6 h-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">POSION Pro</CardTitle>
                      <p className="text-sm text-muted-foreground">{PLAN_META.tagline}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Referência</div>
                    <div className="font-display text-2xl tabular-nums">
                      {BRL(REFERENCE_MONTHLY_CENTS)}<span className="text-sm text-muted-foreground">/mês</span>
                    </div>
                    <div className="text-[10px] text-primary/80 inline-flex items-center gap-1 mt-0.5">
                      <Users className="w-3 h-3" /> usuários ilimitados
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {PLAN_META.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="grid sm:grid-cols-3 gap-3 pt-4 border-t border-white/5">
                  {(["month", "quarter", "semester"] as const).map((interval) => {
                    const plan = planByInterval[interval];
                    if (!plan) return null;
                    const isCurrent = hasActiveSub && sub.plan_code === plan.code && sub.interval === interval;
                    const discount =
                      interval === "semester" ? "-20%" : interval === "quarter" ? "-10%" : null;
                    const perMonth = monthlyEquivalent(plan.amount_cents, interval);
                    return (
                      <div
                        key={interval}
                        className={`rounded-xl border p-4 space-y-3 ${
                          interval === "semester"
                            ? "border-primary/40 bg-primary/5"
                            : "border-white/10 bg-black/20"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="font-semibold">{intervalLabel(interval)}</div>
                          {discount ? (
                            <Badge className="bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              {discount}
                            </Badge>
                          ) : (
                            <Badge className="bg-white/5 text-muted-foreground border border-white/10">
                              Sem fidelidade
                            </Badge>
                          )}
                        </div>
                        <div>
                          <div className="font-display text-3xl tabular-nums">
                            {BRL(plan.amount_cents, plan.currency)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {intervalUnit(interval)}
                            {interval !== "month" && (
                              <>
                                {" "}· equivale a{" "}
                                <span className="text-foreground font-medium">{BRL(perMonth)}/mês</span>
                              </>
                            )}
                          </div>
                        </div>
                        <Button
                          variant={interval === "semester" ? "default" : "outline"}
                          className="w-full justify-center gap-2"
                          disabled={
                            busyKey === plan.lookup_key ||
                            (isCurrent && ["active", "authorized"].includes(sub.status))
                          }
                          onClick={() => startCheckout(plan.lookup_key)}
                        >
                          {busyKey === plan.lookup_key ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <CreditCard className="w-4 h-4" />
                          )}
                          {isCurrent && ["active", "authorized"].includes(sub.status)
                            ? "Plano atual"
                            : `Assinar ${intervalLabel(interval).toLowerCase()}`}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </div>

          {!hasActiveSub && (
            <div className="rounded-xl p-5 border border-white/10 bg-[#0E1730] flex items-center gap-3 text-sm text-muted-foreground mt-6">
              <ShieldCheck className="w-5 h-5 text-primary shrink-0" />
              Pagamentos processados pelo Mercado Pago. Cartão de crédito com cobrança automática recorrente.
            </div>
          )}
        </TrialGate>


        <Card className="bg-[#0E1730] border-white/10">
          <CardHeader className="flex flex-row items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            <CardTitle className="text-base">Histórico de pagamentos</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {invoices.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">Nenhum pagamento registrado ainda.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {invoices.map((inv) => (
                  <div key={inv.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <div className="font-medium">{inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("pt-BR") : "—"}</div>
                      {inv.mp_payment_id && <div className="text-[10px] text-muted-foreground font-mono">#{inv.mp_payment_id}</div>}
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={inv.status === "approved" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border border-amber-500/30"}>
                        {inv.status}
                      </Badge>
                      <span className="font-semibold tabular-nums">{BRL(inv.amount_paid_cents || 0, inv.currency || "brl")}</span>
                      {inv.receipt_url && (
                        <a className="text-primary hover:underline text-xs inline-flex items-center gap-1" href={inv.receipt_url} target="_blank" rel="noreferrer">
                          Recibo <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TrialGate({ tenant: _tenant, children }: { tenant: any; children: React.ReactNode }) {
  // Sempre exibe os planos normalmente — o período de teste não bloqueia mais a seleção.
  return <>{children}</>;
  // eslint-disable-next-line no-unreachable
  const active = false;
  const endsAt: Date | null = null;
  const now = new Date();

  const diffMs = endsAt ? endsAt.getTime() - now.getTime() : 0;
  const expired = endsAt ? diffMs <= 0 : false;
  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;

  return (
    <div className="relative">
      <div className="pointer-events-none select-none blur-md opacity-40" aria-hidden>
        {children}
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="max-w-xl w-full rounded-2xl border border-primary/30 bg-[#0E1730]/95 backdrop-blur-xl p-8 text-center shadow-2xl">
          <div className="w-14 h-14 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80 font-mono mb-2">Período de teste ativo</div>
          <h3 className="font-display text-2xl mb-2">
            {expired ? "Seu período de teste expirou" : "Você está usando o Posion em teste"}
          </h3>
          <p className="text-sm text-muted-foreground mb-6">
            {expired
              ? "Fale com o suporte Posion para ativar seu plano e continuar aproveitando a plataforma."
              : "Os planos serão liberados automaticamente ao fim do período de teste. Fale com o suporte se precisar antecipar."}
          </p>

          {endsAt && (
            <div className="mb-2 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {expired ? "Expirado em " : "Expira em "}
              {endsAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" })}
            </div>
          )}

          {endsAt && !expired && (
            <div className="grid grid-cols-4 gap-2 mt-4">
              {[
                { v: days, l: "dias" },
                { v: hours, l: "horas" },
                { v: mins, l: "min" },
                { v: secs, l: "seg" },
              ].map((t) => (
                <div key={t.l} className="rounded-lg border border-white/10 bg-black/40 py-3">
                  <div className="font-display text-2xl tabular-nums">{String(t.v).padStart(2, "0")}</div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{t.l}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

