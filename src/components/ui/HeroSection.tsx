import QualificationForm from "@/components/forms/QualificationForm";
import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";

const fmtInt = (n: number) => Math.round(n).toLocaleString("pt-BR");

const HeroSection = () => {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.2 });
  const clinics = useCountUp(200, inView);
  const media = useCountUp(50, inView);
  const digits = useCountUp(9, inView, 1200);

  const scrollToQuiz = () => {
    document.getElementById("quiz")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="relative overflow-hidden py-16 md:py-24 px-4">
      <div className="absolute top-0 left-1/4 w-[28rem] h-[28rem] bg-accent/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-[24rem] h-[24rem] bg-[hsl(38_50%_45%/0.10)] rounded-full blur-[120px] pointer-events-none" />

      <div
        ref={ref}
        className="container mx-auto max-w-6xl relative z-10 grid lg:grid-cols-[1.1fr_1fr] gap-10 lg:gap-16 items-center"
      >
        <div className="animate-fade-in-up">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-accent/90 border border-accent/30 bg-accent/5 px-3 py-1 rounded-full mb-6">
            Atendimento exclusivo
          </span>
          <h1 className="font-display text-4xl md:text-5xl lg:text-6xl text-foreground leading-[1.05] mb-6">
            Nossos clientes médicos e clínicas{" "}
            <span className="gold-gradient-text">comunicam valor</span> e vendem mais.
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-xl leading-relaxed">
            Estruturamos posicionamento, performance e vendas para clínicas que querem
            atrair pacientes premium e escalar com previsibilidade — sem dependência de indicação.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-foreground/80">
            <div>
              <p className="font-display text-2xl gold-gradient-text tabular-nums">
                +{fmtInt(clinics)}
              </p>
              <p className="text-xs text-muted-foreground">clínicas impulsionadas</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div>
              <p className="font-display text-2xl gold-gradient-text tabular-nums">
                R$ {fmtInt(media)}M+
              </p>
              <p className="text-xs text-muted-foreground">investidos em mídia</p>
            </div>
            <div className="w-px h-10 bg-border" />
            <div>
              <p className="font-display text-2xl gold-gradient-text tabular-nums">
                {fmtInt(digits)} dígitos
              </p>
              <p className="text-xs text-muted-foreground">gerados em vendas</p>
            </div>
          </div>

          <button
            onClick={scrollToQuiz}
            className="mt-8 inline-flex items-center gap-2 px-7 py-3.5 rounded-full gradient-accent text-[hsl(232_65%_5%)] font-semibold text-sm shadow-lg cta-glow hover:scale-[1.02] transition-transform"
          >
            Quero meu diagnóstico gratuito
          </button>
        </div>

        <div id="quiz" className="animate-slide-up">
          <QualificationForm />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
