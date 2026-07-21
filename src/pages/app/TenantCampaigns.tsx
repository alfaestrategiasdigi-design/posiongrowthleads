import { useEffect, useMemo, useState } from "react";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Loader2, RefreshCw, TrendingUp, Users, DollarSign, Target, Download,
  Activity, AlertCircle, Megaphone, Star, ExternalLink, Copy, Eye, MousePointerClick,
  CalendarCheck, UserCheck, Zap, Repeat,
  Wallet, ArrowUpRight, ArrowDownRight, BadgeCheck,
  Search, GitCompare, ArrowDownAZ, X, Heart, ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";


import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { ResponsiveContainer, AreaChart, Area, LineChart, Line, Tooltip as RTooltip } from "recharts";
import CampaignFunnel from "@/components/campaigns/CampaignFunnel";
import CampaignDetailSheet from "@/components/campaigns/CampaignDetailSheet";
import AlertsPanel, { Alert } from "@/components/campaigns/AlertsPanel";

const BRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
const NUM = (v: number) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));
const daysAgoISO = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);

const OBJECTIVE_LABELS: Record<string, string> = {
  OUTCOME_LEADS: "Cadastros",
  LEAD_GENERATION: "Cadastros",
  OUTCOME_ENGAGEMENT: "Engajamento",
  MESSAGES: "Conversas",
  OUTCOME_SALES: "Vendas",
  CONVERSIONS: "Conversões",
  OUTCOME_TRAFFIC: "Tráfego",
  LINK_CLICKS: "Cliques",
  OUTCOME_AWARENESS: "Reconhecimento",
  BRAND_AWARENESS: "Reconhecimento",
  REACH: "Alcance",
  VIDEO_VIEWS: "Vídeo",
  OUTCOME_APP_PROMOTION: "App",
};
const formatObjective = (obj?: string) => {
  if (!obj) return "";
  const key = obj.toUpperCase();
  return OBJECTIVE_LABELS[key] || key.replace(/^OUTCOME_/, "").replace(/_/g, " ").toLowerCase();
};
const cprLabel = (kind?: "messaging" | "leads" | "purchases" | "link_clicks") => {
  switch (kind) {
    case "messaging": return "Custo/Conv";
    case "purchases": return "CPA";
    case "link_clicks": return "CPC";
    default: return "CPL";
  }
};


interface DailyPoint { date: string; spend: number; leads: number; clicks: number; impressions: number }
interface Campaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective?: string;
  daily_budget?: string;
  ad_account_id: string;
  ad_account_label?: string | null;
  insights: null | {
    spend: number; impressions: number; clicks: number;
    ctr: number; cpc: number; cpm: number;
    reach?: number; frequency?: number;
    leads: number; cpl: number;
    messaging?: number; link_clicks?: number;
    result_kind?: "messaging" | "leads" | "purchases" | "link_clicks";
    result_label?: string;
    result_value?: number;
    cost_per_result?: number;
    purchases: number; purchase_value: number; roas: number;
    hook_rate?: number; hold_rate?: number;
  };
  daily?: DailyPoint[];
}

type LinkedForm = {
  form_id: string;
  label: string;
  total_leads: number;
  last_lead_at: string | null;
};

type CampaignStats = { leads: number; meetings: number; showed: number; wins: number; revenue: number; contacts: number };

