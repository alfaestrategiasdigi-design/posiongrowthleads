import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";
import type { RelatorioData } from "@/lib/relatorios/types";

const COLORS = ["#f59e0b", "#8b5cf6", "#06b6d4", "#10b981", "#ef4444", "#3b82f6", "#eab308", "#ec4899"];

function ChartCard({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <div className="card-elevated p-4 space-y-3" data-chart-id={id}>
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      <div className="h-64">{children}</div>
    </div>
  );
}

export default function ChartsGrid({ data }: { data: RelatorioData }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <ChartCard title="Leads por dia" id="chart-leads-day">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data.leadsByDay}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="date" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Line type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Top 10 campanhas" id="chart-campaigns">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.leadsByCampaign} layout="vertical" margin={{ left: 60 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Leads por formulário" id="chart-forms">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.leadsByForm} dataKey="count" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={90} paddingAngle={2}>
              {data.leadsByForm.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Comparecimento por dia da semana" id="chart-attendance">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data.attendanceByWeekday}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar dataKey="compareceu" fill="#10b981" name="Compareceu" />
            <Bar dataKey="noShow" fill="#ef4444" name="Não compareceu" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Origem: Pago vs Orgânico" id="chart-origin">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.originSplit} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={90}>
              <Cell fill="#f59e0b" />
              <Cell fill="#06b6d4" />
            </Pie>
            <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
