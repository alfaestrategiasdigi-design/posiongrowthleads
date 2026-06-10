import trafego from "@/assets/posion/Trafego-Pago.webp.asset.json";
import criativos from "@/assets/posion/Criativos.webp.asset.json";
import treinamento from "@/assets/posion/Treinamento.webp.asset.json";
import ia from "@/assets/posion/Solucoes-de-IA.webp.asset.json";
import gestao from "@/assets/posion/Gestao-de-Vendas.webp.asset.json";
import paginas from "@/assets/posion/Pagina-de-Vendas-1.webp.asset.json";

const services = [
  { img: trafego.url,     title: "Tráfego Pago",       description: "Aquisição de pacientes high-ticket com previsibilidade, ROAS e escala." },
  { img: criativos.url,   title: "Criativos & Design", description: "Anúncios e conteúdos que comunicam autoridade e convertem." },
  { img: paginas.url,     title: "Páginas de Vendas",  description: "Landing pages otimizadas para taxa de conversão." },
  { img: ia.url,          title: "Soluções de IA",     description: "Automações e IA aplicadas a marketing, atendimento e vendas." },
  { img: gestao.url,      title: "Gestão de Vendas",   description: "Scripts, CRM, métricas e gestão da jornada do paciente." },
  { img: treinamento.url, title: "Treinamento",        description: "Capacitação do seu time de atendimento e comercial." },
];

const ServicesSection = () => {
  return (
    <section className="py-20 md:py-24 px-4 relative">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-14">
          <p className="text-[11px] uppercase tracking-[0.3em] text-accent/90 mb-4">O que entregamos</p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl text-foreground max-w-3xl mx-auto leading-tight">
            Uma operação <span className="gold-gradient-text">completa</span> de marketing e vendas para sua clínica.
          </h2>
          <p className="text-muted-foreground mt-5 max-w-2xl mx-auto">
            Conectamos posicionamento, performance e vendas em um único sistema.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {services.map((s) => (
            <div key={s.title} className="card-tech overflow-hidden flex flex-col group">
              <div className="aspect-[16/10] overflow-hidden bg-muted">
                <img
                  src={s.img}
                  alt={s.title}
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                />
              </div>
              <div className="p-6">
                <h3 className="font-display text-lg text-foreground mb-2">{s.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default ServicesSection;
