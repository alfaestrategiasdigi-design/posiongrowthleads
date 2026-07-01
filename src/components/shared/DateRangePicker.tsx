import { useState, useMemo } from "react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar as CalendarIcon, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DateRange } from "react-day-picker";

export interface DateRangeValue { from: Date; to: Date; label: string }

interface Props {
  value: DateRangeValue;
  onChange: (r: DateRangeValue) => void;
  className?: string;
}

export function makeRange(days: number): DateRangeValue {
  const to = endOfDay(new Date());
  const from = startOfDay(subDays(to, days - 1));
  return { from, to, label: `Últimos ${days} dias` };
}

export function DateRangePicker({ value, onChange, className }: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<DateRange | undefined>({ from: value.from, to: value.to });

  const presets = useMemo(() => {
    const today = new Date();
    return [
      { label: "Hoje", from: startOfDay(today), to: endOfDay(today) },
      { label: "Últimos 7 dias", from: startOfDay(subDays(today, 6)), to: endOfDay(today) },
      { label: "Últimos 30 dias", from: startOfDay(subDays(today, 29)), to: endOfDay(today) },
      { label: "Últimos 90 dias", from: startOfDay(subDays(today, 89)), to: endOfDay(today) },
      { label: "Mês atual", from: startOfMonth(today), to: endOfDay(today) },
      { label: "Mês anterior", from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) },
    ];
  }, []);

  const applyPreset = (p: { label: string; from: Date; to: Date }) => {
    onChange({ from: p.from, to: p.to, label: p.label });
    setOpen(false);
  };

  const applyCustom = () => {
    if (custom?.from && custom.to) {
      onChange({
        from: startOfDay(custom.from),
        to: endOfDay(custom.to),
        label: `${format(custom.from, "dd/MM/yy")} → ${format(custom.to, "dd/MM/yy")}`,
      });
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("h-9 gap-2 font-medium", className)}>
          <CalendarIcon className="w-4 h-4 text-primary" />
          <span className="text-sm">{value.label}</span>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">
            {format(value.from, "dd/MM/yy")} – {format(value.to, "dd/MM/yy")}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="end">
        <div className="flex">
          <div className="border-r border-border py-2 min-w-[170px]">
            {presets.map((p) => {
              const active = value.label === p.label;
              return (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-muted flex items-center gap-2",
                    active && "bg-primary/10 text-primary font-medium"
                  )}
                >
                  {active && <Check className="w-3 h-3" />}
                  <span className={active ? "" : "ml-5"}>{p.label}</span>
                </button>
              );
            })}
          </div>
          <div className="p-2">
            <Calendar
              mode="range"
              selected={custom}
              onSelect={setCustom}
              numberOfMonths={2}
              locale={ptBR}
              className={cn("p-1 pointer-events-auto")}
            />
            <div className="flex justify-end p-2 border-t border-border">
              <Button size="sm" onClick={applyCustom} disabled={!custom?.from || !custom?.to}>
                Aplicar
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
