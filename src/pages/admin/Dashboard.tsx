import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  TrendingUp, Wallet, Users, Target, Sparkles, Megaphone, ArrowUpRight,
  Calendar, CheckCircle2, Trophy, Activity,
} from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  Tooltip, Legend, XAxis, YAxis, CartesianGrid, Area, AreaChart,
} from "recharts";
import { useCountUp } from "@/hooks/useCountUp";
import { useInView } from "@/hooks/useInView";

type Lead = {
  id: string;
  status: string;
  origem: string | null;
  created_at: string;
  facebook_form_id: string | null;
  facebook_form_name: string | null;
  facebook_campaign: string | null;
};

type Spend = {
  id: string;
  channel: string;
  campaign_name: string | null;
  campaign_id: string | null;
  amount_spent: number;
  leads_generated: number;
  impressions: number;
  clicks: number;
  period_start: string;
  period_end: string;
};

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const COLORS = ["hsl(45 75% 70%)", "hsl(199 89% 60%)", "hsl(280 65% 65%)", "hsl(142 71% 55%)", "hsl(0 70% 65%)", "hsl(215 25% 55%)"];

const STATUS_GROUPS = {
  novo: ["novo"],
  qualificado: ["qualificado", "em_contato", "negociando", "em_negociacao", "avaliacao_agendada"],
  fechado: ["convertido", "fechado_ganho"],
  perdido: ["perdido", "fechado_perdido"],
};

