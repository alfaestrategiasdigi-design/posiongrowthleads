import { MessageCircle, Sparkles } from "lucide-react";

const WA_NUMBER = "5577810820 64".replace(/\s/g, ""); // +55 77 8108-2064
const WA_MSG = encodeURIComponent("Olá! Quero saber mais sobre a Posion Growth.");

const FloatingCTAs = () => {
  const scrollToQuiz = () => {
    const el = document.getElementById("quiz");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      {/* Diagnóstico (esquerda, dourado) */}
      <button
        onClick={scrollToQuiz}
        aria-label="Fazer diagnóstico gratuito"
        className="fixed bottom-6 left-6 z-50 group flex items-center gap-2 pl-4 pr-5 h-14 rounded-full gradient-accent text-[hsl(232_65%_5%)] font-semibold text-sm shadow-[0_10px_40px_-10px_hsl(42_55%_62%/0.6)] animate-bounce-soft hover:scale-105 transition-transform"
      >
        <Sparkles className="w-5 h-5" strokeWidth={2.2} />
        <span className="hidden sm:inline">Diagnóstico gratuito</span>
        <span className="sm:hidden">Diagnóstico</span>
      </button>

      {/* WhatsApp (direita, verde) */}
      <a
        href={`https://wa.me/${WA_NUMBER}?text=${WA_MSG}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Falar no WhatsApp"
        className="fixed bottom-6 right-6 z-50 group flex items-center gap-2 pl-4 pr-5 h-14 rounded-full bg-[hsl(var(--whatsapp))] text-[hsl(var(--whatsapp-foreground))] font-semibold text-sm shadow-[0_10px_40px_-10px_hsl(var(--whatsapp)/0.7)] animate-bounce-soft hover:scale-105 transition-transform"
        style={{ animationDelay: "0.4s" }}
      >
        <MessageCircle className="w-5 h-5" strokeWidth={2.2} />
        <span className="hidden sm:inline">WhatsApp</span>
      </a>
    </>
  );
};

export default FloatingCTAs;
