const stats = [
  { value: "+200", label: "clínicas e médicos impulsionados" },
  { value: "R$ 50M+", label: "investidos em mídia paga" },
  { value: "9 dígitos", label: "gerados em vendas para clientes" },
  { value: "+12", label: "especialidades atendidas" },
];

const SocialProof = () => {
  return (
    <section className="py-20 md:py-24 px-4 relative">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />
      <div className="container mx-auto max-w-5xl">
        <div className="text-center mb-12">
          <p className="text-[11px] uppercase tracking-[0.3em] text-accent/90 mb-4">Sobre a Posion Growth</p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl text-foreground max-w-3xl mx-auto leading-tight">
            Uma agência <span className="gold-gradient-text">exclusiva</span> para profissionais da saúde que querem crescer com previsibilidade.
          </h2>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.label} className="card-tech p-6 text-center">
              <p className="font-display text-3xl md:text-4xl gold-gradient-text mb-1">{s.value}</p>
              <p className="text-xs md:text-sm text-muted-foreground leading-snug">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default SocialProof;