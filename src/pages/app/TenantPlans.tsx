import { useState } from "react";
import { useTenant } from "@/hooks/useTenant";
import { Check, Sparkles, Crown, Rocket, ArrowRight } from "lucide-react";
import { toast } from "sonner";

type Cycle = "mensal" | "trimestral";

const DISCOUNT = 0.1; // 10% off no trimestral

const PLANS = [
  {
    id: "starter",
    name: "Starter",
    icon: Rocket,
    tagline: "Para clínicas começando a estruturar gestão",
    price: 450,
    accent: "from-slate-400/20 to-slate-300/5",
    border: "border-white/10",
    features: [
      "Dashboard de faturamento e metas",
      "CRM Kanban (até 500 leads/mês)",
      "WhatsApp integrado (1 número)",
      "Agenda e prontuário básico",
      "Suporte por e-mail",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    icon: Sparkles,
    tagline: "Operação completa com automação e recall",
    price: 890,
    featured: true,
    accent: "from-primary/30 to-primary/5",
    border: "border-primary/40",
    features: [
      "Tudo do Starter, sem limite de leads",
      "Recall automatizado por WhatsApp",
      "Funil de avaliações + relatórios",
      "Até 5 usuários (vendedores, recepção)",
      "Integração com Meta Ads / Facebook Leads",
      "Suporte prioritário (chat)",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    icon: Crown,
    tagline: "Para redes e clínicas de alta performance",
    price: 1490,
    accent: "from-amber-400/20 to-amber-300/5",
    border: "border-amber-300/30",
    features: [
      "Tudo do Pro, usuários ilimitados",
      "Multi-unidades em um único painel",
      "API de integração + tokens por unidade",
      "Agente de IA para qualificação 24/7",
      "Onboarding dedicado + CS exclusivo",
      "SLA 99,9% e relatórios sob demanda",
    ],
  },
];

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

export default function TenantPlans() {
  const { tenant } = useTenant();
  const [cycle, setCycle] = useState<Cycle>("mensal");

  function priceFor(base: number) {
    return cycle === "mensal" ? base : Math.round(base * (1 - DISCOUNT));
  }

  return (
    <div className="p-4 md:p-10 max-w-[1400px] mx-auto space-y-10">
      {/* Hero */}
      <div className="text-center space-y-4 pt-4">
        <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80 font-medium">Planos POSION</div>
        <h1 className="font-display text-4xl md:text-5xl tracking-tight">
          Escolha o plano da <span className="gold-gradient-text">{tenant?.name ?? "sua clínica"}</span>
        </h1>
        <p className="text-muted-foreground max-w-xl mx-auto text-sm">
          Cancele quando quiser. Pague mensal ou economize 10% no trimestral.
        </p>

        {/* Cycle toggle */}
        <div className="inline-flex items-center p-1 rounded-full border border-white/10 bg-[#0B1224] mt-4">
          {(["mensal", "trimestral"] as Cycle[]).map((c) => (
            <button
              key={c}
              onClick={() => setCycle(c)}
              className={`relative px-5 py-2 text-sm rounded-full transition-all ${
                cycle === c
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "mensal" ? "Mensal" : "Trimestral"}
              {c === "trimestral" && (
                <span className="ml-2 text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded-full font-semibold">
                  −10%
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Plans grid */}
      <div className="grid md:grid-cols-3 gap-5 md:gap-6">
        {PLANS.map((p) => {
          const Icon = p.icon;
          const price = priceFor(p.price);
          const isFeatured = !!p.featured;
          return (
            <div
              key={p.id}
              className={`relative rounded-2xl p-7 border ${p.border} bg-gradient-to-b ${p.accent} backdrop-blur-sm transition-all hover:-translate-y-1 hover:shadow-[0_20px_60px_-20px_rgba(212,175,55,0.25)] ${
                isFeatured ? "md:scale-[1.03] md:-mt-2 shadow-[0_24px_80px_-30px_rgba(212,175,55,0.4)]" : ""
              }`}
              style={{
                background: isFeatured
                  ? "linear-gradient(180deg, rgba(212,175,55,0.12) 0%, #0A1124 60%)"
                  : "linear-gradient(180deg, #0E1730 0%, #0A1124 100%)",
              }}
            >
              {isFeatured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold uppercase tracking-wider">
                  Mais escolhido
                </div>
              )}

              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="font-display text-2xl tracking-tight">{p.name}</div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground min-h-[40px]">{p.tagline}</p>

              <div className="mt-6 pb-6 border-b border-white/10">
                <div className="flex items-baseline gap-1">
                  <span className="font-display text-5xl font-bold tabular-nums">{BRL(price)}</span>
                  <span className="text-muted-foreground text-sm">/mês</span>
                </div>
                {cycle === "trimestral" && (
                  <div className="text-xs text-emerald-400 mt-1 font-medium">
                    Você economiza {BRL((p.price - price) * 3)} a cada trimestre
                  </div>
                )}
                {cycle === "mensal" && (
                  <div className="text-xs text-muted-foreground mt-1">
                    Ou {BRL(Math.round(p.price * (1 - DISCOUNT)))}/mês no trimestral
                  </div>
                )}
              </div>

              <ul className="mt-6 space-y-3 min-h-[220px]">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => toast.success(`Plano ${p.name} selecionado — em breve enviaremos o link de pagamento.`)}
                className={`mt-7 w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all ${
                  isFeatured
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "bg-white/5 border border-white/10 hover:bg-white/10"
                }`}
              >
                Assinar {p.name}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-center text-xs text-muted-foreground pt-4">
        Precisa de algo customizado para sua rede? <a href="mailto:lucas@posion.com.br" className="text-primary hover:underline">Fale com a gente</a>.
      </div>
    </div>
  );
}
