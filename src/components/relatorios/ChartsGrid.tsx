import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, Area, AreaChart } from "recharts";
import type { RelatorioData } from "@/lib/relatorios/types";

const COLORS = ["#f59e0b", "#8b5cf6", "#06b6d4", "#10b981", "#ef4444", "#3b82f6", "#eab308", "#ec4899"];

const tooltipStyle = {
  background: "hsl(var(--card))",
  border: "1px solid hsl(var(--border))",
  borderRadius: 8,
  fontSize: 11,
  padding: "6px 10px",
};

function ChartCard({ title, subtitle, children, id, className = "" }: {
  title: string; subtitle?: string; children: React.ReactNode; id?: string; className?: string;
}) {
  return (
    <div className={`rounded-xl border border-border/60 bg-card/60 p-3.5 md:p-4 space-y-3 ${className}`} data-chart-id={id}>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[11px] md:text-[12px] font-semibold uppercase tracking-[0.16em] text-foreground/90">{title}</h4>
        {subtitle && <span className="text-[10px] text-muted-foreground truncate">{subtitle}</span>}
      </div>
      <div className="h-56 md:h-60">{children}</div>
    </div>
  );
}

export default function ChartsGrid({ data }: { data: RelatorioData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 md:gap-4">
      <ChartCard title="Leads por dia" subtitle="Evolução diária" id="chart-leads-day" className="md:col-span-2 xl:col-span-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data.leadsByDay} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id="gLeads" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35}/>
                <stop offset="100%" stopColor="#f59e0b" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} tickLine={false} axisLine={false} width={30} />
            <Tooltip contentStyle={tooltipStyle} />
            <Area type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} fill="url(#gLeads)" />
            <Line type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2, fill: "#f59e0b" }} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Origem" subtitle="Pago vs. orgânico" id="chart-origin">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.originSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={82} paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2}>
              <Cell fill="#f59e0b" />
              <Cell fill="#06b6d4" />
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top campanhas" subtitle="Ranking por leads" id="chart-campaigns" className="md:col-span-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.leadsByCampaign} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={140} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Formulários" subtitle="Distribuição" id="chart-forms">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.leadsByForm} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={82} paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2}>
              {data.leadsByForm.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Comparecimento" subtitle="Por dia da semana" id="chart-attendance" className="md:col-span-2 xl:col-span-3">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.attendanceByWeekday} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} allowDecimals={false} tickLine={false} axisLine={false} width={30} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            <Bar dataKey="compareceu" fill="#10b981" name="Compareceu" radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="noShow" fill="#ef4444" name="Não compareceu" radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Faturamento por Produto" subtitle="Top produtos (vendas do período)" id="chart-products" className="md:col-span-2">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.salesByProduct} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false}
              tickFormatter={(v) => `R$ ${Math.round(Number(v) / 1000)}k`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={140} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }}
              formatter={(v: any) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
            <Bar dataKey="total" fill="#f59e0b" radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Monetizados por Produto" subtitle="Recompra (2ª venda ou mais)" id="chart-monetized">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.monetizedByProduct} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false}
              tickFormatter={(v) => `R$ ${Math.round(Number(v) / 1000)}k`} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} width={120} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }}
              formatter={(v: any) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} />
            <Bar dataKey="total" fill="#10b981" radius={[0, 4, 4, 0]} maxBarSize={18} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Taxa Conversão / Canal" subtitle="Vendas ÷ Leads por canal" id="chart-channel-conv">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.channelConversion} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={38}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }}
              formatter={(v: any) => `${(Number(v) * 100).toFixed(1)}%`} />
            <Bar dataKey="rate" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Taxa SQL / Canal" subtitle="SQL ÷ Leads por canal" id="chart-channel-sql">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.channelSql} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickLine={false} axisLine={false} width={38}
              tickFormatter={(v) => `${(Number(v) * 100).toFixed(0)}%`} />
            <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "rgba(255,255,255,0.03)" }}
              formatter={(v: any) => `${(Number(v) * 100).toFixed(1)}%`} />
            <Bar dataKey="rate" fill="#8b5cf6" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
