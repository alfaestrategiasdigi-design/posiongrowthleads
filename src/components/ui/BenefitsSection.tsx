import { Crosshair, TrendingUp, Handshake, Check } from "lucide-react";

const pillars = [
  {
    icon: Crosshair,
    title: "Posicionamento",
    bullets: [
      "Identidade visual de marca premium",
      "Narrativa de autoridade do especialista",
      "Branding consistente em todos os pontos de contato",
      "Conteúdo estratégico que comunica valor",
    ],
  },
  {
    icon: TrendingUp,
    title: "Performance",
    bullets: [
      "Tráfego pago para captação previsível",
      "Criativos que convertem em pacientes high-ticket",
      "Funis de aquisição validados na sua especialidade",
      "Métricas e dashboards em tempo real",
    ],
  },
  {
    icon: Handshake,
    title: "Vendas",
    bullets: [
      "Scripts de atendimento e qualificação",
      "Treinamento do time comercial",
      "CRM e jornada do paciente estruturada",
      "Aumento do ticket médio e da taxa de fechamento",
    ],
  },
];

const BenefitsSection = () => {
  return (
    <section className="py-20 md:py-28 px-4 relative">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-14">
          <p className="text-[11px] uppercase tracking-[0.3em] text-accent/90 mb-4">Mas você precisa de nós?</p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl text-foreground max-w-3xl mx-auto leading-tight">
            Os três pilares que <span className="gold-gradient-text">transformam</span> uma clínica em uma operação de alto valor.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {pillars.map((p, i) => (
            <div
              key={p.title}
              className="card-tech p-7 animate-fade-in-up"
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              <div className="w-12 h-12 bg-accent/10 border border-accent/30 rounded-xl flex items-center justify-center mb-5">
                <p.icon className="w-6 h-6 text-accent" strokeWidth={1.5} />
              </div>
              <h3 className="font-display text-2xl text-foreground mb-4">{p.title}</h3>
              <ul className="space-y-2.5">
                {p.bullets.map((b) => (
                  <li key={b} className="flex items-start gap-2.5 text-sm text-foreground/80">
                    <Check className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default BenefitsSection;