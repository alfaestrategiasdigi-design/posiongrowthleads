import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, TrendingDown, ImageIcon } from "lucide-react";

const BRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v || 0);
const NUM = (v: number) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));

export interface CreativeCardProps {
  ad: {
    id: string;
    name: string;
    status?: string;
    effective_status?: string;
    creative?: {
      thumbnail_url?: string;
      image_url?: string;
      body?: string;
      title?: string;
      video_id?: string;
      instagram_permalink_url?: string;
      call_to_action_type?: string;
    };
    insights?: {
      spend: number; impressions: number; clicks: number;
      ctr: number; cpm: number; cpl: number; leads: number;
      frequency: number;
      hook_rate: number; hold_rate: number;
      quality_ranking?: string | null;
      engagement_rate_ranking?: string | null;
      conversion_rate_ranking?: string | null;
    } | null;
  };
  badges?: { top?: boolean; fadigado?: boolean; caindo?: boolean };
}

function rankBadge(r?: string | null) {
  if (!r || r === "UNKNOWN") return null;
  const good = r === "ABOVE_AVERAGE";
  const bad = r === "BELOW_AVERAGE_35" || r === "BELOW_AVERAGE_20" || r === "BELOW_AVERAGE_10";
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded ${good ? "bg-emerald-500/15 text-emerald-300" : bad ? "bg-rose-500/15 text-rose-300" : "bg-muted text-muted-foreground"}`}>
      {r.replace("_", " ").toLowerCase()}
    </span>
  );
}

export default function CreativeCard({ ad, badges }: CreativeCardProps) {
  const c = ad.creative;
  const ins = ad.insights;
  const thumb = c?.thumbnail_url || c?.image_url;
  const isActive = (ad.effective_status ?? ad.status) === "ACTIVE";

  return (
    <Card className="overflow-hidden flex flex-col hover:border-primary/40 transition-colors">
      <div className="relative aspect-[4/5] bg-muted/30 flex items-center justify-center overflow-hidden">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={ad.name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <ImageIcon className="w-8 h-8 text-muted-foreground/40" />
        )}
        <div className="absolute top-1.5 left-1.5 flex flex-wrap gap-1">
          {badges?.top && <Badge className="bg-emerald-500 text-[9px] h-4 px-1.5 gap-0.5"><Flame className="w-2.5 h-2.5" /> Top</Badge>}
          {badges?.fadigado && <Badge className="bg-rose-500 text-[9px] h-4 px-1.5">Fadigado</Badge>}
          {badges?.caindo && <Badge className="bg-amber-500 text-[9px] h-4 px-1.5 gap-0.5"><TrendingDown className="w-2.5 h-2.5" /> CTR caindo</Badge>}
        </div>
        <div className="absolute top-1.5 right-1.5">
          <Badge variant={isActive ? "default" : "secondary"} className="text-[9px] h-4 px-1.5">
            {isActive ? "ATIVO" : (ad.effective_status ?? ad.status ?? "").slice(0, 8)}
          </Badge>
        </div>
      </div>

      <div className="p-2.5 flex flex-col gap-1.5">
        <div className="text-[11px] font-medium leading-tight line-clamp-2" title={ad.name}>{ad.name}</div>
        {c?.body && <div className="text-[9px] text-muted-foreground line-clamp-2">{c.body}</div>}
        {ins ? (
          <>
            <div className="grid grid-cols-4 gap-1 text-[10px] mt-1">
              <M label="Gasto" value={BRL(ins.spend)} />
              <M label="CTR" value={`${ins.ctr.toFixed(1)}%`} />
              <M label="CPL" value={ins.leads ? BRL(ins.cpl) : "—"} />
              <M label="Freq." value={ins.frequency.toFixed(1)} />
            </div>
            <div className="grid grid-cols-3 gap-1 text-[10px]">
              <M label="Hook" value={`${ins.hook_rate.toFixed(0)}%`} tone={ins.hook_rate >= 25 ? "good" : ins.hook_rate >= 15 ? "warn" : "bad"} />
              <M label="Hold" value={`${ins.hold_rate.toFixed(0)}%`} tone={ins.hold_rate >= 20 ? "good" : ins.hold_rate >= 12 ? "warn" : "bad"} />
              <M label="Leads" value={NUM(ins.leads)} />
            </div>
            <div className="flex flex-wrap gap-1 mt-1">
              {rankBadge(ins.quality_ranking)}
              {rankBadge(ins.engagement_rate_ranking)}
              {rankBadge(ins.conversion_rate_ranking)}
            </div>
          </>
        ) : (
          <div className="text-[10px] text-muted-foreground italic">Sem dados no período.</div>
        )}
      </div>
    </Card>
  );
}

function M({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" | "bad" }) {
  const toneCls =
    tone === "good" ? "text-emerald-400" :
    tone === "warn" ? "text-amber-400" :
    tone === "bad"  ? "text-rose-400"    : "";
  return (
    <div className="bg-muted/30 rounded px-1.5 py-1">
      <div className="text-[8px] uppercase text-muted-foreground">{label}</div>
      <div className={`font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}
