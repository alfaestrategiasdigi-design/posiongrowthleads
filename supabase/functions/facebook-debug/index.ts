// Endpoint de diagnóstico — retorna status completo da integração FB Lead Ads.
// Requer admin.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const FB_TOKEN_ENV = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") ?? "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (!claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roleOk } = await admin.rpc("has_role", {
    _user_id: claims.claims.sub, _role: "admin",
  });
  if (!roleOk) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: cfg } = await admin
    .from("facebook_webhook_config").select("*").limit(1).maybeSingle();

  const token = cfg?.user_access_token || cfg?.page_access_token || FB_TOKEN_ENV;
  const tokenSource = cfg?.user_access_token
    ? "db_user_access_token"
    : cfg?.page_access_token
      ? "db_page_access_token"
      : FB_TOKEN_ENV
        ? "env_secret"
        : "none";

  // Supabase connectivity
  const { count: leadsTotal, error: dbErr } = await admin
    .from("leads").select("*", { count: "exact", head: true });

  // Último lead FB recebido
  const { data: lastFbLead } = await admin
    .from("leads")
    .select("id,nome_completo,whatsapp,email,facebook_lead_id,facebook_form_id,facebook_form_name,created_at,origem")
    .or("origem.eq.facebook_ads,facebook_lead_id.not.is.null")
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();

  // Último lead salvo (qualquer origem)
  const { data: lastAnyLead } = await admin
    .from("leads")
    .select("id,nome_completo,origem,created_at")
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();

  // Status das subscriptions na Meta (se token disponível)
  let pageSubs: any = null;
  let formsInfo: any = null;
  if (token && cfg?.page_id) {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${cfg.page_id}/subscribed_apps?access_token=${encodeURIComponent(token)}`);
      pageSubs = await r.json();
    } catch (e: any) { pageSubs = { error: e.message }; }

    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/${cfg.page_id}/leadgen_forms?fields=id,name,status,leads_count&limit=100&access_token=${encodeURIComponent(token)}`);
      formsInfo = await r.json();
    } catch (e: any) { formsInfo = { error: e.message }; }
  }

  return new Response(JSON.stringify({
    timestamp: new Date().toISOString(),
    token: {
      configured: Boolean(token),
      source: tokenSource,
      has_env_secret: Boolean(FB_TOKEN_ENV),
      has_db_token: Boolean(cfg?.page_access_token),
    },
    supabase: { ok: !dbErr, error: dbErr?.message, leads_total: leadsTotal },
    config: {
      page_id: cfg?.page_id ?? null,
      connected_page_name: (cfg as any)?.connected_page_name ?? null,
      verify_token_len: cfg?.verify_token?.length ?? 0,
      has_app_secret: Boolean(cfg?.app_secret),
      last_validated_at: cfg?.last_validated_at ?? null,
    },
    last_fb_lead: lastFbLead,
    last_any_lead: lastAnyLead,
    last_validation_result: cfg?.last_validation_result ?? null,
    meta: {
      page_subscriptions: pageSubs,
      forms: formsInfo,
    },
  }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
