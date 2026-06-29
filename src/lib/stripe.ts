import { loadStripe, Stripe } from "@stripe/stripe-js";

type StripeEnv = "sandbox" | "live";

const envToken = import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined;

// Runtime override (e.g. per-tenant client token persisted in DB)
let runtimeToken: string | undefined;

export function setStripeClientToken(token?: string | null) {
  const next = token?.trim() || undefined;
  if (next !== runtimeToken) {
    runtimeToken = next;
    stripePromise = null; // force reload with the new token
  }
}

function activeToken(): string | undefined {
  return runtimeToken || envToken;
}

function paymentsEnvironment(): StripeEnv {
  const t = activeToken();
  if (t?.startsWith("pk_test_")) return "sandbox";
  if (t?.startsWith("pk_live_")) return "live";
  throw new Error(
    "Pagamentos não configurados. Adicione o Stripe Client Token em Configurações.",
  );
}

let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    paymentsEnvironment();
    stripePromise = loadStripe(activeToken() as string);
  }
  return stripePromise;
}

export function getStripeEnvironment(): StripeEnv {
  return paymentsEnvironment();
}

export function paymentsTokenAvailable(): boolean {
  return !!activeToken();
}
