import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useTenant } from "@/hooks/useTenant";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Loader2, Copy, CheckCircle2, Clock, Sparkles, QrCode, CreditCard,
  ShieldCheck, ArrowLeft, RadioTower,
} from "lucide-react";
import { MpCardBrickForm } from "@/components/tenant/MpCardBrickForm";

const BRL = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const intervalLabel = (i: string) =>
  i === "semester" ? "semestre" : i === "quarter" ? "trimestre" : "mês";

interface OfferInfo {
  id: string;
  label: string;
  entry_amount_cents: number;
  recurring_amount_cents: number;
  entry_cycles: number;
  interval: "month" | "quarter" | "semester";
  description?: string | null;
}

interface PixData {
  payment_id: string;
  qr_code_base64: string | null;
  qr_code_text: string | null;
  ticket_url: string | null;
  expires_at: string | null;
  status: string;
}

type PayStatus = "idle" | "pending" | "paid" | "expired" | "cancelled" | "error";

export default function TenantCheckout() {
  const { tenant, user } = useTenant();
  const [params] = useSearchParams();
  const requestedOfferId = params.get("offer_id");

  const [offer, setOffer] = useState<OfferInfo | null>(null);
  const [offerLoaded, setOfferLoaded] = useState(false);

  // Pix state
  const [pix, setPix] = useState<PixData | null>(null);
  const [pixLoading, setPixLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Global status (drives the top-of-page banner) — reflects DB truth from realtime
  const [status, setStatus] = useState<PayStatus>("idle");
  const [liveConnected, setLiveConnected] = useState(false);

  const pollRef = useRef<number | null>(null);

  const entryAmount = offer?.entry_amount_cents ?? 25000;
  const recurringAmount = offer?.recurring_amount_cents ?? 38900;
  const cycles = offer?.entry_cycles ?? 1;
  const interval = offer?.interval ?? "month";
  const title = offer?.label ?? "Oferta Fundadores POSION";
  const cyclesLabel = cycles > 1
    ? `${cycles} ${interval === "month" ? "meses" : intervalLabel(interval) + "s"}`
    : `1º ${intervalLabel(interval)}`;

  // Load offer + existing slot
  useEffect(() => {
    if (!tenant?.id) return;
    let cancelled = false;
    (async () => {
      let off: any = null;
      if (requestedOfferId) {
        const { data } = await (supabase as any).from("tenant_custom_offers")
          .select("*").eq("id", requestedOfferId).eq("tenant_id", tenant.id).maybeSingle();
        off = data;
      } else {
        const { data } = await (supabase as any).from("tenant_custom_offers")
          .select("*").eq("tenant_id", tenant.id).eq("active", true)
          .order("created_at", { ascending: false }).limit(1).maybeSingle();
        off = data;
      }
      if (cancelled) return;
      if (off) {
        setOffer({
          id: off.id, label: off.label,
          entry_amount_cents: off.entry_amount_cents,
          recurring_amount_cents: off.recurring_amount_cents,
          entry_cycles: off.entry_cycles,
          interval: off.interval,
          description: off.description,
        });
      }
      setOfferLoaded(true);

      const { data: slot } = await supabase.from("founder_slots")
        .select("*").eq("tenant_id", tenant.id).maybeSingle();
      if (cancelled) return;
      if (slot?.status === "paid") setStatus("paid");
      else if (slot?.status === "pending" && slot.qr_code_text) {
        setPix({
          payment_id: slot.payment_id,
          qr_code_base64: slot.qr_code_base64,
          qr_code_text: slot.qr_code_text,
          ticket_url: slot.ticket_url,
          expires_at: slot.expires_at,
          status: "pending",
        });
        setStatus("pending");
      }
    })();
    return () => { cancelled = true; };
  }, [tenant?.id, requestedOfferId]);

  // Realtime channel on founder_slots for this tenant — the star of the show.
  useEffect(() => {
    if (!tenant?.id) return;
    const channel = supabase
      .channel(`checkout:${tenant.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "founder_slots", filter: `tenant_id=eq.${tenant.id}` },
        (payload: any) => {
          const row = payload.new || payload.old;
          if (!row) return;
          if (row.status === "paid") {
            setStatus("paid");
            toast.success("Pagamento confirmado em tempo real! 🎉");
          } else if (row.status === "pending") {
            setStatus("pending");
          } else if (row.status === "expired" || row.status === "cancelled") {
            setStatus(row.status);
          }
        },
      )
      .subscribe((s) => {
        if (s === "SUBSCRIBED") setLiveConnected(true);
        if (s === "CLOSED" || s === "CHANNEL_ERROR") setLiveConnected(false);
      });
    return () => { supabase.removeChannel(channel); };
  }, [tenant?.id]);

  // Countdown tick for Pix
  useEffect(() => {
    if (!pix?.expires_at) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pix?.expires_at]);

  // Polling fallback (in case realtime drops)
  useEffect(() => {
    if (status !== "pending" || !tenant?.id) return;
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      const { data } = await supabase.functions.invoke("mp-pix-status", { body: { tenant_id: tenant.id } });
      const st = (data as any)?.status;
      if (st === "paid") setStatus("paid");
      else if (st === "expired" || st === "cancelled") setStatus(st);
    }, 5000);
    return stopPolling;
  }, [status, tenant?.id]);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const createPix = async () => {
    if (!tenant?.id) return;
    setPixLoading(true);
    const { data, error } = await supabase.functions.invoke("mp-pix-create", {
      body: { tenant_id: tenant.id, payer_email: user?.email, offer_id: offer?.id },
    });
    setPixLoading(false);
    if (error || (data as any)?.error) {
      toast.error((error as any)?.message || (data as any)?.error || "Falha ao gerar Pix");
      return;
    }
    if ((data as any).already_paid) { setStatus("paid"); return; }
    setPix(data as PixData);
    setStatus("pending");
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

  const statusBanner = useMemo(() => {
    if (status === "paid") {
      return (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-center gap-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-none" />
          <div className="flex-1">
            <div className="font-display text-lg text-emerald-100">Pagamento confirmado</div>
            <div className="text-xs text-emerald-100/80">
              Entrada de <b>{BRL(entryAmount)}</b> liberada por {cyclesLabel}. Próxima cobrança: <b>{BRL(recurringAmount)}/{intervalLabel(interval)}</b>.
            </div>
          </div>
        </div>
      );
    }
    if (status === "pending") {
      return (
        <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 px-4 py-3 flex items-center gap-3">
          <Loader2 className="w-5 h-5 text-sky-300 animate-spin flex-none" />
          <div className="flex-1 text-sm text-sky-100">
            Aguardando confirmação do pagamento. Assim que o Mercado Pago liberar, esta página atualiza sozinha.
          </div>
        </div>
      );
    }
    if (status === "expired" || status === "cancelled") {
      return (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          Pagamento {status === "expired" ? "expirado" : "cancelado"}. Gere um novo Pix ou use cartão.
        </div>
      );
    }
    return null;
  }, [status, entryAmount, recurringAmount, cycles, interval, cyclesLabel]);

  if (!offerLoaded) {
    return <div className="p-12 flex justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <Button asChild variant="ghost" size="sm" className="gap-1">
          <Link to={tenant ? `/app/${tenant.slug}/planos` : "/"}>
            <ArrowLeft className="w-4 h-4" /> Planos
          </Link>
        </Button>
        <div className="flex items-center gap-2 text-xs">
          <RadioTower className={`w-3.5 h-3.5 ${liveConnected ? "text-emerald-400" : "text-muted-foreground"}`} />
          <span className={liveConnected ? "text-emerald-300" : "text-muted-foreground"}>
            {liveConnected ? "Status ao vivo" : "Reconectando…"}
          </span>
        </div>
      </div>

      <div className="text-center space-y-2">
        <div className="flex justify-center gap-2 flex-wrap">
          <Badge className="bg-amber-500/15 text-amber-300 border border-amber-500/30">
            {cyclesLabel} · {BRL(entryAmount)}
          </Badge>
          <Badge variant="outline" className="text-muted-foreground border-white/10">
            depois {BRL(recurringAmount)}/{intervalLabel(interval)}
          </Badge>
        </div>
        <h1 className="font-display text-3xl md:text-4xl flex items-center justify-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" /> {title}
        </h1>
        <p className="text-sm text-muted-foreground max-w-xl mx-auto">
          Checkout transparente — Pix e cartão de crédito lado a lado, sem sair desta página. Cancele quando quiser.
        </p>
      </div>

      {statusBanner}

      {status !== "paid" && (
        <>
          {/* Desktop: two columns side-by-side. Mobile: stacked tabs. */}
          <div className="hidden lg:grid grid-cols-2 gap-6">
            <PixPanel
              pix={pix} pixLoading={pixLoading} status={status}
              createPix={createPix} copyCode={copyCode} copied={copied}
              mm={mm} ss={ss}
              entryAmount={entryAmount} recurringAmount={recurringAmount}
              cyclesLabel={cyclesLabel} interval={interval}
            />
            <CardPanel
              tenantId={tenant?.id || ""}
              offer={offer}
              entryAmount={entryAmount}
              recurringAmount={recurringAmount}
              payerEmail={user?.email ?? undefined}
              onPaid={() => setStatus("paid")}
              cyclesLabel={cyclesLabel}
              interval={interval}
            />
          </div>

          <div className="lg:hidden">
            <Tabs defaultValue="pix">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="pix" className="gap-1"><QrCode className="w-4 h-4" /> Pix</TabsTrigger>
                <TabsTrigger value="card" className="gap-1"><CreditCard className="w-4 h-4" /> Cartão</TabsTrigger>
              </TabsList>
              <TabsContent value="pix" className="mt-4">
                <PixPanel
                  pix={pix} pixLoading={pixLoading} status={status}
                  createPix={createPix} copyCode={copyCode} copied={copied}
                  mm={mm} ss={ss}
                  entryAmount={entryAmount} recurringAmount={recurringAmount}
                  cyclesLabel={cyclesLabel} interval={interval}
                />
              </TabsContent>
              <TabsContent value="card" className="mt-4">
                <CardPanel
                  tenantId={tenant?.id || ""}
                  offer={offer}
                  entryAmount={entryAmount}
                  recurringAmount={recurringAmount}
                  payerEmail={user?.email ?? undefined}
                  onPaid={() => setStatus("paid")}
                  cyclesLabel={cyclesLabel}
                  interval={interval}
                />
              </TabsContent>
            </Tabs>
          </div>
        </>
      )}

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-4">
        <ShieldCheck className="w-4 h-4" /> Pagamentos processados pelo Mercado Pago · dados do cartão nunca tocam nossos servidores
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

function PixPanel(props: {
  pix: PixData | null; pixLoading: boolean; status: PayStatus;
  createPix: () => void; copyCode: () => void; copied: boolean;
  mm: string; ss: string;
  entryAmount: number; recurringAmount: number;
  cyclesLabel: string; interval: string;
}) {
  const { pix, pixLoading, status, createPix, copyCode, copied, mm, ss, entryAmount, recurringAmount, cyclesLabel, interval } = props;
  return (
    <Card className="bg-[#0B1220]/80 border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <QrCode className="w-5 h-5 text-primary" /> Pagar com Pix
        </CardTitle>
        <p className="text-xs text-muted-foreground">Aprovação instantânea. Assine hoje mesmo.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!pix && status !== "pending" ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Cobrança única de <b className="text-foreground">{BRL(entryAmount)}</b> para {cyclesLabel}. Depois <b className="text-foreground">{BRL(recurringAmount)}/{interval === "semester" ? "semestre" : interval === "quarter" ? "trimestre" : "mês"}</b>.
            </p>
            <Button onClick={createPix} disabled={pixLoading} className="w-full">
              {pixLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Gerar QR Code Pix</>}
            </Button>
          </div>
        ) : status === "expired" || status === "cancelled" ? (
          <div className="py-8 text-center space-y-3">
            <Clock className="w-10 h-10 text-amber-400 mx-auto" />
            <div className="font-display text-base">Pix expirado</div>
            <Button onClick={createPix} disabled={pixLoading} size="sm">Gerar novo Pix</Button>
          </div>
        ) : pixLoading && !pix ? (
          <div className="py-10 flex justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary" /></div>
        ) : pix ? (
          <>
            {pix.qr_code_base64 && (
              <div className="bg-white rounded-xl p-3 flex justify-center">
                <img
                  src={`data:image/png;base64,${pix.qr_code_base64}`}
                  alt="QR Code Pix"
                  className="w-52 h-52"
                />
              </div>
            )}
            {pix.expires_at && (
              <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1">
                <Clock className="w-3 h-3" /> Expira em <span className="tabular-nums font-medium text-foreground">{mm}:{ss}</span>
              </div>
            )}
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
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CardPanel(props: {
  tenantId: string; offer: OfferInfo | null;
  entryAmount: number; recurringAmount: number;
  payerEmail?: string; onPaid: () => void;
  cyclesLabel: string; interval: string;
}) {
  const { tenantId, offer, entryAmount, recurringAmount, payerEmail, onPaid, cyclesLabel, interval } = props;
  return (
    <Card className="bg-[#0B1220]/80 border-primary/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-display">
          <CreditCard className="w-5 h-5 text-primary" /> Pagar com Cartão
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Entrada agora, recorrência automática. Nunca mais se preocupe com renovar.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-primary-foreground/90 leading-relaxed">
          Entrada de <b>{BRL(entryAmount)}</b> ({cyclesLabel}) cobrada agora. Depois, <b>{BRL(recurringAmount)}/{interval === "semester" ? "semestre" : interval === "quarter" ? "trimestre" : "mês"}</b> automático no mesmo cartão. Cancele quando quiser.
        </div>
        {tenantId ? (
          <MpCardBrickForm
            tenantId={tenantId}
            offerId={offer?.id}
            entryAmountCents={entryAmount}
            recurringAmountCents={recurringAmount}
            payerEmail={payerEmail}
            onPaid={onPaid}
          />
        ) : (
          <div className="py-6 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
        )}
      </CardContent>
    </Card>
  );
}
