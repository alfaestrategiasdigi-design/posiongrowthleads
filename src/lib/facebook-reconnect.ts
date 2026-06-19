import { supabase } from "@/integrations/supabase/client";

export const FB_SCOPES =
  "leads_retrieval,pages_show_list,pages_manage_metadata,pages_read_engagement,ads_read,ads_management,business_management";

let fbSdkPromise: Promise<any> | null = null;
function loadFbSdk(appId: string): Promise<any> {
  if (fbSdkPromise) return fbSdkPromise;
  fbSdkPromise = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.FB) {
      try { w.FB.init({ appId, cookie: false, xfbml: false, version: "v21.0" }); } catch {}
      return resolve(w.FB);
    }
    w.fbAsyncInit = function () {
      w.FB.init({ appId, cookie: false, xfbml: false, version: "v21.0" });
      resolve(w.FB);
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true; s.defer = true; s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Falha ao carregar Facebook SDK"));
    document.body.appendChild(s);
  });
  return fbSdkPromise;
}

/**
 * Triggers the Facebook OAuth flow with the full Marketing API scopes and
 * persists the refreshed long-lived USER token (server-side via
 * `facebook-oauth-exchange`). Returns true on success.
 *
 * Use whenever an edge function reports `need_reconnect` (e.g. ads_read missing).
 */
export async function reconnectFacebook(opts?: { silent?: boolean }): Promise<boolean> {
  const silent = opts?.silent ?? false;

  // Fetch app_id (admin-only RPC, exposes no secrets).
  const { data: cfg } = await supabase.rpc("get_facebook_config_meta" as any);
  const row: any = Array.isArray(cfg) ? cfg[0] : cfg;
  const appId: string | undefined = row?.app_id;
  if (!appId) throw new Error("Configure App ID do Meta antes de reconectar.");

  const FB = await loadFbSdk(appId);
  const resp: any = await new Promise((resolve) => {
    FB.login(resolve, { scope: FB_SCOPES, return_scopes: true, auth_type: "rerequest" });
  });
  const shortToken: string | undefined = resp?.authResponse?.accessToken;
  if (!shortToken) {
    if (!silent) throw new Error("Login com Facebook cancelado ou negado.");
    return false;
  }

  // Exchanges short→long-lived USER token AND persists it to facebook_webhook_config.
  const { data, error } = await supabase.functions.invoke("facebook-oauth-exchange", {
    body: { short_lived_token: shortToken },
  });
  if (error) throw error;
  if (!data?.ok) throw new Error(data?.error ?? "Falha ao trocar token");

  // Verify the refreshed token actually has ads_read.
  const granted: string[] = (resp.authResponse.grantedScopes ?? "").split(",").filter(Boolean);
  if (granted.length && !granted.includes("ads_read")) {
    throw new Error("Permissão ads_read não foi concedida. Marque-a na tela do Facebook.");
  }
  return true;
}
