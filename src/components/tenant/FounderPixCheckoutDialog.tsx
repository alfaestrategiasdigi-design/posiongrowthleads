import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Copy, CheckCircle2, Clock, Sparkles, QrCode, CreditCard } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { MpCardBrickForm } from "./MpCardBrickForm";

export interface OfferInfo {
  id: string;
  label: string;
  entry_amount_cents: number;
  recurring_amount_cents: number;
  entry_cycles: number;
  interval: "month" | "quarter" | "semester";
  description?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onPaid: () => void;
  tenantId: string;
  payerEmail?: string;
  offer?: OfferInfo | null;
}

interface PixData {
  payment_id: string;
  qr_code_base64: string | null;
  qr_code_text: string | null;
  ticket_url: string | null;
  expires_at: string | null;
  status: string;
}

const BRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const intervalLabel = (i: string) =>
  i === "semester" ? "semestre" : i === "quarter" ? "trimestre" : "mês";

export function FounderPixCheckoutDialog({ open, onClose, onPaid, tenantId, payerEmail, offer }: Props) {
  const [loading, setLoading] = useState(false);
  const [pix, setPix] = useState<PixData | null>(null);
  const [status, setStatus] = useState<"idle" | "pending" | "paid" | "expired" | "cancelled" | "error">("idle");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const pollRef = useRef<number | null>(null);

  const entryAmount = offer?.entry_amount_cents ?? 25000;
  const recurringAmount = offer?.recurring_amount_cents ?? 38900;
  const cycles = offer?.entry_cycles ?? 1;
  const interval = offer?.interval ?? "month";
  const title = offer ? offer.label : "Oferta Fundadores POSION";
  const cyclesLabel = cycles > 1
    ? `${cycles} ${interval === "month" ? "meses" : intervalLabel(interval) + "s"}`
    : `1º ${intervalLabel(interval)}`;

  useEffect(() => {
    if (!open) return;
    setPix(null); setStatus("idle"); setCopied(false);
    createPix();
    return () => stopPolling();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!pix?.expires_at) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pix?.expires_at]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const createPix = async () => {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("mp-pix-create", {
      body: { tenant_id: tenantId, payer_email: payerEmail, offer_id: offer?.id },
    });
    setLoading(false);
    if (error || (data as any)?.error) {
      setStatus("error");
      toast.error((error as any)?.message || (data as any)?.error || "Falha ao gerar Pix");
      return;
    }
    if ((data as any).already_paid) {
      setStatus("paid");
      onPaid();
      return;
    }
    setPix(data as PixData);
    setStatus("pending");
    startPolling();
  };

  const startPolling = () => {
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      const { data } = await supabase.functions.invoke("mp-pix-status", {
        body: { tenant_id: tenantId },
      });
      const st = (data as any)?.status;
      if (st === "paid") {
        setStatus("paid");
        stopPolling();
        toast.success("Pagamento confirmado! 🎉");
        setTimeout(() => { onPaid(); }, 1200);
      } else if (st === "expired" || st === "cancelled") {
        setStatus(st);
        stopPolling();
      }
    }, 4000);
  };

  const copyCode = async () => {
    if (!pix?.qr_code_text) return;
    await navigator.clipboard.writeText(pix.qr_code_text);
    setCopied(true);
    toast.success("Código Pix copiado");
    setTimeout(() => setCopied(false), 2500);
  };

  const remainingMs = pix?.expires_at ? Math.max(0, new Date(pix.expires_at).getTime() - now) : 0;
  const mm = Math.floor(remainingMs / 60000).toString().padStart(2, "0");
  const ss = Math.floor((remainingMs % 60000) / 1000).toString().padStart(2, "0");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md bg-[#0B1220] border-primary/30">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30">
              {cyclesLabel} · {BRL(entryAmount)}
            </Badge>
            <Badge variant="outline" className="text-muted-foreground border-white/10">
              depois {BRL(recurringAmount)}/{intervalLabel(interval)}
            </Badge>
          </div>
          <DialogTitle className="flex items-center gap-2 font-display text-xl">
            <Sparkles className="w-5 h-5 text-primary" />
            {title}
          </DialogTitle>
          <DialogDescription>
            <span className="font-semibold text-foreground">{BRL(entryAmount)}</span> para {cyclesLabel} · depois <span className="font-semibold text-foreground">{BRL(recurringAmount)}/{intervalLabel(interval)}</span> · cancele quando quiser
          </DialogDescription>
        </DialogHeader>

        {status === "paid" ? (
          <div className="py-8 text-center space-y-3">
            <CheckCircle2 className="w-14 h-14 text-emerald-400 mx-auto" />
            <div className="font-display text-2xl">Pagamento confirmado!</div>
            <p className="text-sm text-muted-foreground">
              Entrada de <b className="text-foreground">{BRL(entryAmount)}</b> liberada por {cyclesLabel}.<br />
              A próxima cobrança será de <b className="text-foreground">{BRL(recurringAmount)}</b>, e continuará recorrente até você cancelar.
            </p>
          </div>
        ) : (
          <Tabs defaultValue="pix" className="w-full">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="pix" className="gap-1"><QrCode className="w-4 h-4" /> Pix</TabsTrigger>
              <TabsTrigger value="card" className="gap-1"><CreditCard className="w-4 h-4" /> Cartão</TabsTrigger>
            </TabsList>

            <TabsContent value="pix" className="mt-4">
              {status === "expired" || status === "cancelled" ? (
                <div className="py-8 text-center space-y-3">
                  <Clock className="w-12 h-12 text-amber-400 mx-auto" />
                  <div className="font-display text-lg">Pix expirado</div>
                  <p className="text-sm text-muted-foreground">Gere um novo QR Code para concluir.</p>
                  <Button onClick={createPix} disabled={loading}>Gerar novo Pix</Button>
                </div>
              ) : loading || !pix ? (
                <div className="py-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>
              ) : (
                <div className="space-y-4">
                  {pix.qr_code_base64 && (
                    <div className="bg-white rounded-xl p-3 flex justify-center">
                      <img
                        src={`data:image/png;base64,${pix.qr_code_base64}`}
                        alt="QR Code Pix"
                        className="w-56 h-56"
                      />
                    </div>
                  )}
                  <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <Clock className="w-3 h-3" /> Expira em <span className="tabular-nums font-medium text-foreground">{mm}:{ss}</span>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Pix copia-e-cola</div>
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={pix.qr_code_text || ""}
                        className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs font-mono truncate"
                      />
                      <Button size="sm" variant="outline" onClick={copyCode} className="gap-1">
                        {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                        Copiar
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100 text-center leading-relaxed">
                    <b>Atenção:</b> este Pix cobre <b>{cyclesLabel} por {BRL(entryAmount)}</b>. Depois, o valor passa a ser <b>{BRL(recurringAmount)}/{intervalLabel(interval)}</b>. Você pode cancelar a qualquer momento.
                  </div>
                  <div className="text-xs text-muted-foreground text-center">
                    Aguardando confirmação do pagamento… você não precisa recarregar a página.
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="card" className="mt-4 space-y-3">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-primary-foreground/90 text-center leading-relaxed">
                Entrada de <b>{BRL(entryAmount)}</b> ({cyclesLabel}) cobrada agora. Depois, <b>{BRL(recurringAmount)}/{intervalLabel(interval)}</b> automático no mesmo cartão. Cancele quando quiser.
              </div>
              <MpCardBrickForm
                tenantId={tenantId}
                offerId={offer?.id}
                entryAmountCents={entryAmount}
                recurringAmountCents={recurringAmount}
                payerEmail={payerEmail}
                onPaid={() => {
                  setStatus("paid");
                  setTimeout(() => onPaid(), 1500);
                }}
              />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
