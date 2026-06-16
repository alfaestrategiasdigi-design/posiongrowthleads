import { ArrowRight, LogIn } from "lucide-react";
import { Link } from "react-router-dom";

const FinalCTASection = () => {
  const scrollToQuiz = () => {
    document.getElementById("quiz")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section className="py-20 md:py-28 px-4 relative">
      <div className="container mx-auto max-w-4xl">
        <div className="card-elevated p-10 md:p-14 text-center relative overflow-hidden">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-[32rem] h-[32rem] bg-accent/10 rounded-full blur-[120px] pointer-events-none" />

          <span className="relative inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.3em] text-accent/90 border border-accent/30 bg-accent/5 px-3 py-1 rounded-full mb-6">
            Vagas limitadas
          </span>

          <h2 className="relative font-display text-3xl md:text-5xl text-foreground leading-[1.05] mb-5">
            Pronto pra <span className="gold-gradient-text">escalar</span> a sua clínica com método?
          </h2>
          <p className="relative text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-8">
            Em 30 minutos mapeamos o seu funil, identificamos os gargalos e mostramos
            o caminho até a próxima curva de crescimento.
          </p>

          <div className="relative flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={scrollToQuiz}
              className="cta-glow inline-flex items-center gap-2 px-7 py-3.5 rounded-full gradient-accent text-[hsl(232_65%_5%)] font-semibold text-sm hover:scale-[1.02] transition-transform"
            >
              Quero meu diagnóstico gratuito
              <ArrowRight className="w-4 h-4" />
            </button>

            <Link
              to="/admin"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-full border border-accent/40 bg-accent/5 hover:bg-accent/15 hover:border-accent/70 text-sm font-semibold text-foreground transition"
            >
              <LogIn className="w-4 h-4 text-accent" />
              Já sou membro
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
};

export default FinalCTASection;
