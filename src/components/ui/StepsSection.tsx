import { ClipboardCheck, PhoneCall, Calendar } from "lucide-react";

const steps = [
  { icon: ClipboardCheck, title: "1. Preencha o diagnóstico", description: "Responda o quiz com informações sobre sua clínica para avaliarmos o fit." },
  { icon: PhoneCall, title: "2. Receba a ligação", description: "Nosso estrategista entra em contato pelo WhatsApp para entender seu cenário." },
  { icon: Calendar, title: "3. Agende a reunião", description: "Apresentamos um plano estratégico personalizado para a sua clínica." },
];

const StepsSection = () => {
  return (
    <section className="py-20 px-4 relative">
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-12">
          <p className="text-[11px] uppercase tracking-[0.3em] text-accent/90 mb-4">Como funciona</p>
          <h2 className="font-display text-3xl md:text-4xl text-foreground">
            Três passos para começar
          </h2>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {steps.map((s) => (
            <div key={s.title} className="card-tech p-7 text-center">
              <div className="w-14 h-14 mx-auto rounded-full gradient-accent flex items-center justify-center mb-5 shadow-lg">
                <s.icon className="w-6 h-6 text-primary-foreground" strokeWidth={1.8} />
              </div>
              <h3 className="font-display text-xl text-foreground mb-2">{s.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-12">
          <a
            href="#quiz"
            className="inline-flex items-center gap-2 gradient-accent text-primary-foreground font-semibold px-8 py-4 rounded-xl btn-glow shadow-lg hover:opacity-90 transition"
          >
            Quero meu diagnóstico
          </a>
        </div>
      </div>
    </section>
  );
};

export default StepsSection;