const Dashboard = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [spends, setSpends] = useState<Spend[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7" | "30" | "90" | "all">("30");
  const [lastSync, setLastSync] = useState<string | null>(null);

  const periodDays = period === "all" ? 9999 : Number(period);
  const cutoff = new Date(Date.now() - periodDays * 86400000);

  const load = async () => {
    setLoading(true);
    const cutISO = cutoff.toISOString();
    const [l, s, cfg] = await Promise.all([
      supabase.from("leads").select("id,status,origem,created_at,facebook_form_id,facebook_form_name,facebook_campaign")
        .gte("created_at", cutISO).order("created_at", { ascending: false }).limit(5000),
      supabase.from("campaign_spend").select("*").gte("period_start", cutISO.slice(0, 10)).limit(2000),
      supabase.rpc("get_facebook_config_meta" as any),
    ]);
    setLeads((l.data ?? []) as Lead[]);
    setSpends((s.data ?? []) as Spend[]);
    const row: any = Array.isArray(cfg.data) ? cfg.data[0] : cfg.data;
    setLastSync(row?.last_campaigns_sync_at ?? null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // realtime: novos leads
    const ch = supabase.channel("dashboard-leads")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "leads" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  // auto-trigger sync once when stale (>15min)
  useEffect(() => {
    if (!lastSync) return;
    const ageMin = (Date.now() - new Date(lastSync).getTime()) / 60000;
    if (ageMin > 15) {
      supabase.functions.invoke("facebook-campaigns-sync", { body: { days: 30 } })
        .then(() => load()).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSync]);

  const stats = useMemo(() => {
    const total = leads.length;
    const fbLeads = leads.filter(l => l.origem === "facebook_ads").length;
    const novo = leads.filter(l => STATUS_GROUPS.novo.includes(l.status)).length;
    const qual = leads.filter(l => STATUS_GROUPS.qualificado.includes(l.status)).length;
    const fech = leads.filter(l => STATUS_GROUPS.fechado.includes(l.status)).length;
    const invested = spends.reduce((a, b) => a + Number(b.amount_spent || 0), 0);
    const cpl = total > 0 ? invested / total : 0;
    const convRate = total > 0 ? (fech / total) * 100 : 0;
    const qualRate = total > 0 ? (qual / total) * 100 : 0;
    return { total, fbLeads, novo, qual, fech, invested, cpl, convRate, qualRate };
  }, [leads, spends]);

  // leads by day
  const dailyLeads = useMemo(() => {
    const days = period === "all" ? 30 : Number(period);
    const buckets: Record<string, { date: string; leads: number; fb: number }> = {};
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      buckets[d] = { date: d.slice(5), leads: 0, fb: 0 };
    }
    for (const l of leads) {
      const d = l.created_at.slice(0, 10);
      if (buckets[d]) {
        buckets[d].leads += 1;
        if (l.origem === "facebook_ads") buckets[d].fb += 1;
      }
    }
    return Object.values(buckets);
  }, [leads, period]);

  // origem mix
  const originMix = useMemo(() => {
    const map: Record<string, number> = {};
    for (const l of leads) {
      const k = l.origem || "site";
      map[k] = (map[k] || 0) + 1;
    }
    const labels: Record<string, string> = {
      facebook_ads: "Facebook Ads",
      site: "Site",
      whatsapp: "WhatsApp",
      indicacao: "Indicação",
      organico: "Orgânico",
    };
    return Object.entries(map).map(([k, v]) => ({ name: labels[k] ?? k, value: v }));
  }, [leads]);

  // top campanhas FB
  const topCampaigns = useMemo(() => {
    const map = new Map<string, { name: string; leads: number; spent: number }>();
    for (const l of leads) {
      if (l.origem !== "facebook_ads") continue;
      const key = l.facebook_campaign || l.facebook_form_name || "(sem campanha)";
      const cur = map.get(key) || { name: key, leads: 0, spent: 0 };
      cur.leads += 1;
      map.set(key, cur);
    }
    for (const s of spends) {
      if (s.channel !== "meta_ads") continue;
      const key = s.campaign_name || "(sem campanha)";
      const cur = map.get(key) || { name: key, leads: 0, spent: 0 };
      cur.spent += Number(s.amount_spent || 0);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.leads - a.leads).slice(0, 6);
  }, [leads, spends]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.22em] text-accent/90 border border-accent/30 bg-accent/5 px-2.5 py-1 rounded-full">
              <Sparkles className="w-3 h-3" /> Comercial
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Painel Comercial</h1>
          <p className="text-muted-foreground text-sm">
            Leads, funil de qualificação e performance das campanhas — automático.
          </p>
          {lastSync && (
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Última sync Facebook Ads: {new Date(lastSync).toLocaleString("pt-BR")}
            </p>
          )}
        </div>
        <div className="flex gap-1 bg-card/70 backdrop-blur border border-border rounded-full p-1">
          {[{v:"7",l:"7d"},{v:"30",l:"30d"},{v:"90",l:"90d"},{v:"all",l:"Tudo"}].map(o => (
            <button key={o.v} onClick={() => setPeriod(o.v as any)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition ${period===o.v ? "gradient-accent text-[hsl(232_65%_5%)]" : "text-muted-foreground hover:text-foreground"}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        <KpiTile icon={Users} label="Leads" value={stats.total} accent="sky" sub="no período" />
        <KpiTile icon={Megaphone} label="Facebook Ads" value={stats.fbLeads} accent="gold" sub={`${stats.total ? Math.round(stats.fbLeads/stats.total*100) : 0}% do total`} />
        <KpiTile icon={CheckCircle2} label="Qualificados" value={stats.qual} accent="emerald" sub={`${stats.qualRate.toFixed(1)}% taxa`} />
        <KpiTile icon={Trophy} label="Fechados" value={stats.fech} accent="emerald" sub={`${stats.convRate.toFixed(1)}% conversão`} />
        <KpiTile icon={Wallet} label="Investido" value={stats.invested} prefix="R$ " accent="rose" sub="Meta Ads no período" />
        <KpiTile icon={Target} label="CPL" value={stats.cpl} prefix="R$ " accent="gold" sub="custo por lead" />
      </div>

      {/* Funil */}
      <div className="card-elevated p-6">
        <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Funil</p>
        <h3 className="font-display text-lg text-foreground normal-case tracking-normal mb-4">
          Funil de conversão
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {[
            { l: "Leads", v: stats.total, c: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
            { l: "Qualificados", v: stats.qual, c: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" },
            { l: "Novos (não trabalhados)", v: stats.novo, c: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
            { l: "Fechados", v: stats.fech, c: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
          ].map((s, i) => (
            <div key={i} className={`rounded-lg p-4 border ${s.c}`}>
              <div className="text-[10px] uppercase tracking-wider opacity-80">{s.l}</div>
              <div className="text-3xl font-bold mt-1 tabular-nums">{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Leads por dia + Origem */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 card-elevated p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Volume</p>
              <h3 className="font-display text-lg text-foreground normal-case tracking-normal">
                Leads por dia
              </h3>
            </div>
            <Activity className="w-5 h-5 text-accent/70" />
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyLeads} margin={{ top: 10, right: 16, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(199 89% 60%)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(199 89% 60%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fbFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(45 75% 70%)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="hsl(45 75% 70%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="hsl(224 30% 18%)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} />
                <YAxis stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="leads" name="Total" stroke="hsl(199 89% 60%)" strokeWidth={2.5} fill="url(#leadsFill)" />
                <Area type="monotone" dataKey="fb" name="Facebook Ads" stroke="hsl(45 75% 70%)" strokeWidth={2} fill="url(#fbFill)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-elevated p-6">
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Origens</p>
          <h3 className="font-display text-lg text-foreground normal-case tracking-normal mb-3">
            Por origem
          </h3>
          {originMix.length === 0 ? (
            <EmptyHint text="Sem leads no período" />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                  <Pie data={originMix} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2} stroke="hsl(226 53% 9%)">
                    {originMix.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11, color: "hsl(215 20% 65%)" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Top campanhas Facebook */}
      <div className="card-elevated p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Campanhas</p>
            <h3 className="font-display text-lg text-foreground normal-case tracking-normal">
              Top campanhas Facebook Ads
            </h3>
          </div>
          <Megaphone className="w-5 h-5 text-accent" />
        </div>
        {topCampaigns.length === 0 ? (
          <EmptyHint text="Nenhuma campanha encontrada. Sincronize em /admin/facebook." />
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topCampaigns} layout="vertical" margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid stroke="hsl(224 30% 18%)" strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" width={180} stroke="hsl(215 20% 65%)" fontSize={11} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(226 53% 9%)", border: "1px solid hsl(224 30% 22%)", borderRadius: 12, color: "#fff", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="leads" name="Leads" fill="hsl(199 89% 60%)" radius={[0, 6, 6, 0]} />
                <Bar dataKey="spent" name="Investido (R$)" fill="hsl(45 75% 70%)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
};

const EmptyHint = ({ text }: { text: string }) => (
  <div className="h-64 flex items-center justify-center text-sm text-muted-foreground/80 italic">{text}</div>
);

const ACCENTS: Record<string, { ring: string; text: string; bg: string; glow: string }> = {
  gold:   { ring: "ring-accent/25",        text: "text-accent",         bg: "bg-accent/10",         glow: "hover:shadow-[0_20px_45px_-20px_hsl(42_65%_58%/0.6)]" },
  emerald:{ ring: "ring-emerald-500/25",   text: "text-emerald-400",    bg: "bg-emerald-500/10",    glow: "hover:shadow-[0_20px_45px_-20px_hsl(142_71%_45%/0.5)]" },
  sky:    { ring: "ring-sky-500/25",       text: "text-sky-400",        bg: "bg-sky-500/10",        glow: "hover:shadow-[0_20px_45px_-20px_hsl(199_89%_48%/0.5)]" },
  rose:   { ring: "ring-rose-500/25",      text: "text-rose-400",       bg: "bg-rose-500/10",       glow: "hover:shadow-[0_20px_45px_-20px_hsl(347_77%_55%/0.5)]" },
};

const KpiTile = ({
  icon: Icon, label, value, prefix = "", suffix = "", decimals = 0, sub, accent = "gold",
}: any) => {
  const { ref, inView } = useInView<HTMLDivElement>();
  const animated = useCountUp(value, inView, 1200);
  const a = ACCENTS[accent] ?? ACCENTS.gold;
  const shown = decimals > 0 ? animated.toFixed(decimals) : Math.round(animated).toLocaleString("pt-BR");

  return (
    <div ref={ref}
      className={`group relative bg-card/80 backdrop-blur border border-border/50 rounded-2xl p-5 transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 ${a.glow}`}>
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none" />
      <div className="relative flex items-start justify-between mb-4">
        <div className={`w-11 h-11 rounded-xl ${a.bg} ring-1 ${a.ring} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${a.text}`} strokeWidth={1.8} />
        </div>
        <ArrowUpRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-accent group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition" />
      </div>
      <p className="relative text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-1">{label}</p>
      <p className="relative font-display text-3xl text-foreground tabular-nums">
        {prefix}{shown}{suffix}
      </p>
      {sub && <p className="relative text-[11px] text-muted-foreground/80 mt-2">{sub}</p>}
    </div>
  );
};

export default Dashboard;
