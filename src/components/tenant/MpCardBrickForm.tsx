import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getMpInstance } from "@/lib/mercadopago";
import { toast } from "sonner";

interface Props {
  tenantId: string;
  offerId?: string | null;
  entryAmountCents: number;
  recurringAmountCents: number;
  payerEmail?: string;
  onPaid: (result: { payment_id: string }) => void;
}

export function MpCardBrickForm({
  tenantId,
  offerId,
  entryAmountCents,
  recurringAmountCents,
  payerEmail,
  onPaid,
}: Props) {
  const containerId = "mp-card-brick-container";
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "submitting" | "paid" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const controllerRef = useRef<any>(null);

  // fetch public key
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("mp-public-key");
        if (cancelled) return;
        if (error || !(data as any)?.public_key) {
          setLoadError("Chave pública do Mercado Pago não configurada. Peça ao administrador para preencher em Admin → Assinaturas → Provedor de Pagamento.");
          setStatus("error");
          return;
        }
        setPublicKey((data as any).public_key);
      } catch (e) {
        if (cancelled) return;
        setLoadError(String((e as Error).message || e));
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // mount brick
  useEffect(() => {
    if (!publicKey) return;
    let disposed = false;

    (async () => {
      try {
        const mp = await getMpInstance(publicKey);
        const bricks = mp.bricks();
        if (disposed) return;

        const controller = await bricks.create("cardPayment", containerId, {
          initialization: {
            amount: entryAmountCents / 100,
            payer: payerEmail ? { email: payerEmail } : undefined,
          },
          customization: {
            visual: { style: { theme: "dark" } },
            paymentMethods: { maxInstallments: 1 },
          },
          callbacks: {
            onReady: () => { if (!disposed) setStatus("ready"); },
            onError: (err: any) => {
              console.error("[mp-card-brick] onError", err);
              if (!disposed) {
                setErrorMsg(err?.message || "Erro no formulário do cartão");
              }
            },
            onSubmit: async (cardFormData: any) => {
              setStatus("submitting");
              setErrorMsg(null);
              try {
                const { data, error } = await supabase.functions.invoke("mp-card-subscribe", {
                  body: {
                    tenant_id: tenantId,
                    offer_id: offerId ?? undefined,
                    card_token_id: cardFormData.token,
                    installments: cardFormData.installments || 1,
                    payment_method_id: cardFormData.payment_method_id,
                    issuer_id: cardFormData.issuer_id,
                    payer: {
                      email: cardFormData.payer?.email || payerEmail,
                      identification: cardFormData.payer?.identification,
                    },
                  },
                });
                if (error || (data as any)?.error) {
                  const msg = (error as any)?.message || (data as any)?.error || "Falha ao processar cartão";
                  setErrorMsg(msg);
                  setStatus("ready");
                  toast.error(msg);
                  throw new Error(msg);
                }
                const result = data as any;
                if (result.preapproval_warning) toast.warning(result.preapproval_warning);
                setStatus("paid");
                toast.success("Pagamento aprovado! 🎉");
                onPaid({ payment_id: result.payment_id });
              } catch (e) {
                console.error("[mp-card-brick] submit failed", e);
                setStatus("ready");
                throw e;
              }
            },
          },
        });
        controllerRef.current = controller;
      } catch (e) {
        console.error("[mp-card-brick] mount failed", e);
        if (!disposed) {
          setLoadError(String((e as Error).message || e));
          setStatus("error");
        }
      }
    })();

    return () => {
      disposed = true;
      try { controllerRef.current?.unmount?.(); } catch { /* noop */ }
      controllerRef.current = null;
    };
  }, [publicKey, tenantId, offerId, entryAmountCents, payerEmail, onPaid]);

  if (status === "error" || loadError) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100 flex gap-2">
        <AlertTriangle className="w-5 h-5 flex-none" />
        <div>{loadError || errorMsg || "Erro ao carregar formulário de cartão"}</div>
      </div>
    );
  }

  if (status === "paid") {
    return (
      <div className="py-8 text-center space-y-2">
        <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
        <div className="font-display text-xl">Pagamento aprovado!</div>
        <p className="text-xs text-muted-foreground">
          Assinatura recorrente de R$ {(recurringAmountCents / 100).toFixed(2)} criada. Você pode cancelar quando quiser.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {(status === "loading" || status === "submitting") && (
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          {status === "submitting" ? "Processando pagamento…" : "Carregando formulário seguro do Mercado Pago…"}
        </div>
      )}
      <div id={containerId} className="min-h-[300px]" />
      {errorMsg && status !== "submitting" && (
        <div className="text-xs text-red-400 text-center">{errorMsg}</div>
      )}
    </div>
  );
}
