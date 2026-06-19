import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, ShieldCheck, RefreshCw } from "lucide-react";
import { reconnectFacebook, FB_SCOPES } from "@/lib/facebook-reconnect";
import { toast } from "sonner";

type ReconnectRequest = {
  reason?: string;
  missing?: string[];
  resolve: (ok: boolean) => void;
};

const EVT = "fb:reconnect-request";

/**
 * Open the global reconnect modal and wait for the user's action.
 * Returns true if the user successfully reconnected, false otherwise.
 * Safe to call from any edge-function error handler — never throws,
 * never auto-pops a popup (avoids browser popup blockers / blank screens).
 */
export function requestFacebookReconnect(opts?: { reason?: string; missing?: string[] }): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof window === "undefined") return resolve(false);
    const detail: ReconnectRequest = { ...opts, resolve };
    window.dispatchEvent(new CustomEvent(EVT, { detail }));
  });
}

/** Detects a `need_reconnect` flag in either edge-function data or error.context body. */
export async function detectNeedReconnect(data: any, error: any): Promise<{ need: boolean; reason?: string; missing?: string[]; payload?: any }> {
  let payload: any = data;
  if (error && !payload) {
    try {
      const ctx: any = (error as any).context;
      if (ctx && typeof ctx.json === "function") payload = await ctx.json();
      else if (ctx && typeof ctx.text === "function") {
        const t = await ctx.text();
        try { payload = JSON.parse(t); } catch { payload = { error: t }; }
      }
    } catch { /* ignore */ }
  }
  const msg: string = payload?.error ?? (error as any)?.message ?? "";
  const need =
    payload?.need_reconnect === true ||
    /token de usu[áa]rio|ads_read|ads_management|reconecte|nonexisting field \(adaccounts\)/i.test(msg);
  return { need, reason: msg || undefined, missing: payload?.missing, payload };
}

export default function ReconnectFacebookDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [req, setReq] = useState<ReconnectRequest | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ReconnectRequest>).detail;
      // If a previous request is still open, resolve it as false (superseded).
      setReq((prev) => {
        if (prev) prev.resolve(false);
        return detail;
      });
      setOpen(true);
    };
    window.addEventListener(EVT, handler);
    return () => window.removeEventListener(EVT, handler);
  }, []);

  const close = (ok: boolean) => {
    setOpen(false);
    setBusy(false);
    if (req) req.resolve(ok);
    setReq(null);
  };

  const handleReconnect = async () => {
    setBusy(true);
    try {
      const ok = await reconnectFacebook();
      if (ok) {
        toast.success("Facebook reconectado", { description: "Permissões atualizadas." });
        close(true);
      } else {
        setBusy(false);
      }
    } catch (e: any) {
      toast.error("Falha ao reconectar", { description: e?.message ?? "Erro desconhecido" });
      setBusy(false);
    }
  };

  const missing = req?.missing && req.missing.length ? req.missing : ["ads_read", "ads_management"];

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogContent className="max-w-md border-border/60 bg-[hsl(232_45%_7%)]/95 backdrop-blur">
        <DialogHeader>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 rounded-xl bg-amber-500/15 ring-1 ring-amber-500/30 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
            </div>
            <DialogTitle className="text-lg">Reconectar com o Facebook</DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground leading-relaxed">
            {req?.reason
              ? req.reason
              : "Sua sessão da Marketing API expirou ou está sem permissões. Reconecte para continuar sincronizando campanhas e leads."}
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border/50 bg-white/[0.02] p-3 text-xs space-y-2">
          <div className="flex items-center gap-2 text-foreground">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Permissões necessárias
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((s) => (
              <span key={s} className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/30 text-[11px] font-mono">
                {s}
              </span>
            ))}
          </div>
          <p className="text-muted-foreground/80 leading-relaxed pt-1">
            Ao clicar abaixo, abriremos a tela oficial do Facebook. Marque todas as permissões solicitadas.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => close(false)} disabled={busy}>
            Agora não
          </Button>
          <Button onClick={handleReconnect} disabled={busy} className="gradient-accent text-[hsl(232_65%_5%)] font-medium">
            {busy ? (
              <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Aguardando Facebook…</>
            ) : (
              <><RefreshCw className="w-4 h-4 mr-2" /> Reconectar agora</>
            )}
          </Button>
        </DialogFooter>

        <p className="text-[10px] text-muted-foreground/60 text-center mt-1 font-mono break-all">
          scopes: {FB_SCOPES}
        </p>
      </DialogContent>
    </Dialog>
  );
}
