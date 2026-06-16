import QualificationForm from "@/components/forms/QualificationForm";
import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";

const fmtInt = (n: number) => Math.round(n).toLocaleString("pt-BR");

const HeroSection = () => {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.2 });
  const clinics = useCountUp(200, inView);
  const media = useCountUp(50, inView);
  const digits = useCountUp(9, inView, 1200);

  return (
    <section className="relative overflow-hidden py-10 md:py-16 px-4">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[32rem] h-[32rem] bg-accent/8 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-0 right-1/4 w-[24rem] h-[24rem] bg-[hsl(38_50%_45%/0.08)] rounded-full blur-[120px] pointer-events-none" />

      <div ref={ref} className="container mx-auto max-w-6xl relative z-10">
        <div className="text-center mb-8 md:mb-10 animate-fade-in-up">
          <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.25em] text-accent/90 border border-accent/30 bg-accent/5 px-3 py-1 rounded-full mb-5">
            Atendimento exclusivo
          </span>
          <h1 className="font-display text-3xl md:text-4xl lg:text-5xl text-foreground leading-[1.1] mb-4 max-w-3xl mx-auto">
            Clínicas médicas que{" "}
            <span className="gold-gradient-text">comunicam valor</span> e vendem mais.
          </h1>
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Posicionamento, performance e vendas para clínicas que querem atrair pacientes premium
            e escalar com previsibilidade.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-6 text-sm text-foreground/80">
            <div>
              <p className="font-display text-xl gold-gradient-text tabular-nums">+{fmtInt(clinics)}</p>
              <p className="text-[11px] text-muted-foreground">clínicas impulsionadas</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <p className="font-display text-xl gold-gradient-text tabular-nums">R$ {fmtInt(media)}M+</p>
              <p className="text-[11px] text-muted-foreground">investidos em mídia</p>
            </div>
            <div className="w-px h-8 bg-border" />
            <div>
              <p className="font-display text-xl gold-gradient-text tabular-nums">{fmtInt(digits)} dígitos</p>
              <p className="text-[11px] text-muted-foreground">gerados em vendas</p>
            </div>
          </div>
        </div>

        <div id="quiz" className="max-w-xl mx-auto animate-slide-up">
          <QualificationForm />
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
