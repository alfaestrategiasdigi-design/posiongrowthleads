// Public endpoint that returns the Mercado Pago public_key (safe to expose).
// Used by the Card Payment Brick in the frontend.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data } = await admin
      .from("payment_provider_config")
      .select("public_key")
      .eq("provider", "mercadopago")
      .maybeSingle();
    const pk = (data as any)?.public_key || null;
    return new Response(JSON.stringify({ public_key: pk }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ public_key: null, error: String((e as Error).message || e) }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
