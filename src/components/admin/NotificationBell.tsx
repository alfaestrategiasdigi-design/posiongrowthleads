import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, BellOff, Volume2, VolumeX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { isSaleSoundMuted, setSaleSoundMuted } from "@/lib/sale-celebration";

export default function NotificationBell() {
  const [pending, setPending] = useState(0);
  const [overdue, setOverdue] = useState(0);
  const [muted, setMuted] = useState(isSaleSoundMuted());
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      const nowIso = new Date().toISOString();
      const [{ count: pend }, { count: over }] = await Promise.all([
        supabase.from("lead_tasks").select("id", { count: "exact", head: true }).eq("done", false),
        supabase
          .from("lead_tasks")
          .select("id", { count: "exact", head: true })
          .eq("done", false)
          .lt("due_date", nowIso)
          .not("due_date", "is", null),
      ]);
      setPending(pend ?? 0);
      setOverdue(over ?? 0);
    };
    load();
    const channel = supabase
      .channel(`notif-bell-lead-tasks-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lead_tasks" },
        () => load(),
      )
      .subscribe();
    const onSound = () => setMuted(isSaleSoundMuted());
    window.addEventListener("posion:sale-sound-changed", onSound);
    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("posion:sale-sound-changed", onSound);
    };
  }, []);

  const total = pending;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 text-muted-foreground hover:text-amber-300"
          title="Tarefas"
        >
          <Bell className="w-4 h-4" />
          {total > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-[9px] font-bold text-white flex items-center justify-center animate-pulse">
              {total > 99 ? "99+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0 overflow-hidden">
        <div className="p-3 border-b border-border/50">
          <div className="text-xs font-semibold flex items-center gap-2">
            <Bell className="w-3.5 h-3.5 text-amber-400" /> Central de tarefas
          </div>
        </div>
        <div className="p-3 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Pendentes</span>
            <span className="font-semibold">{pending}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Atrasadas</span>
            <span className={`font-semibold ${overdue > 0 ? "text-rose-400" : ""}`}>{overdue}</span>
          </div>
        </div>
        <div className="p-2 border-t border-border/50 flex flex-col gap-1">
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              navigate("/admin/tarefas");
            }}
          >
            Ver todas as tarefas
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="w-full justify-start gap-2 text-xs"
            onClick={() => {
              const next = !muted;
              setSaleSoundMuted(next);
              setMuted(next);
            }}
          >
            {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            {muted ? "Som de venda: mutado" : "Som de venda: ativo"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
