import { useMemo } from "react";
import { format, startOfMonth, endOfMonth, subMonths, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronDown, X, Filter } from "lucide-react";
import type { RelatorioFilters, Scope } from "@/lib/relatorios/types";
import { cn } from "@/lib/utils";

interface Props {
  filters: RelatorioFilters;
  onChange: (f: RelatorioFilters) => void;
  scope: Scope;
  availableTenants: { id: string; name: string }[];
  availableCampaigns: string[];
  availableForms: string[];
  availableOwners: { id: string; label: string }[];
}

const PRESETS: Array<{ id: string; label: string; compute: () => { from: string; to: string } }> = [
  { id: "today", label: "Hoje",        compute: () => { const t = new Date(); return { from: fmt(t), to: fmt(t) }; } },
  { id: "7d",    label: "7 dias",      compute: () => ({ from: fmt(subDays(new Date(), 6)), to: fmt(new Date()) }) },
  { id: "30d",   label: "30 dias",     compute: () => ({ from: fmt(subDays(new Date(), 29)), to: fmt(new Date()) }) },
  { id: "cm",    label: "Mês atual",   compute: () => ({ from: fmt(startOfMonth(new Date())), to: fmt(endOfMonth(new Date())) }) },
  { id: "lm",    label: "Mês anterior",compute: () => { const d = subMonths(new Date(), 1); return { from: fmt(startOfMonth(d)), to: fmt(endOfMonth(d)) }; } },
];
const fmt = (d: Date) => format(d, "yyyy-MM-dd");

function MultiSelect({ label, options, selected, onChange, getKey = (o: any) => o, getLabel = (o: any) => String(o) }: {
  label: string;
  options: any[];
  selected: string[];
  onChange: (v: string[]) => void;
  getKey?: (o: any) => string;
  getLabel?: (o: any) => string;
}) {
  const isSelected = (k: string) => selected.includes(k);
  const toggle = (k: string) => onChange(isSelected(k) ? selected.filter(x => x !== k) : [...selected, k]);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-1.5 min-w-0">
          <span className="truncate">{label}{selected.length > 0 ? ` · ${selected.length}` : ""}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0 max-h-[360px] overflow-auto" align="start">
        <div className="px-3 py-2 border-b text-[10px] uppercase tracking-wider text-muted-foreground">
          Selecione uma ou mais opções
        </div>
        {selected.length > 0 && (
          <div className="px-3 py-2 border-b flex items-center justify-between text-xs">
            <span>{selected.length} selecionado(s)</span>
            <button onClick={() => onChange([])} className="text-muted-foreground hover:text-foreground">Limpar</button>
          </div>
        )}
        {options.length === 0 && <div className="p-4 text-xs text-muted-foreground">Nenhuma opção</div>}
        <div className="p-1">
          {options.map(o => {
            const k = getKey(o); const l = getLabel(o); const sel = isSelected(k);
            return (
              <button key={k} onClick={() => toggle(k)}
                className={cn("w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-accent/10 text-left",
                  sel && "bg-accent/10")}>
                <div className={cn("w-4 h-4 rounded border flex items-center justify-center shrink-0",
                  sel ? "bg-accent border-accent" : "border-border")}>
                  {sel && <Check className="w-3 h-3 text-accent-foreground" />}
                </div>
                <span className="truncate">{l}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default function FiltersBar({ filters, onChange, scope, availableTenants, availableCampaigns, availableForms, availableOwners }: Props) {
  const activePreset = useMemo(() => {
    for (const p of PRESETS) {
      const r = p.compute();
      if (r.from === filters.from && r.to === filters.to) return p.id;
    }
    return "custom";
  }, [filters.from, filters.to]);

  const hasAny = filters.tenantIds.length + filters.campaigns.length + filters.forms.length + filters.ownerIds.length > 0
    || filters.origem !== "all";

  return (
    <div className="sticky top-0 z-20 -mx-4 md:-mx-6 lg:-mx-8 px-4 md:px-6 lg:px-8 py-2.5 bg-background/85 backdrop-blur-xl border-y border-border/60">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 mr-1">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Filtros</span>
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {PRESETS.map(p => (
            <Button key={p.id} size="sm" variant={activePreset === p.id ? "default" : "outline"}
              onClick={() => onChange({ ...filters, ...p.compute() })} className="h-8 text-xs">
              {p.label}
            </Button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-1">
          <Input type="date" value={filters.from} onChange={e => onChange({ ...filters, from: e.target.value })}
            className="h-9 w-[140px] text-xs" />
          <span className="text-xs text-muted-foreground">→</span>
          <Input type="date" value={filters.to} onChange={e => onChange({ ...filters, to: e.target.value })}
            className="h-9 w-[140px] text-xs" />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap ml-auto">
          {scope === "admin" && (
            <MultiSelect label="Clínicas" options={availableTenants}
              selected={filters.tenantIds}
              onChange={(v) => onChange({ ...filters, tenantIds: v })}
              getKey={(o) => o.id} getLabel={(o) => o.name} />
          )}
          <MultiSelect label="Campanha" options={availableCampaigns}
            selected={filters.campaigns} onChange={(v) => onChange({ ...filters, campaigns: v })} />
          <MultiSelect label="Formulário" options={availableForms}
            selected={filters.forms} onChange={(v) => onChange({ ...filters, forms: v })} />
          <MultiSelect label="Responsável" options={availableOwners}
            selected={filters.ownerIds} onChange={(v) => onChange({ ...filters, ownerIds: v })}
            getKey={(o) => o.id} getLabel={(o) => o.label} />

          <div className="flex items-center rounded-md border h-9 overflow-hidden">
            {(["all","paid","organic"] as const).map(o => (
              <button key={o} onClick={() => onChange({ ...filters, origem: o })}
                className={cn("px-2.5 text-xs h-full", filters.origem === o ? "bg-accent text-accent-foreground" : "hover:bg-accent/10")}>
                {o === "all" ? "Todos" : o === "paid" ? "Pago" : "Orgânico"}
              </button>
            ))}
          </div>

          {hasAny && (
            <Button size="sm" variant="ghost" className="h-9 text-xs gap-1"
              onClick={() => onChange({ ...filters, tenantIds: [], campaigns: [], forms: [], ownerIds: [], origem: "all" })}>
              <X className="w-3.5 h-3.5" /> Limpar
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
