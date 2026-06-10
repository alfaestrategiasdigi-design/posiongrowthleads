import { CheckCircle, MessageSquare, Clock, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Header from "@/components/ui/Header";
import Footer from "@/components/ui/Footer";

const Obrigado = () => {
  const navigate = useNavigate();
  const whatsappUrl = "https://wa.me/557781550243?text=Olá%2C%20enviei%20meu%20cadastro%20na%20Posion%20Growth%20e%20aguardo%20retorno.";

  return (
    <div className="min-h-screen flex flex-col tech-bg geo-pattern">
      <Header />

      <main className="flex-1 flex items-center justify-center px-4 py-16 relative overflow-hidden">
        {/* Background glow effects */}
        <div className="absolute top-20 left-1/4 w-64 h-64 bg-success/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-20 right-1/4 w-64 h-64 bg-accent/10 rounded-full blur-[100px] pointer-events-none" />

        <div className="card-elevated p-8 md:p-12 text-center max-w-lg w-full relative z-10 animate-scale-in">
          {/* Success Icon */}
          <div className="relative w-20 h-20 mx-auto mb-6">
            <div className="absolute inset-0 bg-success/20 rounded-full animate-pulse-glow" />
            <div className="w-20 h-20 bg-success/10 border border-success/30 rounded-full flex items-center justify-center">
              <CheckCircle className="w-10 h-10 text-success" />
            </div>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-4 animate-fade-in-up stagger-1">
            Cadastro recebido com sucesso
          </h1>

          <div className="bg-secondary/50 border border-border/50 rounded-xl p-5 mb-6 animate-fade-in-up stagger-2">
            <div className="flex items-center justify-center gap-2 mb-3">
              <div className="w-10 h-10 bg-accent/10 border border-accent/20 rounded-full flex items-center justify-center">
                <Clock className="w-5 h-5 text-accent" />
              </div>
            </div>
            <p className="font-semibold text-foreground text-lg mb-1">Fique atento ao seu WhatsApp!</p>
            <p className="text-muted-foreground text-sm">
              Em alguns minutos, nosso estrategista entrará em contato com você via WhatsApp.
            </p>
          </div>

          <p className="text-muted-foreground mb-8 animate-fade-in-up stagger-3 text-sm">
            Enquanto isso, você também pode falar diretamente com nosso estrategista.
          </p>

          <a
            href={whatsappUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-3 bg-whatsapp hover:bg-whatsapp/90 text-whatsapp-foreground font-semibold py-4 px-8 rounded-xl transition-all duration-300 text-lg shadow-lg hover:shadow-xl hover:-translate-y-0.5 animate-fade-in-up stagger-4"
          >
            <MessageSquare className="w-6 h-6" />
            Falar com o Estrategista
          </a>

          <div className="pt-6 mt-6 border-t border-border/30">
            <Button
              variant="ghost"
              onClick={() => navigate("/")}
              className="text-muted-foreground hover:text-foreground gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Voltar ao início
            </Button>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default Obrigado;