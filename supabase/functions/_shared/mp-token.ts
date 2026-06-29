// Resolve Mercado Pago Access Token, preferring DB (admin-configured) over env.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export async function getMpAccessToken(): Promise<string | null> {
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const admin = createClient(url, key);
      const { data } = await admin
        .from("payment_provider_config")
        .select("access_token")
        .eq("provider", "mercadopago")
        .maybeSingle();
      const t = (data as any)?.access_token;
      if (t && typeof t === "string" && t.length > 10) return t;
    }
  } catch (_) { /* fall through */ }
  return Deno.env.get("MP_ACCESS_TOKEN") || null;
}
