import { useEffect, useRef } from "react";
import QualificationForm from "@/components/forms/QualificationForm";
import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";

const fmtInt = (n: number) => Math.round(n).toLocaleString("pt-BR");

const HeroSection = () => {
  const { ref, inView } = useInView<HTMLDivElement>({ threshold: 0.15 });
  const clinics = useCountUp(200, inView);
  const media = useCountUp(50, inView);
  const digits = useCountUp(9, inView, 1200);

  // Mouse parallax
  const sectionRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (bgRef.current) bgRef.current.style.transform = `translate3d(${x * 8}px, ${y * 8}px, 0)`;
        if (titleRef.current) titleRef.current.style.transform = `translate3d(${x * 5}px, ${y * 5}px, 0)`;
        if (formRef.current) formRef.current.style.transform = `translate3d(${x * -6}px, ${y * -6}px, 0)`;
      });
    };
    el.addEventListener("mousemove", onMove);
    return () => {
      el.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden pt-10 md:pt-14 pb-16 md:pb-24 px-4"
    >
      {/* Aurora background — indigo / violet */}
      <div
        ref={bgRef}
        className="absolute inset-0 pointer-events-none transition-transform duration-300 ease-out"
      >
        <div className="absolute -top-32 left-1/4 w-[36rem] h-[36rem] bg-[hsl(245_78%_60%/0.18)] rounded-full blur-[160px]" />
        <div className="absolute top-1/3 -right-32 w-[34rem] h-[34rem] bg-[hsl(265_85%_65%/0.14)] rounded-full blur-[160px]" />
        <div className="absolute bottom-0 left-0 w-[28rem] h-[28rem] bg-[hsl(230_80%_55%/0.10)] rounded-full blur-[140px]" />
      </div>

      <div ref={ref} className="container mx-auto max-w-7xl relative z-10">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 lg:gap-16 items-start">
          {/* LEFT — headline */}
          <div ref={titleRef} className="transition-transform duration-300 ease-out lg:sticky lg:top-24">
            <div data-reveal className="reveal">
              <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-primary/90 border border-primary/30 bg-primary/10 px-3 py-1.5 rounded-full mb-6">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                Atendimento exclusivo
              </span>
            </div>

            <h1
              data-reveal
              data-reveal-delay="80"
              className="reveal font-display text-4xl md:text-5xl lg:text-[3.5rem] text-foreground leading-[1.02] mb-6 tracking-tight"
            >
              Clínicas médicas que{" "}
              <span className="gold-gradient-text">comunicam valor</span>
              <br className="hidden md:block" /> e vendem mais.
            </h1>

            <p
              data-reveal
              data-reveal-delay="160"
              className="reveal text-base md:text-lg text-muted-foreground max-w-xl leading-relaxed mb-8"
            >
              Posicionamento, performance e vendas para clínicas que querem atrair
              pacientes premium e escalar com previsibilidade.
            </p>

            <div
              data-reveal
              data-reveal-delay="240"
              className="reveal flex items-center gap-8 max-w-lg pt-6 border-t border-border/40"
            >
              <div>
                <p className="font-display text-2xl md:text-3xl text-foreground tabular-nums leading-none">
                  +{fmtInt(clinics)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-2 uppercase tracking-wider">
                  clínicas
                </p>
              </div>
              <div className="h-10 w-px bg-primary/20" />
              <div>
                <p className="font-display text-2xl md:text-3xl text-foreground tabular-nums leading-none">
                  R${fmtInt(media)}M+
                </p>
                <p className="text-[11px] text-muted-foreground mt-2 uppercase tracking-wider">
                  em mídia
                </p>
              </div>
              <div className="h-10 w-px bg-primary/20" />
              <div>
                <p className="font-display text-2xl md:text-3xl text-foreground tabular-nums leading-none">
                  {fmtInt(digits)} díg.
                </p>
                <p className="text-[11px] text-muted-foreground mt-2 uppercase tracking-wider">
                  em vendas
                </p>
              </div>
            </div>
          </div>

          {/* RIGHT — sticky form */}
          <div
            ref={formRef}
            className="transition-transform duration-300 ease-out"
          >
            <div id="quiz" data-reveal data-reveal-delay="120" className="reveal premium-form-shell">
              <QualificationForm />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
