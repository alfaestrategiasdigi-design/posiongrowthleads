import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer className="gradient-header border-t border-border/30 py-12 px-4">
      <div className="container mx-auto max-w-5xl">
        <div className="grid sm:grid-cols-3 gap-8 text-sm">
          <div>
            <div className="wordmark text-foreground text-lg mb-2">
              POSION <span className="gold-gradient-text">GROWTH</span>
            </div>
            <p className="text-foreground/70 leading-relaxed">
              Marketing, vendas e operação high-ticket para médicos e clínicas.
            </p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-accent/80 mb-3">Contato</p>
            <a
              href="https://wa.me/557781082064?text=Ol%C3%A1%2C%20quero%20saber%20sobre%20a%20Posion"
              target="_blank"
              rel="noopener noreferrer"
              className="block text-foreground/80 hover:text-accent transition"
            >
              WhatsApp · +55 77 8108-2064
            </a>
            <p className="text-foreground/60 mt-1">Atendimento Posion</p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-accent/80 mb-3">Acesso</p>
            <Link to="/admin" className="block text-foreground/80 hover:text-accent transition">
              Área de membros
            </Link>
          </div>
        </div>

        <div className="border-t border-border/30 mt-10 pt-6 text-center">
          <p className="text-muted-foreground text-xs">
            © {new Date().getFullYear()} Posion Growth. Todos os direitos reservados.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
