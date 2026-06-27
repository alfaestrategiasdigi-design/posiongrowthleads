import { useEffect, useState } from "react";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { Check, Sparkles, Crown, Rocket, Loader2, ShieldCheck, FileText, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const PLAN_META: Record<string, { icon: any; tagline: string; features: string[]; accent: string; border: string }> = {
  starter: {
    icon: Rocket,
    tagline: "Para clínicas começando a estruturar gestão",
    accent: "from-slate-400/20 to-slate-300/5",
    border: "border-white/10",
    features: ["Dashboard de faturamento e metas", "CRM Kanban (até 500 leads/mês)", "WhatsApp integrado (1 número)", "Agenda e prontuário básico", "Suporte por e-mail"],
  },
  pro: {
    icon: Sparkles,
    tagline: "Operação completa com automação e recall",
    accent: "from-primary/30 to-primary/5",
    border: "border-primary/40",
    features: ["Tudo do Starter, sem limite de leads", "Recall automatizado por WhatsApp", "Funil de avaliações + relatórios", "Até 5 usuários", "Integração com Meta Ads", "Suporte prioritário"],
  },
  scale: {
    icon: Crown,
    tagline: "Para redes e clínicas de alta performance",
    accent: "from-amber-400/20 to-amber-300/5",
    border: "border-amber-300/30",
    features: ["Tudo do Pro, usuários ilimitados", "Multi-unidades em um único painel", "API + tokens por unidade", "Agente de IA 24/7", "Onboarding dedicado + CS", "SLA 99,9%"],
  },
};

const BRL = (cents: number, cur = "brl") =>
  ((cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: (cur || "brl").toUpperCase() });

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  active: { label: "Ativa", className: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" },
  trialing: { label: "Em teste", className: "bg-sky-500/15 text-sky-300 border-sky-500/30" },
  past_due: { label: "Pagamento pendente", className: "bg-amber-500/15 text-amber-300 border-amber-500/30" },
  canceled: { label: "Cancelada", className: "bg-rose-500/15 text-rose-300 border-rose-500/30" },
  paused: { label: "Pausada", className: "bg-violet-500/15 text-violet-300 border-violet-500/30" },
};

export default function TenantPlans() {
  const { tenant } = useTenant();
  const [sub, setSub] = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenant?.id) return;
    (async () => {
      setLoading(true);
      const [subRes, invRes] = await Promise.all([
        supabase.from("subscriptions").select("*").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("subscription_invoices").select("*").eq("tenant_id", tenant.id).order("paid_at", { ascending: false, nullsFirst: false }).limit(10),
      ]);
      setSub(subRes.data);
      setInvoices(invRes.data || []);
      setLoading(false);
    })();
  }, [tenant?.id]);

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }

  const planCode = (sub?.plan_code || "starter") as keyof typeof PLAN_META;
  const meta = PLAN_META[planCode] || PLAN_META.starter;
  const Icon = meta.icon;
  const statusInfo = sub ? (STATUS_LABEL[sub.status] || { label: sub.status, className: "bg-slate-500/15 text-slate-300 border-slate-500/30" }) : null;

  return (
    <div className="p-4 md:p-10 max-w-[1100px] mx-auto space-y-8">
      <div className="space-y-2">
        <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80 font-mono">Plano POSION</div>
        <h1 className="font-display text-3xl md:text-4xl tracking-tight">
          Plano da <span className="gold-gradient-text">{tenant?.name ?? "sua clínica"}</span>
        </h1>
        <p className="text-muted-foreground text-sm max-w-2xl">
          A gestão do plano é feita pela equipe POSION. Para upgrade, downgrade ou alteração de pagamento, fale com seu CS.
        </p>
      </div>

      {!sub ? (
        <div className="rounded-2xl p-8 border border-white/10 bg-[#0E1730] text-center space-y-3">
          <ShieldCheck className="w-10 h-10 mx-auto text-primary" />
          <h2 className="font-display text-xl">Sem assinatura ativa</h2>
          <p className="text-sm text-muted-foreground">Entre em contato com a equipe POSION para iniciar sua assinatura.</p>
          <a href="mailto:lucas@posion.com.br" className="inline-flex items-center gap-2 text-primary hover:underline text-sm mt-2">
            <Mail className="w-4 h-4" /> lucas@posion.com.br
          </a>
        </div>
      ) : (
        <>
          {/* Plano atual */}
          <div
            className={`rounded-2xl p-7 border ${meta.border}`}
            style={{ background: "linear-gradient(180deg, rgba(212,175,55,0.08) 0%, #0A1124 60%)" }}
          >
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Icon className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <div className="font-display text-3xl tracking-tight capitalize">{planCode}</div>
                  <p className="text-sm text-muted-foreground">{meta.tagline}</p>
                </div>
              </div>
              {statusInfo && <Badge className={`border ${statusInfo.className}`}>{statusInfo.label}</Badge>}
            </div>

            <div className="grid sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-white/10">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Valor</div>
                <div className="font-display text-2xl tabular-nums mt-1">{BRL(sub.amount_cents || 0, sub.currency || "brl")}</div>
                <div className="text-xs text-muted-foreground">{sub.interval === "quarter" ? "a cada 3 meses" : "por mês"}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Próxima cobrança</div>
                <div className="font-display text-2xl mt-1">
                  {sub.current_period_end ? new Date(sub.current_period_end).toLocaleDateString("pt-BR") : "—"}
                </div>
                {sub.cancel_at_period_end && <div className="text-xs text-amber-400">Cancela ao final do período</div>}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Forma de pagamento</div>
                <div className="font-display text-2xl mt-1">Cartão</div>
                <div className="text-xs text-muted-foreground">via Stripe</div>
              </div>
            </div>

            <ul className="mt-6 grid sm:grid-cols-2 gap-2">
              {meta.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm">
                  <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Faturas */}
          <div className="rounded-2xl border border-white/10 bg-[#0E1730]">
            <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary" />
              <h2 className="font-display text-lg">Histórico de pagamentos</h2>
            </div>
            {invoices.length === 0 ? (
              <div className="p-6 text-sm text-muted-foreground text-center">Nenhuma fatura registrada ainda.</div>
            ) : (
              <div className="divide-y divide-white/5">
                {invoices.map((inv) => (
                  <div key={inv.id} className="px-5 py-3 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <div className="font-medium">{inv.paid_at ? new Date(inv.paid_at).toLocaleDateString("pt-BR") : "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {inv.period_start && inv.period_end
                          ? `${new Date(inv.period_start).toLocaleDateString("pt-BR")} → ${new Date(inv.period_end).toLocaleDateString("pt-BR")}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className={inv.status === "paid" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-amber-500/15 text-amber-300 border border-amber-500/30"}>
                        {inv.status}
                      </Badge>
                      <span className="font-semibold tabular-nums">{BRL(inv.amount_paid_cents || 0, inv.currency || "brl")}</span>
                      {inv.hosted_invoice_url && (
                        <a className="text-primary hover:underline text-xs" href={inv.hosted_invoice_url} target="_blank" rel="noreferrer">Recibo →</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <div className="text-center text-xs text-muted-foreground pt-2">
        Precisa alterar o plano? <a href="mailto:lucas@posion.com.br" className="text-primary hover:underline">Fale com a equipe POSION</a>.
      </div>
    </div>
  );
}
