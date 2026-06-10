import { Stethoscope } from "lucide-react";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";

const Header = () => {
  return (
    <header className="gradient-header border-b border-border/30 relative">
      <div className="container mx-auto px-4 md:px-8 py-4">
        <div className="flex justify-between items-center gap-4">
          <a href="/" className="select-none flex items-center">
            <img src={logoAsset.url} alt="Posion Growth" className="h-10 md:h-12 w-auto" />
          </a>
          <div className="hidden sm:flex items-center gap-2 bg-accent/10 border border-accent/30 px-3 py-1.5 rounded-full">
            <Stethoscope className="w-4 h-4 text-accent" />
            <span className="text-[11px] md:text-xs font-medium tracking-[0.18em] uppercase text-foreground/80">
              Exclusivo para Médicos
            </span>
          </div>
        </div>
      </div>
      <div className="tech-line" />
    </header>
  );
};

export default Header;
