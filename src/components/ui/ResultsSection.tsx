import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { useInView } from "@/hooks/useInView";

const revenue = [
  { mes: "Jan", antes: 32, depois: 48 },
  { mes: "Fev", antes: 35, depois: 62 },
  { mes: "Mar", antes: 31, depois: 78 },
  { mes: "Abr", antes: 38, depois: 96 },
  { mes: "Mai", antes: 34, depois: 118 },
  { mes: "Jun", antes: 36, depois: 142 },
];

const channels = [
  { canal: "Facebook", leads: 1240 },
  { canal: "Instagram", leads: 980 },
  { canal: "Google", leads: 720 },
  { canal: "Orgânico", leads: 410 },
  { canal: "Indicação", leads: 290 },
];

const specialties = [
  { name: "Odontologia", value: 32 },
  { name: "Estética", value: 24 },
  { name: "Dermato", value: 18 },
  { name: "Plástica", value: 14 },
  { name: "Capilar", value: 8 },
  { name: "Outras", value: 4 },
];

const PIE_COLORS = [
  "hsl(45 75% 70%)",
  "hsl(42 65% 58%)",
  "hsl(38 60% 48%)",
  "hsl(34 55% 40%)",
  "hsl(30 45% 32%)",
  "hsl(28 30% 24%)",
];

const tooltipStyle = {
  background: "hsl(226 53% 9%)",
  border: "1px solid hsl(224 30% 22%)",
  borderRadius: 12,
  color: "hsl(0 0% 100%)",
  fontSize: 12,
};

const ChartCard = ({
  title,
  caption,
  delay,
  children,
}: {
  title: string;
  caption: string;
  delay: number;
  children: React.ReactNode;
}) => (
  <div
    className="card-tech p-6 opacity-0 animate-fade-in-card"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="mb-4">
      <p className="text-[11px] uppercase tracking-[0.25em] text-accent/90 mb-1">{caption}</p>
      <h3 className="font-display text-xl text-foreground normal-case tracking-normal">{title}</h3>
    </div>
    <div className="h-64">{children}</div>
  </div>
);

const ResultsSection = () => {
  const { ref, inView } = useInView<HTMLDivElement>();

  return (
    <section className="py-20 md:py-28 px-4 relative" ref={ref}>
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-12">
          <p className="text-[11px] uppercase tracking-[0.3em] text-accent/90 mb-4">
            Resultados reais
          </p>
          <h2 className="font-display text-3xl md:text-4xl lg:text-5xl text-foreground max-w-3xl mx-auto leading-tight">
            Números que <span className="gold-gradient-text">crescem</span> com o método Posion.
          </h2>
        </div>

        {inView && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartCard
              title="Faturamento antes e depois"
              caption="Últimos 6 meses (R$ mil)"
              delay={0}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={revenue} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(224 30% 18%)" strokeDasharray="3 3" />
                  <XAxis dataKey="mes" stroke="hsl(215 20% 65%)" fontSize={12} />
                  <YAxis stroke="hsl(215 20% 65%)" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "hsl(42 55% 62% / 0.3)" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "hsl(215 20% 65%)" }} />
                  <Line
                    type="monotone"
                    dataKey="antes"
                    name="Antes"
                    stroke="hsl(215 15% 50%)"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="depois"
                    name="Depois"
                    stroke="hsl(42 65% 58%)"
                    strokeWidth={3}
                    dot={{ fill: "hsl(45 75% 70%)", r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Origem dos leads" caption="Distribuição por canal" delay={120}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={channels} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid stroke="hsl(224 30% 18%)" strokeDasharray="3 3" />
                  <XAxis dataKey="canal" stroke="hsl(215 20% 65%)" fontSize={11} />
                  <YAxis stroke="hsl(215 20% 65%)" fontSize={12} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "hsl(42 55% 62% / 0.08)" }} />
                  <Bar dataKey="leads" radius={[8, 8, 0, 0]} fill="hsl(42 65% 58%)" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Por especialidade" caption="Mix da carteira" delay={240}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Pie
                    data={specialties}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={85}
                    paddingAngle={2}
                    stroke="hsl(226 53% 9%)"
                  >
                    {specialties.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    wrapperStyle={{ fontSize: 11, color: "hsl(215 20% 65%)" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}
      </div>
    </section>
  );
};

export default ResultsSection;
