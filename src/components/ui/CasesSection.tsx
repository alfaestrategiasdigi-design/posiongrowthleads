import { TrendingUp, Quote } from "lucide-react";
import drPedro from "@/assets/posion/Dr-Pedro.webp.asset.json";
import drFuvio from "@/assets/posion/Dr-Fuvio.webp.asset.json";
import drRuan from "@/assets/posion/Dr-Ruan.webp.asset.json";
import drDiego from "@/assets/posion/Dr_-Diego.webp.asset.json";
import draAndressa from "@/assets/posion/Dra-Andressa.jpg.asset.json";
import draPatricia from "@/assets/posion/Dra_-Patricia.webp.asset.json";

const featured = {
  name: "Dr. Pedro",
  specialty: "Cirurgia",
  photo: drPedro.url,
  metric: "+R$ 10 milhões",
  quote: "Saímos de uma operação por indicação para um sistema de vendas previsível. Hoje minha agenda é controlada por estratégia, não por sorte.",
};

const cases = [
  { name: "Dr. Fúlvio",     specialty: "Implantodontia",         metric: "R$ 1,8M em 12 meses",   photo: drFuvio.url },
  { name: "Dr. Ruan",       specialty: "Harmonização Orofacial", metric: "320 pacientes / mês",   photo: drRuan.url },
  { name: "Dr. Diego",      specialty: "Cirurgia Plástica",      metric: "ROAS 6,4x sustentado",  photo: drDiego.url },
  { name: "Dra. Andressa",  specialty: "Odontologia Premium",    metric: "+R$ 2,4M em vendas",    photo: draAndressa.url },
  { name: "Dra. Patrícia",  specialty: "Estética Avançada",      metric: "Ticket médio 3x maior", photo: draPatricia.url },
];

const CasesSection = () => {
  return (
    <section className="py-20 md:py-24 px-4 relative">
      <div className="container mx-auto max-w-6xl">
        {/* Featured */}
        <div className="card-elevated p-8 md:p-12 mb-10 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-80 h-80 bg-accent/10 rounded-full blur-[100px] pointer-events-none" />
          <div className="grid md:grid-cols-[auto_1fr_auto] gap-8 items-center relative z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-28 h-28 rounded-full overflow-hidden ring-4 ring-accent/40 shadow-2xl">
                <img src={featured.photo} alt={featured.name} className="w-full h-full object-cover" />
              </div>
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Caso destaque</span>
            </div>
            <div>
              <Quote className="w-7 h-7 text-accent mb-3" />
              <p className="font-display text-2xl md:text-3xl text-foreground leading-snug mb-4">
                "{featured.quote}"
              </p>
              <p className="text-sm text-muted-foreground">
                {featured.name} — {featured.specialty}
              </p>
            </div>
            <div className="md:text-right">
              <p className="text-xs uppercase tracking-[0.2em] text-accent mb-2">Resultado</p>
              <p className="font-display text-4xl gold-gradient-text">{featured.metric}</p>
              <p className="text-sm text-muted-foreground">em vendas geradas</p>
            </div>
          </div>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cases.map((c) => (
            <div key={c.name} className="card-tech p-6">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-14 h-14 rounded-full overflow-hidden ring-2 ring-accent/30 shadow-lg flex-shrink-0">
                  <img src={c.photo} alt={c.name} className="w-full h-full object-cover" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.specialty}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <TrendingUp className="w-4 h-4 text-accent" />
                <span className="text-foreground/85">{c.metric}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default CasesSection;
