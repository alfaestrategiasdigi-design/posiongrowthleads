import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  leadId: string;
  leadPhone?: string | null;
  createdAt: string;
}

function humanize(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return `${h}h ${m}min`;
  }
  const d = Math.floor(ms / 86_400_000);
  const h = Math.round((ms % 86_400_000) / 3_600_000);
  return `${d}d ${h}h`;
}

export default function FirstResponseCard({ leadId, leadPhone, createdAt }: Props) {
  const [firstAt, setFirstAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      // Find any conversation for this lead (direct FK or phone)
      let convIds: string[] = [];
      const { data: byLead } = await supabase
        .from("conversations")
        .select("id")
        .eq("lead_id", leadId);
      if (byLead?.length) convIds = byLead.map((c) => c.id);
      if (!convIds.length && leadPhone) {
        const digits = leadPhone.replace(/\D/g, "").slice(-11);
        if (digits.length >= 8) {
          const { data: byPhone } = await supabase
            .from("conversations")
            .select("id")
            .like("telefone", `%${digits}`);
          if (byPhone?.length) convIds = byPhone.map((c) => c.id);
        }
      }
      if (!convIds.length) {
        if (alive) { setFirstAt(null); setLoading(false); }
        return;
      }
      const { data: msg } = await supabase
        .from("messages")
        .select("created_at")
        .in("conversation_id", convIds)
        .eq("sender", "usuario")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (alive) {
        setFirstAt(msg?.created_at ?? null);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [leadId, leadPhone]);

  const delta = firstAt ? new Date(firstAt).getTime() - new Date(createdAt).getTime() : null;
  const label = loading
    ? "Calculando…"
    : firstAt && delta != null && delta >= 0
      ? humanize(delta)
      : "Sem resposta ainda";
  const color = loading
    ? "text-muted-foreground"
    : firstAt
      ? delta! < 15 * 60_000
        ? "text-emerald-400"
        : delta! < 3 * 3_600_000
          ? "text-amber-400"
          : "text-rose-400"
      : "text-rose-400";

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 flex items-center gap-3">
      <Clock className={`w-4 h-4 ${color}`} />
      <div className="flex-1">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Tempo até primeiro contato comercial
        </div>
        <div className={`text-sm font-semibold ${color}`}>{label}</div>
      </div>
    </div>
  );
}
