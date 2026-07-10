// Idempotent loader for the Mercado Pago JS SDK v2.
declare global {
  interface Window {
    MercadoPago?: any;
  }
}

let sdkPromise: Promise<any> | null = null;

export function loadMercadoPagoSdk(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.MercadoPago) return Promise.resolve(window.MercadoPago);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://sdk.mercadopago.com/js/v2";
    script.async = true;
    script.onload = () => {
      if (window.MercadoPago) resolve(window.MercadoPago);
      else reject(new Error("MercadoPago SDK carregado mas indisponível"));
    };
    script.onerror = () => reject(new Error("Falha ao carregar SDK Mercado Pago"));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

let mpInstance: any = null;
let mpInstanceKey: string | null = null;

export async function getMpInstance(publicKey: string): Promise<any> {
  const MP = await loadMercadoPagoSdk();
  if (mpInstance && mpInstanceKey === publicKey) return mpInstance;
  mpInstance = new MP(publicKey, { locale: "pt-BR" });
  mpInstanceKey = publicKey;
  return mpInstance;
}
