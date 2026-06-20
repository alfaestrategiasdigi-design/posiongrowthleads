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

  // Mouse parallax — desktop + fine pointer only (skip mobile/touch)
  const sectionRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;

    const mqDesktop = window.matchMedia("(min-width: 1024px) and (pointer: fine)");
    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!mqDesktop.matches || mqReduce.matches) return;

    let raf = 0;
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (bgRef.current) bgRef.current.style.transform = `translate3d(${x * 3}px, ${y * 3}px, 0)`;
        if (titleRef.current) titleRef.current.style.transform = `translate3d(${x * 1.5}px, ${y * 1.5}px, 0)`;
        if (formRef.current) formRef.current.style.transform = `translate3d(${x * -2}px, ${y * -2}px, 0)`;
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      [bgRef, titleRef, formRef].forEach((r) => {
        if (r.current) r.current.style.transform = "translate3d(0,0,0)";
      });
    };
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => {
      el.removeEventListener("mousemove", onMove);
      el.removeEventListener("mouseleave", onLeave);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden pt-10 sm:pt-12 md:pt-16 lg:pt-20 pb-14 sm:pb-20 md:pb-24 lg:pb-28 px-4 sm:px-6"
    >
      {/* Aurora background — indigo / violet */}
      <div
        ref={bgRef}
        className="absolute inset-0 pointer-events-none transition-transform duration-500 ease-out will-change-transform"
      >
        <div className="absolute -top-32 left-1/4 w-[28rem] sm:w-[36rem] h-[28rem] sm:h-[36rem] bg-[hsl(245_78%_60%/0.20)] rounded-full blur-[140px] sm:blur-[160px]" />
        <div className="absolute top-1/3 -right-32 w-[26rem] sm:w-[34rem] h-[26rem] sm:h-[34rem] bg-[hsl(265_85%_65%/0.16)] rounded-full blur-[140px] sm:blur-[160px]" />
        <div className="absolute bottom-0 left-0 w-[22rem] sm:w-[28rem] h-[22rem] sm:h-[28rem] bg-[hsl(230_80%_55%/0.12)] rounded-full blur-[120px] sm:blur-[140px]" />
      </div>

      {/* Tech grid overlay */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.14] sm:opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(245 70% 60% / 0.25) 1px, transparent 1px), linear-gradient(90deg, hsl(245 70% 60% / 0.25) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 70% 60% at 50% 30%, black 40%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 30%, black 40%, transparent 80%)",
        }}
      />

      <div ref={ref} className="container mx-auto max-w-7xl relative z-10">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-10 md:gap-12 lg:gap-16 items-start">
          {/* LEFT — headline */}
          <div
            ref={titleRef}
            className="transition-transform duration-500 ease-out lg:sticky lg:top-24 will-change-transform"
          >
            <div data-reveal className="reveal flex flex-wrap items-center gap-2 mb-5 sm:mb-6">
              <span className="group inline-flex items-center gap-2 text-[10px] sm:text-[11px] uppercase tracking-[0.24em] sm:tracking-[0.28em] text-primary/90 border border-primary/30 bg-primary/10 px-3 py-1.5 rounded-full transition-colors hover:bg-primary/15 hover:border-primary/50">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-primary opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                Atendimento exclusivo
              </span>
              <span className="text-[10px] uppercase tracking-[0.24em] sm:tracking-[0.28em] text-muted-foreground/80 border border-border/60 px-2.5 py-1 rounded-full">
                B2B · Clínicas Premium
              </span>
            </div>

            <h1
              data-reveal
              data-reveal-delay="80"
              className="reveal font-display text-[2rem] sm:text-4xl md:text-5xl lg:text-[3.5rem] text-foreground leading-[1.05] sm:leading-[1.02] mb-5 sm:mb-6 tracking-tight text-balance"
            >
              Clínicas médicas que{" "}
              <span className="relative inline-block">
                <span className="gold-gradient-text">comunicam valor</span>
                <span className="absolute -bottom-1 left-0 right-0 h-[3px] bg-gradient-to-r from-primary/80 via-violet-400/80 to-primary/0 rounded-full" />
              </span>
              <br className="hidden md:block" /> e vendem mais.
            </h1>

            <p
              data-reveal
              data-reveal-delay="160"
              className="reveal text-[15px] sm:text-base md:text-lg text-muted-foreground max-w-xl leading-relaxed mb-7 sm:mb-8"
            >
              Posicionamento, performance e vendas para clínicas que querem atrair
              pacientes premium e escalar com previsibilidade.
            </p>

            <div
              data-reveal
              data-reveal-delay="240"
              className="reveal grid grid-cols-3 gap-2 sm:gap-3 max-w-xl pt-5 sm:pt-6 border-t border-primary/15"
            >
              {[
                { v: `+${fmtInt(clinics)}`, l: "clínicas" },
                { v: `R$${fmtInt(media)}M+`, l: "em mídia" },
                { v: `${fmtInt(digits)} díg.`, l: "em vendas" },
              ].map((k) => (
                <div
                  key={k.l}
                  className="group relative rounded-xl border border-primary/15 bg-primary/[0.04] px-3 sm:px-4 py-2.5 sm:py-3 backdrop-blur-sm transition-all duration-300 hover:border-primary/35 hover:bg-primary/[0.07] hover:-translate-y-0.5"
                >
                  <p className="font-display text-lg sm:text-xl md:text-2xl text-foreground tabular-nums leading-none">
                    {k.v}
                  </p>
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground mt-1.5 sm:mt-2 uppercase tracking-[0.16em] sm:tracking-[0.18em]">
                    {k.l}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT — sticky form */}
          <div
            ref={formRef}
            className="transition-transform duration-500 ease-out will-change-transform"
          >
            <div className="relative">
              <div className="absolute -inset-px rounded-2xl bg-gradient-to-br from-primary/40 via-violet-500/20 to-transparent opacity-60 blur-sm pointer-events-none" />
              <div
                id="quiz"
                data-reveal
                data-reveal-delay="120"
                className="reveal premium-form-shell relative"
              >
                <QualificationForm />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