export default function TenantCampaigns({ tenantOverride }: { tenantOverride?: { id: string; slug: string; name: string; logo_url?: string | null; plan?: string; status?: string; segment?: string | null } } = {}) {
  const hookState = useTenant({ skip: !!tenantOverride });
  const tenant = (tenantOverride as any) ?? hookState.tenant;
  const tLoading = tenantOverride ? false : hookState.loading;
  const isMasterAccount = tenant?.id === "00000000-0000-0000-0000-000000000001";
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [activeOnly, setActiveOnly] = useState(true);
  const [period, setPeriod] = useState<1 | 7 | 14 | 30 | 90>(30);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crmStats, setCrmStats] = useState<Record<string, CampaignStats>>({});
  const [globalStats, setGlobalStats] = useState<CampaignStats>({ leads: 0, meetings: 0, showed: 0, wins: 0, revenue: 0, contacts: 0 });
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);

  const [lastSync, setLastSync] = useState<Date | null>(null);
  const [linkedForms, setLinkedForms] = useState<LinkedForm[]>([]);
  const [lastBackfill, setLastBackfill] = useState<Date | null>(null);
  const [detail, setDetail] = useState<Campaign | null>(null);

  // Filtros / ordenação / agrupamento / compare
  const [search, setSearch] = useState("");
  const [objectiveFilter, setObjectiveFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<"spend" | "leads" | "cpl" | "roas" | "ctr" | "name">("spend");
  const [groupBy, setGroupBy] = useState<"none" | "account" | "objective">("none");
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);



  const load = async () => {
    if (!tenant) return;
    setLoading(true); setError(null); setReason(null);
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("tenant-campaigns", {
        body: { tenant_id: tenant.id, active_only: activeOnly, days: period },
      });
      if (fnErr) throw fnErr;
      if (!data?.ok) {
        setReason(data?.reason ?? null);
        setError(data?.error ?? null);
        setCampaigns([]);
      } else {
        setCampaigns(data.data ?? []);
        setReason((data.data ?? []).length === 0 ? "no_campaigns" : null);
      }
      // Atribuição por campaign_id (primário), nome (fallback) e utm.
      // Consideramos leads criados no período E leads que ganharam no período (mesmo se antigos).
      const sinceISO = new Date(daysAgoISO(period) + "T00:00:00").toISOString();
      const campList = (data?.data ?? []) as Campaign[];
      const byId: Record<string, string> = {}; // campaign_id → key (id)
      const byName: Record<string, string> = {}; // nome normalizado → key (id)
      for (const c of campList) {
        byId[c.id] = c.id;
        if (c.name) byName[c.name.trim().toLowerCase()] = c.id;
      }
      const stats: Record<string, CampaignStats> = {};
      const globals: CampaignStats = { leads: 0, meetings: 0, showed: 0, wins: 0, revenue: 0, contacts: 0 };
      const normalizedPhone = (value?: string | null) => String(value ?? "").replace(/\D/g, "");
      const samePhone = (a?: string | null, b?: string | null) => {
        const pa = normalizedPhone(a);
        const pb = normalizedPhone(b);
        if (!pa || !pb) return false;
        return pa === pb || pa === `55${pb}` || `55${pa}` === pb || pa.slice(-8) === pb.slice(-8);
      };
      const normalizeCampaignText = (value?: string | null) => String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const similarCampaignName = (leadName?: string | null) => {
        const leadNorm = normalizeCampaignText(leadName);
        if (!leadNorm) return null;
        for (const c of campList) {
          const campNorm = normalizeCampaignText(c.name);
          if (!campNorm) continue;
          if (leadNorm === campNorm || leadNorm.startsWith(campNorm) || campNorm.startsWith(leadNorm)) return c.id;
        }
        return null;
      };
      const bump = (key: string | null, patch: (s: CampaignStats) => void) => {
        if (key) {
          stats[key] = stats[key] || { leads: 0, meetings: 0, showed: 0, wins: 0, revenue: 0, contacts: 0 };
          patch(stats[key]);
        }
        patch(globals);
      };
      const keyFor = (l: any): string | null => {
        if (l.facebook_campaign_id && byId[String(l.facebook_campaign_id).trim()]) return byId[String(l.facebook_campaign_id).trim()];
        // Alguns leads gravam o ID da campanha no campo `facebook_campaign` (não no *_id)
        if (l.facebook_campaign && byId[String(l.facebook_campaign).trim()]) return byId[String(l.facebook_campaign).trim()];
        if (l.campaign_id_manual && byId[String(l.campaign_id_manual).trim()]) return byId[String(l.campaign_id_manual).trim()];
        const n1 = (l.utm_campaign || "").trim().toLowerCase();
        if (n1 && byName[n1]) return byName[n1];
        const n2 = (l.facebook_campaign || "").trim().toLowerCase();
        if (n2 && byName[n2]) return byName[n2];
        return similarCampaignName(l.utm_campaign) ?? similarCampaignName(l.facebook_campaign);
      };
      const campIds = campList.map((c) => c.id).filter(Boolean);
      // Posion Master: leads da conta de agência ficam com tenant_id NULL.
      // Para o funil, contamos TODOS os leads do pipeline no período (mesmo sem match de campanha);
      // a atribuição por campanha (keyFor) segue restrita aos que casam com facebook_campaign_id/nome.
      let leadsQuery = supabase
        .from("leads")
        .select("id,whatsapp,utm_campaign,facebook_campaign,facebook_campaign_id,campaign_id_manual,valor_proposta,status,reuniao_agendada_em,reuniao_realizada_em,fechado_em,created_at,tenant_id")
        .gte("created_at", sinceISO);
      if (isMasterAccount) {
        leadsQuery = leadsQuery.is("tenant_id", null);
      } else {
        leadsQuery = leadsQuery.eq("tenant_id", tenant.id);
      }
      const { data: allLeads } = await leadsQuery;
      const leadRows = (allLeads ?? []) as any[];
      const leadIds = leadRows.map((l) => l.id);
      // Appointments no período (por lead). No Posion Master também existem reuniões criadas
      // direto na agenda sem lead_id; contamos globalmente e vinculamos por telefone quando possível.
      const untilISO = new Date(todayISO() + "T23:59:59").toISOString();
      let apptQuery = supabase
        .from("appointments")
        .select("lead_id,client_phone,status,date_time,tenant_id")
        .gte("date_time", sinceISO)
        .lte("date_time", untilISO);
      if (isMasterAccount) {
        apptQuery = apptQuery.is("tenant_id", null);
      } else {
        apptQuery = apptQuery.eq("tenant_id", tenant.id);
      }
      const { data: appts } = await apptQuery;
      const scheduledSet = new Set<string>();
      const showedSet = new Set<string>();
      const apptCampaignKeys = new Set<string>();
      // Dedup global de reuniões: usa lead_id quando existir; caso contrário telefone normalizado + data.
      const meetingDedup = new Set<string>();
      const showedDedup = new Set<string>();
      for (const a of appts ?? []) {
        const linkedLead = a.lead_id
          ? leadRows.find((l) => l.id === a.lead_id)
          : leadRows.find((l) => samePhone(l.whatsapp, a.client_phone));
        const k = linkedLead ? keyFor(linkedLead) : null;
        const showed = ["compareceu","realizado","fechado","confirmado"].includes(a.status);
        if (linkedLead?.id) {
          scheduledSet.add(linkedLead.id);
          if (showed) showedSet.add(linkedLead.id);
        }
        const dedupKey = a.lead_id
          ? `lead:${a.lead_id}`
          : `phone:${normalizedPhone(a.client_phone)}:${(a.date_time || "").slice(0,10)}`;
        if (!meetingDedup.has(dedupKey)) {
          meetingDedup.add(dedupKey);
          if (showed) showedDedup.add(dedupKey);
        }
        if (k) {
          const token = `${k}:${dedupKey}`;
          if (!apptCampaignKeys.has(token)) {
            apptCampaignKeys.add(token);
            stats[k] = stats[k] || { leads: 0, meetings: 0, showed: 0, wins: 0, revenue: 0, contacts: 0 };
            stats[k].meetings += 1;
            if (showed) stats[k].showed += 1;
          }
        }
      }
      for (const l of leadRows) {
        const k = keyFor(l);
        bump(k, (s) => { s.leads += 1; });
        if (l.status && !["lead","perdido"].includes(l.status)) bump(k, (s) => { s.contacts += 1; });
        // Atribuição por campanha: soma reuniões do CRM que não passaram pela agenda
        if (l.reuniao_agendada_em && !scheduledSet.has(l.id) && k) {
          stats[k] = stats[k] || { leads: 0, meetings: 0, showed: 0, wins: 0, revenue: 0, contacts: 0 };
          stats[k].meetings += 1;
        }
        if (l.reuniao_realizada_em && !showedSet.has(l.id) && k) {
          stats[k] = stats[k] || { leads: 0, meetings: 0, showed: 0, wins: 0, revenue: 0, contacts: 0 };
          stats[k].showed += 1;
        }
        // No Posion Master, contratos/receita vêm SOMENTE de agency_contracts (bloco abaixo).
        if (!isMasterAccount && l.status === "ganho") {
          const v = Number(l.valor_proposta) || 0;
          bump(k, (s) => { s.wins += 1; s.revenue += v; });
        }
      }
      globals.meetings = meetingDedup.size;
      globals.showed = showedDedup.size;

      // Posion Master: receita real = agency_contracts (valor assinado no contrato).
      // O trigger cria contrato quando o lead vai para stage IN ('ganho','ativo').
      if (isMasterAccount) {
        const { data: contracts } = await supabase
          .from("agency_contracts")
          .select("id,valor_total,data_assinatura,agency_leads!inner(campaign_id,campaign_id_manual,utm_campaign)")
          .gte("data_assinatura", sinceISO.slice(0, 10));
        for (const c of (contracts ?? []) as any[]) {
          const v = Number(c.valor_total) || 0;
          const lead = (c as any).agency_leads || {};
          const rawKey = lead.campaign_id || lead.campaign_id_manual;
          const nameNorm = (lead.utm_campaign || "").trim().toLowerCase();
          const k = (rawKey && byId[String(rawKey).trim()])
            || (nameNorm && byName[nameNorm])
            || similarCampaignName(lead.utm_campaign);
          bump(k, (s) => { s.wins += 1; s.revenue += v; });
        }
      }
      setCrmStats(stats);
      setGlobalStats(globals);
      setLastSync(new Date());

    } catch (e: any) {
      setError(e?.message ?? "Erro ao carregar campanhas");
      setCampaigns([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { if (tenant) { load(); loadLinkedForms(); } /* eslint-disable-next-line */ }, [tenant?.id, activeOnly, period]);

  const loadLinkedForms = async () => {
    if (!tenant) return;
    const { data: rules } = await supabase
      .from("lead_routing_rules")
      .select("match_value,match_label")
      .eq("tenant_id", tenant.id).eq("match_type", "form_id").eq("active", true);
    const ruleList = (rules ?? []) as Array<{ match_value: string; match_label: string | null }>;
    if (ruleList.length === 0) { setLinkedForms([]); setLastBackfill(null); return; }
    const ids = ruleList.map((r) => r.match_value);
    // Leads reais do Meta ficam em public.leads (facebook_form_id).
    // Consultamos por tenant_id + form_id para contar/agregar por formulário
    // e usamos facebook_form_name como fallback quando o rótulo da regra estiver vazio.
    const { data: leads } = await supabase
      .from("leads")
      .select("facebook_form_id,facebook_form_name,created_at")
      .eq("tenant_id", tenant.id)
      .in("facebook_form_id", ids);
    const rows = ((leads ?? []) as unknown) as Array<{
      facebook_form_id: string; facebook_form_name: string | null; created_at: string;
    }>;
    const byForm: Record<string, { total: number; last: string | null; name: string | null }> = {};
    let globalLast: string | null = null;
    for (const l of rows) {
      const k = l.facebook_form_id;
      byForm[k] = byForm[k] || { total: 0, last: null, name: null };
      byForm[k].total += 1;
      if (!byForm[k].name && l.facebook_form_name) byForm[k].name = l.facebook_form_name;
      if (!byForm[k].last || l.created_at > byForm[k].last!) byForm[k].last = l.created_at;
      if (!globalLast || l.created_at > globalLast) globalLast = l.created_at;
    }
    setLinkedForms(ruleList.map((r) => ({
      form_id: r.match_value,
      label: r.match_label || byForm[r.match_value]?.name || `Form ${r.match_value}`,
      total_leads: byForm[r.match_value]?.total ?? 0,
      last_lead_at: byForm[r.match_value]?.last ?? null,
    })));
    setLastBackfill(globalLast ? new Date(globalLast) : null);
  };

  const kpis = useMemo(() => {
    const s = campaigns.reduce((acc, c) => {
      if (!c.insights) return acc;
      acc.spend += c.insights.spend;
      acc.leads += c.insights.leads;
      acc.impressions += c.insights.impressions;
      acc.clicks += c.insights.clicks;
      acc.reach += c.insights.reach || 0;
      acc.revenue += c.insights.purchase_value;
      return acc;
    }, { spend: 0, leads: 0, impressions: 0, clicks: 0, reach: 0, revenue: 0 });
    // Faturamento e CAC baseados na receita real do CRM (kanban ganho).
    const totalRev = s.revenue + globalStats.revenue;
    const wins = globalStats.wins;
    // Frequência média ponderada (pelo alcance)
    const freq = s.reach > 0 ? s.impressions / s.reach : 0;
    return {
      spend: s.spend, leads: s.leads, revenue: totalRev,
      cpl: s.leads ? s.spend / s.leads : 0,
      roas: s.spend ? totalRev / s.spend : 0,
      active: campaigns.filter((c) => c.effective_status === "ACTIVE" || c.status === "ACTIVE").length,
      total: campaigns.length,
      wins,
      ctr: s.impressions ? (s.clicks / s.impressions) * 100 : 0,
      cpm: s.impressions ? (s.spend / s.impressions) * 1000 : 0,
      frequency: freq,
      appointments: globalStats.meetings,
      showed: globalStats.showed,
      cost_per_appointment: globalStats.meetings ? s.spend / globalStats.meetings : 0,
      cost_per_show: globalStats.showed ? s.spend / globalStats.showed : 0,
      show_rate: globalStats.meetings ? (globalStats.showed / globalStats.meetings) * 100 : 0,
      cac: wins ? s.spend / wins : 0,
      ticket: wins ? totalRev / wins : 0,
    };
  }, [campaigns, globalStats]);


  // Agrega séries diárias de todas as campanhas para os sparklines dos KPIs
  const dailyTotals = useMemo(() => {
    const map = new Map<string, { date: string; spend: number; leads: number; clicks: number; impressions: number }>();
    for (const c of campaigns) {
      for (const d of c.daily ?? []) {
        if (!d.date) continue;
        const prev = map.get(d.date) ?? { date: d.date, spend: 0, leads: 0, clicks: 0, impressions: 0 };
        prev.spend += d.spend || 0; prev.leads += d.leads || 0;
        prev.clicks += d.clicks || 0; prev.impressions += d.impressions || 0;
        map.set(d.date, prev);
      }
    }
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [campaigns]);

  const globalAlerts: Alert[] = useMemo(() => {
    const freqAlerts: Alert[] = [];
    const hookAlerts: Alert[] = [];
    for (const c of campaigns) {
      const ins: any = c.insights;
      if (!ins) continue;
      const impressions = ins.impressions ?? 0;
      const videoViews = ins.video_views ?? 0;
      if ((ins.frequency ?? 0) > 3.5 && impressions >= 2000) {
        freqAlerts.push({ id: `freq-${c.id}`, severity: "warn", title: "Frequência alta", description: `${c.name}: frequência ${ins.frequency?.toFixed(1)}. Sinal de fadiga — considere novos criativos.`, scope: c.ad_account_label || c.ad_account_id });
      }
      if ((ins.hook_rate ?? 0) > 0 && (ins.hook_rate ?? 0) < 15 && impressions >= 1000 && videoViews >= 200) {
        hookAlerts.push({ id: `hook-${c.id}`, severity: "warn", title: "Hook Rate fraco", description: `${c.name}: Hook Rate ${ins.hook_rate?.toFixed(0)}% (< 15%). Reescreva os primeiros 3 segundos.`, scope: c.ad_account_label || c.ad_account_id });
      }
    }
    // Limita ruído: mostra no máximo 3 por regra (adicionamos sufixo se houver mais)
    const cap = (list: Alert[], key: string): Alert[] => {
      if (list.length <= 3) return list;
      const top = list.slice(0, 3);
      top.push({ id: `${key}-more`, severity: "info", title: `+${list.length - 3} campanhas com ${key === "hook" ? "Hook Rate fraco" : "frequência alta"}`, description: "Abra a campanha para investigar." });
      return top;
    };
    const out: Alert[] = [...cap(freqAlerts, "freq"), ...cap(hookAlerts, "hook")];
    if (kpis.show_rate > 0 && kpis.show_rate < 60 && kpis.appointments >= 5) {
      out.push({ id: "show-rate", severity: "critical", title: "Taxa de show baixa", description: `${kpis.show_rate.toFixed(0)}% (< 60%). Reforce lembretes por WhatsApp ou peça sinal/pré-pagamento.`, scope: "Funil" });
    }
    if (kpis.wins > 0 && kpis.leads > 20) {
      const closeRate = (kpis.wins / kpis.leads) * 100;
      if (closeRate < 5) {
        out.push({ id: "close-rate", severity: "warn", title: "Conversão de leads em vendas baixa", description: `Apenas ${closeRate.toFixed(1)}% dos leads viraram venda. Reveja qualificação e atendimento SDR.`, scope: "Funil" });
      }
    }
    return out;
  }, [campaigns, kpis]);


  // Delta período-a-período (2ª metade x 1ª metade das séries diárias)
  const deltas = useMemo(() => {
    const arr = dailyTotals;
    if (arr.length < 2) return { spend: 0, leads: 0 };
    const mid = Math.floor(arr.length / 2);
    const a = arr.slice(0, mid); const b = arr.slice(mid);
    const sumA = a.reduce((s, d) => ({ spend: s.spend + d.spend, leads: s.leads + d.leads }), { spend: 0, leads: 0 });
    const sumB = b.reduce((s, d) => ({ spend: s.spend + d.spend, leads: s.leads + d.leads }), { spend: 0, leads: 0 });
    const pct = (prev: number, curr: number) => prev > 0 ? ((curr - prev) / prev) * 100 : 0;
    return { spend: pct(sumA.spend, sumB.spend), leads: pct(sumA.leads, sumB.leads) };
  }, [dailyTotals]);

  // Objetivos únicos para filtro
  const objectiveOptions = useMemo(() => {
    const set = new Set<string>();
    campaigns.forEach((c) => { if (c.objective) set.add(c.objective); });
    return Array.from(set);
  }, [campaigns]);

  // Score de saúde da campanha (0-100)
  const healthOf = (c: Campaign, revenue: number): { label: string; tone: "emerald" | "amber" | "rose" | "muted"; score: number } => {
    if (!c.insights || c.insights.spend === 0) return { label: "Sem dados", tone: "muted", score: 0 };
    const roas = c.insights.spend ? revenue / c.insights.spend : 0;
    const ctr = c.insights.ctr ?? 0;
    const freq = c.insights.frequency ?? 0;
    let score = 50;
    if (roas >= 2) score += 30; else if (roas >= 1) score += 15; else if (roas > 0) score -= 15;
    if (ctr >= 2) score += 15; else if (ctr < 0.8) score -= 10;
    if (freq > 4) score -= 15; else if (freq > 3) score -= 5;
    if (c.insights.leads > 0 && c.insights.cpl > 0) {
      // heurística leve — CPL muito alto derruba
      if (c.insights.cpl > 100) score -= 10;
    }
    score = Math.max(0, Math.min(100, score));
    if (score >= 75) return { label: "Ótima", tone: "emerald", score };
    if (score >= 50) return { label: "OK", tone: "amber", score };
    return { label: "Atenção", tone: "rose", score };
  };

  // Filtra + ordena
  const visibleCampaigns = useMemo(() => {
    let list = campaigns.slice();
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((c) => c.name.toLowerCase().includes(q) || c.id.includes(q));
    }
    if (objectiveFilter !== "all") list = list.filter((c) => c.objective === objectiveFilter);
    const getVal = (c: Campaign): number | string => {
      const ins = c.insights;
      const stat = crmStats[c.id];
      const rev = (ins?.purchase_value || 0) + (stat?.revenue || 0);
      switch (sortKey) {
        case "spend": return ins?.spend ?? 0;
        case "leads": return ins?.leads ?? 0;
        case "cpl": return ins?.cpl ?? Infinity;
        case "roas": return ins?.spend ? rev / ins.spend : 0;
        case "ctr": return ins?.ctr ?? 0;
        case "name": return c.name.toLowerCase();
      }
    };
    list.sort((a, b) => {
      const va = getVal(a); const vb = getVal(b);
      if (sortKey === "name") return String(va).localeCompare(String(vb));
      if (sortKey === "cpl") return (Number(va) || 0) - (Number(vb) || 0);
      return (Number(vb) || 0) - (Number(va) || 0);
    });
    return list;
  }, [campaigns, crmStats, search, objectiveFilter, sortKey]);

  // Best/worst por ROAS (com investimento)
  const bestWorst = useMemo(() => {
    const withRoas = campaigns
      .filter((c) => c.insights && c.insights.spend > 50)
      .map((c) => {
        const rev = (c.insights!.purchase_value || 0) + (crmStats[c.id]?.revenue || 0);
        return { id: c.id, name: c.name, roas: c.insights!.spend ? rev / c.insights!.spend : 0, spend: c.insights!.spend };
      });
    if (!withRoas.length) return { best: null, worst: null };
    const sorted = withRoas.slice().sort((a, b) => b.roas - a.roas);
    return { best: sorted[0], worst: sorted[sorted.length - 1] };
  }, [campaigns, crmStats]);

  // Agrupamento
  const grouped = useMemo(() => {
    if (groupBy === "none") return [{ key: "all", label: "", items: visibleCampaigns }];
    const map = new Map<string, { label: string; items: Campaign[] }>();
    for (const c of visibleCampaigns) {
      const key = groupBy === "account" ? (c.ad_account_label || c.ad_account_id) : (c.objective || "Sem objetivo");
      const label = groupBy === "account" ? (c.ad_account_label || c.ad_account_id) : formatObjective(c.objective);
      if (!map.has(key)) map.set(key, { label, items: [] });
      map.get(key)!.items.push(c);
    }
    return Array.from(map.entries()).map(([key, v]) => ({ key, label: v.label, items: v.items }));
  }, [visibleCampaigns, groupBy]);

  const toggleCompare = (id: string) => {
    setCompareIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id]);
  };

  const periodLabel = period === 1 ? "hoje" : period === 7 ? "últimos 7 dias" : period === 14 ? "últimos 14 dias" : period === 30 ? "últimos 30 dias" : "últimos 90 dias";


  if (tLoading || !tenant) {
    return <div className="p-8 flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>;
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Marketing · Meta Ads</div>
          <h1 className="font-display text-2xl md:text-3xl mt-1 flex items-center gap-2">
            <Megaphone className="w-6 h-6 text-primary" /> Campanhas
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {tenant.name} · {periodLabel} {lastSync && <span className="text-xs opacity-60">· sync {lastSync.toLocaleTimeString("pt-BR")}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <div className="inline-flex rounded-md border border-white/10 bg-background/40 p-0.5">
            {[1, 7, 14, 30, 90].map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p as any)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-sm tabular-nums transition-colors ${
                  period === p ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p === 1 ? "Hoje" : `${p}d`}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={activeOnly} onCheckedChange={setActiveOnly} /> Apenas ativas
          </label>
          <Button variant="outline" size="sm" onClick={() => exportCsv(campaigns, crmStats)} disabled={!campaigns.length} className="gap-2" aria-label="Exportar CSV">
            <Download className="w-4 h-4" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={load} disabled={loading} className="gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Atualizar
          </Button>
        </div>
      </div>

      {/* Bloco 1: Mídia (Meta) */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-amber-400/80 mb-2">Mídia · Meta Ads</div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          <Kpi icon={Activity} label="Ativas" value={`${kpis.active}/${kpis.total}`} tone="primary" />
          <Kpi icon={DollarSign} label="Investido" value={BRL(kpis.spend)} tone="amber"
               series={dailyTotals} dataKey="spend" formatter={(v) => BRL(v)} delta={deltas.spend} />

          <Kpi icon={MousePointerClick} label="Impressões" value={NUM(campaigns.reduce((a,c)=>a+(c.insights?.impressions||0),0))} tone="cyan" />
          <Kpi icon={Target} label="CTR" value={`${kpis.ctr.toFixed(2)}%`} tone="violet" />
          <Kpi icon={DollarSign} label="CPM" value={BRL(kpis.cpm)} tone="amber" />
          <Kpi icon={Repeat} label="Frequência" value={kpis.frequency.toFixed(2)} tone="violet" />
        </div>
      </div>

      {/* Bloco 2: Funil (Clínica ou Agência — mesmos cálculos, apenas rótulos mudam) */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-cyan-400/80 mb-2">
          {isMasterAccount ? "Funil da Agência" : "Funil da Clínica"}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-7 gap-3">
          <Kpi icon={Users} label="Leads" value={NUM(kpis.leads)} tone="cyan"
               series={dailyTotals} dataKey="leads" formatter={(v) => NUM(v)} delta={deltas.leads} />
          <Kpi icon={Target} label="CPL" value={BRL(kpis.cpl)} tone="violet" />
          <Kpi icon={CalendarCheck} label={isMasterAccount ? "Reuniões Agendadas" : "Consultas Agendadas"} value={NUM(kpis.appointments)} tone="cyan" />
          <Kpi icon={Target} label={isMasterAccount ? "Custo/Reunião" : "Custo/Consulta"} value={kpis.appointments ? BRL(kpis.cost_per_appointment) : "—"} tone="violet" />
          <Kpi icon={UserCheck} label={isMasterAccount ? "Reuniões Realizadas" : "Consultas Realizadas"} value={NUM(kpis.showed)} tone="emerald" />
          <Kpi icon={Target} label="Custo/Realizada" value={kpis.showed ? BRL(kpis.cost_per_show) : "—"} tone="rose" />
          <Kpi icon={TrendingUp} label="Taxa de Show" value={kpis.appointments ? `${kpis.show_rate.toFixed(0)}%` : "—"} tone={kpis.show_rate >= 60 ? "emerald" : "rose"} />
        </div>
      </div>

      {/* Bloco 3: Resultado · CRM (mesmos KPIs; "Vendas" vira "Contratos" no Posion Master) */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.22em] text-emerald-400/80 mb-2">Resultado · CRM</div>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          <Kpi icon={Star} label={isMasterAccount ? "Contratos" : "Vendas"} value={NUM(kpis.wins)} tone="emerald" />
          <Kpi icon={DollarSign} label="Ticket Médio" value={kpis.wins ? BRL(kpis.ticket) : "—"} tone="amber" />
          <Kpi icon={TrendingUp} label="Receita" value={BRL(kpis.revenue)} tone="emerald" />
          <Kpi icon={UserCheck} label="CAC" value={kpis.wins ? BRL(kpis.cac) : "—"} tone="rose" />
          <Kpi icon={Star} label="ROAS real" value={`${kpis.roas.toFixed(2)}x`} tone={kpis.roas >= 2 ? "emerald" : "rose"} />
        </div>
      </div>

      {/* Funil visual */}
      <CampaignFunnel
        spend={kpis.spend}
        leads={kpis.leads}
        contacts={globalStats.contacts}
        appointments={kpis.appointments}
        showed={kpis.showed}
        sales={kpis.wins}
        labels={isMasterAccount ? {
          title: "Funil da Agência",
          appointments: "Reunião Agendada",
          showed: "Reunião Realizada",
          sales: "Contrato",
          appointmentCost: "Custo/Reunião",
          showedCost: "Custo/Realizada",
          cac: "CAC",
        } : undefined}
      />








      {/* Linked Lead Forms */}
      <Card className="p-4 bg-gradient-to-br from-card to-background/60 border-primary/10">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-primary/80 flex items-center gap-1.5">
              <Target className="w-3 h-3" /> Formulários Meta vinculados
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {linkedForms.length === 0
                ? "Nenhum formulário Meta Lead Ads vinculado a esta clínica ainda. Peça à Posion para conectar."
                : `${linkedForms.length} formulário(s) puxando leads automaticamente a cada 15 min.`}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Último lead recebido</div>
            <div className="text-sm font-mono tabular-nums text-emerald-400 mt-0.5">
              {lastBackfill
                ? lastBackfill.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                : "—"}
            </div>
          </div>
        </div>
        {linkedForms.length > 0 && (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {linkedForms.map((f) => (
              <div key={f.form_id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-background/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate" title={f.label}>{f.label}</div>
                  <div className="text-[10px] font-mono text-muted-foreground truncate">{f.form_id}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold tabular-nums text-primary">{NUM(f.total_leads)}</div>
                  <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
                    {f.last_lead_at ? new Date(f.last_lead_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "sem leads"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>



      {/* States */}
      {error && (
        <Card className="p-4 border-destructive/40 bg-destructive/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div className="text-sm">{error}</div>
        </Card>
      )}

      {!error && reason === "no_mapping" && (
        <Card className="p-6 text-center">
          <Megaphone className="w-10 h-10 text-muted-foreground/50 mx-auto mb-3" />
          <div className="font-medium mb-1">Nenhuma conta de anúncio conectada</div>
          <div className="text-sm text-muted-foreground">
            Peça à Posion para vincular sua conta Meta Ads (ad account) ao seu tenant para ver as campanhas aqui.
          </div>
        </Card>
      )}

      {!error && reason === "no_campaigns" && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Nenhuma campanha {activeOnly ? "ativa" : ""} encontrada no período.
        </Card>
      )}

      {/* Barra de filtros / ordenação / agrupamento */}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
        <div className="text-[10px] uppercase tracking-[0.22em] text-primary/70 mr-2">
          Performance · {visibleCampaigns.length}/{campaigns.length}
        </div>
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar campanha ou ID…"
            className="h-8 pl-8 text-xs bg-background/60"
          />
        </div>
        <Select value={objectiveFilter} onValueChange={setObjectiveFilter}>
          <SelectTrigger className="h-8 text-xs w-[140px] bg-background/60"><SelectValue placeholder="Objetivo" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos objetivos</SelectItem>
            {objectiveOptions.map((o) => <SelectItem key={o} value={o}>{formatObjective(o)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortKey} onValueChange={(v) => setSortKey(v as any)}>
          <SelectTrigger className="h-8 text-xs w-[150px] bg-background/60">
            <ArrowDownAZ className="w-3.5 h-3.5 mr-1" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="spend">Ordenar: Investido</SelectItem>
            <SelectItem value="leads">Ordenar: Leads</SelectItem>
            <SelectItem value="cpl">Ordenar: CPL ↑</SelectItem>
            <SelectItem value="roas">Ordenar: ROAS</SelectItem>
            <SelectItem value="ctr">Ordenar: CTR</SelectItem>
            <SelectItem value="name">Ordenar: Nome</SelectItem>
          </SelectContent>
        </Select>
        <Select value={groupBy} onValueChange={(v) => setGroupBy(v as any)}>
          <SelectTrigger className="h-8 text-xs w-[140px] bg-background/60"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Sem agrupar</SelectItem>
            <SelectItem value="account">Por conta</SelectItem>
            <SelectItem value="objective">Por objetivo</SelectItem>
          </SelectContent>
        </Select>
        <Button
          size="sm" variant={compareMode ? "default" : "outline"}
          className="h-8 text-xs gap-1"
          onClick={() => { setCompareMode((v) => !v); if (compareMode) setCompareIds([]); }}
        >
          <GitCompare className="w-3.5 h-3.5" /> Comparar
        </Button>
      </div>

      {/* Best / Worst */}
      {(bestWorst.best || bestWorst.worst) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {bestWorst.best && (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 flex items-center gap-2 text-xs">
              <ArrowUpRight className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[9px] uppercase tracking-wider text-emerald-400/80">Melhor ROAS</div>
                <div className="truncate">{bestWorst.best.name}</div>
              </div>
              <div className="font-bold tabular-nums text-emerald-400">{bestWorst.best.roas.toFixed(2)}x</div>
            </div>
          )}
          {bestWorst.worst && bestWorst.worst.id !== bestWorst.best?.id && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 flex items-center gap-2 text-xs">
              <ArrowDownRight className="w-4 h-4 text-rose-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[9px] uppercase tracking-wider text-rose-400/80">Pior ROAS</div>
                <div className="truncate">{bestWorst.worst.name}</div>
              </div>
              <div className="font-bold tabular-nums text-rose-400">{bestWorst.worst.roas.toFixed(2)}x</div>
            </div>
          )}
        </div>
      )}

      {/* Barra de compare fixa */}
      {compareMode && compareIds.length > 0 && (
        <div className="sticky top-2 z-30 flex items-center gap-2 rounded-lg border border-primary/30 bg-background/95 backdrop-blur px-3 py-2 shadow-lg">
          <GitCompare className="w-4 h-4 text-primary" />
          <div className="text-xs font-medium">{compareIds.length} selecionada(s) — máx 4</div>
          <div className="flex-1" />
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCompareIds([])}>
            <X className="w-3 h-3 mr-1" /> Limpar
          </Button>
          <Button size="sm" className="h-7 text-xs" disabled={compareIds.length < 2} onClick={() => setCompareOpen(true)}>
            Comparar {compareIds.length}
          </Button>
        </div>
      )}

      {/* Grupos + Cards densos */}
      {grouped.map((g) => (
        <div key={g.key} className="space-y-2">
          {g.label && (
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground border-b border-white/5 pb-1">
              <ChevronDown className="w-3 h-3" /> {g.label}
              <span className="text-primary/70">· {g.items.length}</span>
            </div>
          )}
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {g.items.map((c) => {
              const stat = crmStats[c.id];
              const wins = stat?.wins ?? 0;
              // Receita atribuída à campanha (Pixel + wins atribuídos no CRM), sem misturar com wins globais/orgânicos.
              const revenue = (c.insights?.purchase_value || 0) + (stat?.revenue || 0);
              const spend = c.insights?.spend || 0;
              const roas = spend ? revenue / spend : 0;
              const isActive = c.effective_status === "ACTIVE" || c.status === "ACTIVE";
              const health = healthOf(c, revenue);
              const dailyBudget = c.daily_budget ? Number(c.daily_budget) / 100 : 0;
              // Uso do orçamento diário: usa dias com gasto real na janela (não o `period` selecionado),
              // evitando percentuais artificialmente baixos quando a campanha começou depois.
              const daysWithSpend = (c.daily ?? []).filter((d) => (d.spend || 0) > 0).length || 1;
              const spendPct = dailyBudget > 0 ? Math.min(100, (spend / (dailyBudget * daysWithSpend)) * 100) : 0;
              const selected = compareIds.includes(c.id);
              const metaUrl = `https://business.facebook.com/adsmanager/manage/campaigns?act=${(c.ad_account_id || "").replace(/^act_/, "")}&selected_campaign_ids=${c.id}`;
              const toneMap = {
                emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
                amber: "bg-amber-500/10 text-amber-400 border-amber-500/30",
                rose: "bg-rose-500/10 text-rose-400 border-rose-500/30",
                muted: "bg-muted/40 text-muted-foreground border-white/10",
              } as const;
              return (
                <Card
                  key={c.id}
                  className={`relative p-3 flex flex-col gap-2 transition-all overflow-hidden group cursor-pointer hover:shadow-lg hover:shadow-primary/5 ${selected ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40"}`}
                  onClick={() => compareMode ? toggleCompare(c.id) : setDetailCampaign(c)}
                >
                  <div className={`absolute left-0 top-0 h-full w-[3px] ${isActive ? "bg-emerald-400" : "bg-muted"}`} />

                  {compareMode && (
                    <div className="absolute right-2 top-2 z-10" onClick={(e) => { e.stopPropagation(); toggleCompare(c.id); }}>
                      <Checkbox checked={selected} />
                    </div>
                  )}

                  {/* Cabeçalho */}
                  <div className="pl-1.5 pr-6">
                    <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${isActive ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-muted/40 border-white/10 text-muted-foreground"}`}>
                        {isActive ? "● ativa" : "○ pausada"}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border ${toneMap[health.tone]}`}>
                        <Heart className="w-2.5 h-2.5" /> {health.label}
                      </span>
                      {c.objective && <span className="text-primary/60 truncate">{formatObjective(c.objective)}</span>}
                    </div>
                    <div className="text-[13px] font-medium leading-tight mt-1 line-clamp-2" title={c.name}>{c.name}</div>
                    <div className="text-[9px] text-muted-foreground truncate mt-0.5">{c.ad_account_label || c.ad_account_id}</div>
                  </div>

                  {/* Métricas principais em linha */}
                  <div className="grid grid-cols-3 gap-1 pl-1.5">
                    <div className="rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-1.5">
                      <div className="text-[8px] uppercase tracking-wider text-amber-400/80">Investido</div>
                      <div className="text-[13px] font-bold tabular-nums text-amber-400">{BRL(spend)}</div>
                    </div>
                    <div className="rounded-md border border-cyan-500/20 bg-cyan-500/5 px-2 py-1.5">
                      <div className="text-[8px] uppercase tracking-wider text-cyan-400/80">CPL</div>
                      <div className="text-[13px] font-bold tabular-nums text-cyan-400">{c.insights?.leads ? BRL(c.insights.cpl) : "—"}</div>
                    </div>
                    <div className={`rounded-md border px-2 py-1.5 ${revenue > 0 && roas >= 1 ? "border-emerald-500/20 bg-emerald-500/5" : revenue > 0 ? "border-rose-500/20 bg-rose-500/5" : "border-muted-foreground/20 bg-muted/30"}`}>
                      <div className={`text-[8px] uppercase tracking-wider ${revenue > 0 && roas >= 1 ? "text-emerald-400/80" : revenue > 0 ? "text-rose-400/80" : "text-muted-foreground"}`}>ROAS</div>
                      <div className={`text-[13px] font-bold tabular-nums ${revenue > 0 && roas >= 1 ? "text-emerald-400" : revenue > 0 ? "text-rose-400" : "text-muted-foreground"}`}>{revenue > 0 ? `${roas.toFixed(2)}x` : "—"}</div>
                    </div>
                  </div>

                  {/* Micro-métricas */}
                  <div className="grid grid-cols-4 gap-1 pl-1.5 text-[10px]">
                    <MiniStat label="Leads" value={NUM(stat?.leads ?? 0)} />
                    <MiniStat label={isMasterAccount ? "Reuniões" : "Consult."} value={NUM(stat?.meetings ?? 0)} />
                    <MiniStat label={isMasterAccount ? "Contratos" : "Vendas"} value={NUM(wins)} />
                    <MiniStat label="CTR" value={c.insights ? `${c.insights.ctr.toFixed(1)}%` : "—"} />
                  </div>

                  {/* Barra de orçamento diário */}
                  {dailyBudget > 0 && (
                    <div className="pl-1.5">
                      <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-0.5">
                        <span>Uso do orçamento · {BRL(dailyBudget)}/dia</span>
                        <span className="tabular-nums">{spendPct.toFixed(0)}%</span>
                      </div>
                      <Progress value={spendPct} className="h-1" />
                    </div>
                  )}

                  {/* Sparkline compacta */}
                  {c.daily && c.daily.length > 1 && (
                    <div className="pl-1.5">
                      <Sparkline data={c.daily} dataKey="leads" color="#22d3ee" />
                    </div>
                  )}

                  {/* Ações */}
                  <div className="flex items-center gap-0.5 pl-1 pt-0.5 opacity-70 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1" onClick={() => setDetailCampaign(c)}>
                      <Eye className="w-3 h-3" /> Analisar
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1" onClick={() => window.open(metaUrl, "_blank")}>
                      <ExternalLink className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] gap-1" onClick={async () => { await navigator.clipboard.writeText(c.id); toast.success("ID copiado"); }}>
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ))}

      {/* Alertas globais (compacto, após os cards) */}
      <AlertsPanel alerts={globalAlerts} />

      <CampaignDetailSheet
        open={!!detailCampaign}
        onClose={() => setDetailCampaign(null)}
        tenantId={tenant.id}
        campaign={detailCampaign as any}
        since={daysAgoISO(period)}
        until={todayISO()}
        labels={isMasterAccount ? {
          title: "Funil da Agência",
          appointments: "Reuniões",
          showed: "Realizadas",
          sales: "Contratos",
          appointmentCost: "Custo/Reunião",
          showedCost: "Custo/Realizada",
          cac: "CAC",
        } : undefined}
      />

      {/* Diálogo de comparação */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="max-w-6xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><GitCompare className="w-5 h-5 text-primary" /> Comparar campanhas</DialogTitle>
            <DialogDescription>Métricas lado a lado no período de {periodLabel}.</DialogDescription>
          </DialogHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="text-left py-2 px-2 sticky left-0 bg-card">Métrica</th>
                  {compareIds.map((id) => {
                    const c = campaigns.find((x) => x.id === id);
                    return <th key={id} className="text-left py-2 px-2 font-medium text-foreground max-w-[220px] truncate" title={c?.name}>{c?.name || id}</th>;
                  })}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {(() => {
                  const rows: Array<{ label: string; fn: (c: Campaign) => string }> = [
                    { label: "Status", fn: (c) => (c.effective_status === "ACTIVE" || c.status === "ACTIVE") ? "Ativa" : "Pausada" },
                    { label: "Objetivo", fn: (c) => formatObjective(c.objective) },
                    { label: "Investido", fn: (c) => BRL(c.insights?.spend || 0) },
                    { label: "Impressões", fn: (c) => NUM(c.insights?.impressions || 0) },
                    { label: "CTR", fn: (c) => c.insights ? `${c.insights.ctr.toFixed(2)}%` : "—" },
                    { label: "CPM", fn: (c) => c.insights ? BRL(c.insights.cpm) : "—" },
                    { label: "Frequência", fn: (c) => c.insights?.frequency ? c.insights.frequency.toFixed(2) : "—" },
                    { label: "Leads", fn: (c) => NUM(c.insights?.leads || 0) },
                    { label: "CPL", fn: (c) => c.insights?.leads ? BRL(c.insights.cpl) : "—" },
                    { label: "Consultas", fn: (c) => NUM(crmStats[c.id]?.meetings || 0) },
                    { label: "Realizadas", fn: (c) => NUM(crmStats[c.id]?.showed || 0) },
                    { label: "Vendas", fn: (c) => NUM(crmStats[c.id]?.wins || 0) },
                    { label: "Receita", fn: (c) => BRL((c.insights?.purchase_value || 0) + (crmStats[c.id]?.revenue || 0)) },
                    { label: "ROAS", fn: (c) => {
                      const rev = (c.insights?.purchase_value || 0) + (crmStats[c.id]?.revenue || 0);
                      const s = c.insights?.spend || 0;
                      return s ? `${(rev / s).toFixed(2)}x` : "—";
                    } },
                  ];
                  return rows.map((r) => (
                    <tr key={r.label} className="border-b border-white/5">
                      <td className="py-1.5 px-2 text-muted-foreground sticky left-0 bg-card">{r.label}</td>
                      {compareIds.map((id) => {
                        const c = campaigns.find((x) => x.id === id);
                        return <td key={id} className="py-1.5 px-2">{c ? r.fn(c) : "—"}</td>;
                      })}
                    </tr>
                  ));
                })()}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );

}


const TONE_HSL: Record<string, string> = {
  primary: "hsl(var(--primary))",
  amber: "#f59e0b",
  cyan: "#22d3ee",
  violet: "#8b5cf6",
  emerald: "#34d399",
  rose: "#fb7185",
};

function Kpi({
  icon: Icon, label, value, tone,
  series, dataKey, formatter, delta,
}: {
  icon: any; label: string; value: string; tone: string;
  series?: Array<Record<string, any>>; dataKey?: string;
  formatter?: (v: number) => string;
  delta?: number;
}) {
  const toneMap: Record<string, string> = {
    primary: "text-primary border-primary/20 bg-primary/5",
    amber: "text-amber-400 border-amber-500/20 bg-amber-500/5",
    cyan: "text-cyan-400 border-cyan-500/20 bg-cyan-500/5",
    violet: "text-violet-400 border-violet-500/20 bg-violet-500/5",
    emerald: "text-emerald-400 border-emerald-500/20 bg-emerald-500/5",
    rose: "text-rose-400 border-rose-500/20 bg-rose-500/5",
  };
  const showSpark = !!(series && series.length > 1 && dataKey);
  const color = TONE_HSL[tone] ?? "currentColor";
  const gid = `spark-${tone}-${label}`.replace(/\s+/g, "-");
  const showDelta = typeof delta === "number" && isFinite(delta) && delta !== 0;
  const deltaUp = (delta ?? 0) > 0;
  return (
    <Card className={`p-3 border ${toneMap[tone]} relative overflow-hidden`}>
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-80">
        <Icon className="w-3.5 h-3.5" /> {label}
      </div>
      <div className="flex items-baseline gap-2 mt-1">
        <div className="text-lg font-bold tabular-nums">{value}</div>
        {showDelta && (
          <span className={`text-[10px] font-semibold tabular-nums flex items-center gap-0.5 ${deltaUp ? "text-emerald-400" : "text-rose-400"}`}>
            {deltaUp ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
            {Math.abs(delta!).toFixed(0)}%
          </span>
        )}
      </div>

      {showSpark && (
        <div className="h-8 -mx-1 -mb-1 mt-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 2, right: 2, bottom: 0, left: 2 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <RTooltip
                cursor={{ stroke: color, strokeOpacity: 0.3 }}
                contentStyle={{ background: "hsl(var(--card))", border: `1px solid ${color}`, borderRadius: 6, fontSize: 11, padding: "4px 8px" }}
                labelStyle={{ color: "hsl(var(--muted-foreground))", fontSize: 10 }}
                formatter={(v: any) => [formatter ? formatter(Number(v)) : v, label]}
              />
              <Area type="monotone" dataKey={dataKey!} stroke={color} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}

function Sparkline({ data, dataKey, color = "hsl(var(--primary))" }: { data: Array<Record<string, any>>; dataKey: string; color?: string }) {
  if (!data || data.length < 2) return null;
  return (
    <div className="h-6 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 1, right: 1, bottom: 1, left: 1 }}>
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={1.2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-muted/20 px-1.5 py-1">
      <div className="text-[8px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="font-semibold tabular-nums text-[11px]">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/30 px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums text-[11px] mt-0.5">{value}</div>
    </div>
  );
}

function exportCsv(campaigns: any[], crmStats: Record<string, CampaignStats>) {
  const header = ["campaign_id","name","status","spend","impressions","clicks","ctr","cpm","frequency","leads","cpl","appointments","showed","wins","revenue","cac"];
  const rows = campaigns.map((c) => {
    const ins = c.insights || {};
    const spend = Number(ins.spend || 0);
    const leads = Number(ins.leads || 0);
    const stat = crmStats[c.id] || { leads: 0, meetings: 0, showed: 0, wins: 0, revenue: 0, contacts: 0 };
    return [
      c.id,
      `"${String(c.name || "").replace(/"/g, '""')}"`,
      c.effective_status || c.status || "",
      spend.toFixed(2),
      ins.impressions || 0,
      ins.clicks || 0,
      (ins.ctr ?? 0).toFixed(2),
      (ins.cpm ?? 0).toFixed(2),
      (ins.frequency ?? 0).toFixed(2),
      leads,
      leads > 0 ? (spend / leads).toFixed(2) : "",
      stat.meetings,
      stat.showed,
      stat.wins,
      stat.revenue.toFixed(2),
      stat.wins > 0 ? (spend / stat.wins).toFixed(2) : "",
    ].join(",");
  });

  const csv = [header.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `campanhas_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
