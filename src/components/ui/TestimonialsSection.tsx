import { Star } from "lucide-react";
import drPedro from "@/assets/posion/Dr-Pedro.webp.asset.json";
import drFuvio from "@/assets/posion/Dr-Fuvio.webp.asset.json";
import drRuan from "@/assets/posion/Dr-Ruan.webp.asset.json";
import drDiego from "@/assets/posion/Dr_-Diego.webp.asset.json";
import draAndressa from "@/assets/posion/Dra-Andressa.jpg.asset.json";
import draPatricia from "@/assets/posion/Dra_-Patricia.webp.asset.json";

const testimonials = [
  {
    name: "Dr. Pedro Almeida",
    specialty: "Transplante Capilar",
    photo: drPedro.url,
    result: "+R$ 10M em vendas",
    quote:
      "Saímos de uma operação por indicação para um sistema de vendas previsível. Hoje minha agenda é controlada por estratégia.",
  },
  {
    name: "Dr. Fúlvio",
    specialty: "Implantodontia",
    photo: drFuvio.url,
    result: "R$ 1,8M em 12 meses",
    quote: "Triplicamos o faturamento sem aumentar a estrutura. O método funciona porque é vendas, não só tráfego.",
  },
  {
    name: "Dr. Ruan",
    specialty: "Harmonização Orofacial",
    photo: drRuan.url,
    result: "320 pacientes / mês",
    quote: "A previsibilidade da agenda mudou meu negócio. Sei exatamente quantos pacientes entram por semana.",
  },
  {
    name: "Dr. Diego",
    specialty: "Cirurgia Plástica",
    photo: drDiego.url,
    result: "ROAS 6,4x",
    quote: "Pela primeira vez tenho clareza do retorno de cada real investido. O time da Posion é cirúrgico.",
  },
  {
    name: "Dra. Andressa",
    specialty: "Odontologia Premium",
    photo: draAndressa.url,
    result: "+R$ 2,4M em vendas",
    quote: "Posicionamento + performance + comercial estruturado. Hoje atendo o paciente que eu quero atender.",
  },
  {
    name: "Dra. Patrícia",
    specialty: "Estética Avançada",
    photo: draPatricia.url,
    result: "Ticket 3x maior",
    quote: "Aprendi a comunicar valor de verdade. Meu ticket triplicou e a percepção da marca também.",
  },
];

const TestimonialsSection = () => {
  return (
    <section className="py-20 md:py-28 px-4 relative">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-12">
          <p className="text-[11px] uppercase tracking-[0.3em] text-accent/90 mb-4">
            O que dizem os médicos
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl text-foreground max-w-3xl mx-auto leading-tight">
            Histórias de quem <span className="gold-gradient-text">já transformou</span> a clínica.
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {testimonials.map((t, i) => (
            <article
              key={t.name}
              className="testimonial-card group card-tech p-6 opacity-0 animate-fade-in-card"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 rounded-full overflow-hidden ring-2 ring-accent/40 shadow-lg flex-shrink-0">
                  <img src={t.photo} alt={t.name} className="w-full h-full object-cover" />
                </div>
                <div>
                  <p className="font-semibold text-foreground leading-tight">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.specialty}</p>
                  <div className="flex gap-0.5 mt-1" aria-label="5 de 5 estrelas">
                    {Array.from({ length: 5 }).map((_, idx) => (
                      <Star key={idx} className="w-3.5 h-3.5 text-accent fill-accent" />
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 mb-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-accent/80">Resultado</p>
                <p className="font-display text-lg gold-gradient-text">{t.result}</p>
              </div>

              <div className="testimonial-quote">
                <p className="text-sm text-foreground/80 leading-relaxed">"{t.quote}"</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
};

export default TestimonialsSection;
