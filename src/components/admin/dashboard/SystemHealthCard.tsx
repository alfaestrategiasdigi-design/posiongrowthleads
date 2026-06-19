import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";

type Health = {
  label: string;
  status: "ok" | "warn" | "error";
  detail: string;
};

export default function SystemHealthCard() {
  const [items, setItems] = useState<Health[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const out: Health[] = [];

    // Facebook config
    const { data: cfg } = await supabase.rpc("get_facebook_config_meta" as any);
    const row: any = Array.isArray(cfg) ? cfg[0] : cfg;

    if (row?.has_user_access_token) {
      const exp = row.user_token_expires_at ? new Date(row.user_token_expires_at).getTime() : null;
      const daysLeft = exp ? Math.round((exp - Date.now()) / 86400000) : null;
      if (daysLeft !== null && daysLeft < 0) {
        out.push({ label: "Token Meta (Usuário)", status: "error", detail: "Expirado — reconecte" });
      } else if (daysLeft !== null && daysLeft < 7) {
        out.push({ label: "Token Meta (Usuário)", status: "warn", detail: `Expira em ${daysLeft}d` });
      } else {
        out.push({ label: "Token Meta (Usuário)", status: "ok", detail: daysLeft ? `Válido (${daysLeft}d)` : "Válido" });
      }
    } else {
      out.push({ label: "Token Meta (Usuário)", status: "error", detail: "Não conectado" });
    }

    if (row?.has_page_access_token) {
      out.push({ label: "Page Token", status: "ok", detail: row.connected_page_name || "Conectado" });
    } else {
      out.push({ label: "Page Token", status: "warn", detail: "Não conectado" });
    }

    // Webhook config
    if (row?.verify_token) {
      const lastEvt = row.last_leads_sync_at ? new Date(row.last_leads_sync_at) : null;
      const ageH = lastEvt ? (Date.now() - lastEvt.getTime()) / 3600000 : null;
      out.push({
        label: "Webhook Lead Ads",
        status: ageH !== null && ageH < 48 ? "ok" : "warn",
        detail: lastEvt ? `Último: ${lastEvt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Sem eventos",
      });
    } else {
      out.push({ label: "Webhook Lead Ads", status: "error", detail: "Verify token ausente" });
    }

    // Sync de campanhas
    if (row?.last_campaigns_sync_at) {
      const ageMin = (Date.now() - new Date(row.last_campaigns_sync_at).getTime()) / 60000;
      out.push({
        label: "Sync Campanhas",
        status: ageMin < 60 ? "ok" : ageMin < 360 ? "warn" : "error",
        detail: ageMin < 60 ? `${Math.round(ageMin)}min atrás` : `${Math.round(ageMin / 60)}h atrás`,
      });
    } else {
      out.push({ label: "Sync Campanhas", status: "warn", detail: "Nunca sincronizado" });
    }

    // WhatsApp
    const { data: wa } = await supabase.from("whatsapp_connections").select("status,display_phone_number,last_validated_at").limit(5);
    const connected = (wa ?? []).filter((w: any) => w.status === "connected" || w.status === "open");
    if ((wa ?? []).length === 0) {
      out.push({ label: "WhatsApp", status: "warn", detail: "Nenhuma conexão" });
    } else if (connected.length > 0) {
      out.push({ label: "WhatsApp", status: "ok", detail: `${connected.length}/${wa!.length} ativa(s)` });
    } else {
      out.push({ label: "WhatsApp", status: "error", detail: "Todas desconectadas" });
    }

    setItems(out);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="card-elevated p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.22em] text-accent/80">Status</p>
          <h3 className="font-display text-lg text-foreground normal-case tracking-normal">Saúde do sistema</h3>
        </div>
        <Activity className="w-5 h-5 text-accent/70" />
      </div>
      {loading ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="space-y-2">
          {items.map((it, i) => {
            const Icon = it.status === "ok" ? CheckCircle2 : it.status === "warn" ? AlertTriangle : XCircle;
            const cls =
              it.status === "ok" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
              : it.status === "warn" ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
              : "text-rose-400 bg-rose-500/10 border-rose-500/20";
            return (
              <div key={i} className={`flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg border ${cls}`}>
                <div className="flex items-center gap-2 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium truncate">{it.label}</span>
                </div>
                <span className="text-xs opacity-80 truncate">{it.detail}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
