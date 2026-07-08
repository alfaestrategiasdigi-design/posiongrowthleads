import type { RankingItem } from "@/lib/relatorios/types";
import { Trophy, User } from "lucide-react";

const BRL = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function medal(pos: number) {
  if (pos === 1) return "text-amber-400";
  if (pos === 2) return "text-slate-300";
  if (pos === 3) return "text-orange-400";
  return "text-muted-foreground";
}

function RankingCard({ title, subtitle, items, emptyMsg, icon: Icon }: {
  title: string; subtitle: string; items: RankingItem[]; emptyMsg: string; icon: any;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4 md:p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-lg border border-accent/25 bg-accent/10 text-accent grid place-items-center">
          <Icon className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground/95 leading-none">{title}</h3>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">{subtitle}</p>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{emptyMsg}</p>
      ) : (
        <div className="space-y-1">
          <div className="grid grid-cols-[28px_1fr_auto_auto] gap-3 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 px-2 pb-1 border-b border-border/40">
            <span>#</span><span>Nome</span><span className="text-right">Vendas</span><span className="text-right">Faturamento</span>
          </div>
          {items.map((it, idx) => (
            <div key={it.name + idx} className="grid grid-cols-[28px_1fr_auto_auto] gap-3 items-center px-2 py-1.5 rounded-md hover:bg-muted/20">
              <span className={`text-xs font-bold tabular-nums ${medal(idx + 1)}`}>{idx + 1}º</span>
              <span className="text-xs md:text-sm text-foreground/90 truncate">{it.name}</span>
              <span className="text-xs tabular-nums text-muted-foreground text-right">{it.count}</span>
              <span className="text-xs md:text-sm tabular-nums font-semibold text-emerald-400 text-right">{BRL(it.total)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RankingsGrid({ closers, sdrs }: { closers: RankingItem[]; sdrs: RankingItem[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 md:gap-4">
      <RankingCard title="Ranking Closer" subtitle="Faturamento por vendedor" items={closers} emptyMsg="Nenhuma venda no período" icon={Trophy} />
      <RankingCard title="Ranking SDR" subtitle="Leads ganhos por responsável" items={sdrs} emptyMsg="Nenhum SDR atribuído aos leads ganhos" icon={User} />
    </div>
  );
}
