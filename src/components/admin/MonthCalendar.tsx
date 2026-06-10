import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APPOINTMENT_STATUS, type Appointment } from "@/types/appointment";

interface Props {
  currentMonth: Date;
  setCurrentMonth: (d: Date) => void;
  appointments: Appointment[];
  onSelectDate: (d: Date) => void;
  onSelectAppointment: (a: Appointment) => void;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const MonthCalendar = ({ currentMonth, setCurrentMonth, appointments, onSelectDate, onSelectAppointment }: Props) => {
  const days = useMemo(() => {
    const start = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const end = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0);
    const startWeekday = start.getDay();
    const totalDays = end.getDate();
    const cells: { date: Date; current: boolean }[] = [];
    // prev month tail
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = new Date(start);
      d.setDate(d.getDate() - i - 1);
      cells.push({ date: d, current: false });
    }
    for (let i = 1; i <= totalDays; i++) {
      cells.push({ date: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), i), current: true });
    }
    // pad to 42 cells (6 weeks)
    while (cells.length < 42) {
      const last = cells[cells.length - 1].date;
      const d = new Date(last); d.setDate(d.getDate() + 1);
      cells.push({ date: d, current: false });
    }
    return cells;
  }, [currentMonth]);

  const appsByDay = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    appointments.forEach((a) => {
      const d = new Date(a.date_time);
      const k = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    });
    map.forEach((arr) => arr.sort((x, y) => new Date(x.date_time).getTime() - new Date(y.date_time).getTime()));
    return map;
  }, [appointments]);

  const today = new Date();
  const isToday = (d: Date) =>
    d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear();

  const monthLabel = currentMonth.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  return (
    <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <h3 className="text-lg font-semibold capitalize">{monthLabel}</h3>
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setCurrentMonth(new Date())}>Hoje</Button>
          <Button size="sm" variant="outline" onClick={() => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-7 border-b border-border/50">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-xs font-medium text-muted-foreground text-center uppercase">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((cell, i) => {
          const k = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`;
          const dayApps = appsByDay.get(k) || [];
          return (
            <div
              key={i}
              onClick={() => onSelectDate(cell.date)}
              className={`min-h-[100px] border-b border-r border-border/30 p-1.5 cursor-pointer hover:bg-muted/30 transition-colors ${
                !cell.current ? "opacity-40" : ""
              } ${isToday(cell.date) ? "bg-accent/5" : ""}`}
            >
              <div className={`text-xs font-medium mb-1 ${isToday(cell.date) ? "text-accent font-bold" : ""}`}>
                {cell.date.getDate()}
              </div>
              <div className="space-y-1">
                {dayApps.slice(0, 3).map((a) => {
                  const status = APPOINTMENT_STATUS[a.status as keyof typeof APPOINTMENT_STATUS];
                  const time = new Date(a.date_time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
                  return (
                    <button
                      key={a.id}
                      onClick={(e) => { e.stopPropagation(); onSelectAppointment(a); }}
                      className={`w-full text-left text-[10px] px-1.5 py-0.5 rounded border truncate ${status?.bg || "bg-muted"}`}
                    >
                      <span className="font-semibold">{time}</span> {a.client_name}
                    </button>
                  );
                })}
                {dayApps.length > 3 && (
                  <div className="text-[10px] text-muted-foreground pl-1">+{dayApps.length - 3} mais</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MonthCalendar;
