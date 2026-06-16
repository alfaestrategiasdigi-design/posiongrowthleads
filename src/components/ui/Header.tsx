import { Stethoscope, LogIn } from "lucide-react";
import { Link } from "react-router-dom";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";

const Header = () => {
  return (
    <header className="gradient-header border-b border-border/30 relative">
      <div className="container mx-auto px-4 md:px-8 py-4">
        <div className="flex justify-between items-center gap-4">
          <a href="/" className="select-none flex items-center">
            <img src={logoAsset.url} alt="Posion Growth" className="h-10 md:h-12 w-auto" />
          </a>

          <div className="flex items-center gap-2 md:gap-3">
            <div className="hidden md:flex items-center gap-2 bg-accent/10 border border-accent/30 px-3 py-1.5 rounded-full">
              <Stethoscope className="w-4 h-4 text-accent" />
              <span className="text-[11px] font-medium tracking-[0.18em] uppercase text-foreground/80">
                Exclusivo para médicos
              </span>
            </div>

            <Link
              to="/admin"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-accent/40 bg-accent/5 hover:bg-accent/15 hover:border-accent/70 text-[12px] font-semibold tracking-wide text-foreground transition"
              aria-label="Acessar área de membros"
            >
              <LogIn className="w-4 h-4 text-accent" strokeWidth={2.2} />
              <span className="hidden sm:inline">Área de membros</span>
              <span className="sm:hidden">Entrar</span>
            </Link>
          </div>
        </div>
      </div>
      <div className="tech-line" />
    </header>
  );
};

export default Header;
