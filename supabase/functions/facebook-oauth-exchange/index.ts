// Recebe um short-lived USER access token (vindo do FB JS SDK no browser),
// troca por long-lived USER token usando app_id+app_secret guardados no banco,
// e devolve a lista de páginas que o usuário administra (com page_access_token
// já de longa duração — Page Tokens derivados de long-lived User Tokens não expiram).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

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
  const tokenJwt = authHeader.replace("Bearer ", "");
  const { data: claims, error: authErr } = await userClient.auth.getClaims(tokenJwt);
  if (authErr || !claims?.claims) {
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

  let body: any;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const shortToken = String(body?.short_lived_token ?? "").trim();
  if (!shortToken) {
    return new Response(JSON.stringify({ error: "short_lived_token obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: cfg } = await admin
    .from("facebook_webhook_config").select("id,app_id,app_secret").limit(1).maybeSingle();

  if (!cfg?.app_id || !cfg?.app_secret) {
    return new Response(JSON.stringify({
      error: "Salve primeiro o App ID e o App Secret do seu app Meta nos campos acima.",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    // 1) Troca por long-lived USER token (~60 dias)
    const exchUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
    exchUrl.searchParams.set("grant_type", "fb_exchange_token");
    exchUrl.searchParams.set("client_id", cfg.app_id);
    exchUrl.searchParams.set("client_secret", cfg.app_secret);
    exchUrl.searchParams.set("fb_exchange_token", shortToken);
    const exchRes = await fetch(exchUrl);
    const exchJson = await exchRes.json();
    if (!exchRes.ok) {
      throw new Error(exchJson?.error?.message ?? `HTTP ${exchRes.status}`);
    }
    const longUserToken: string = exchJson.access_token;
    const userTokenExpiresIn: number = exchJson.expires_in ?? 60 * 24 * 3600;

    // 2) Lista páginas administradas com seus page_access_tokens (que já vêm de longa duração)
    const pagesUrl = new URL("https://graph.facebook.com/v21.0/me/accounts");
    pagesUrl.searchParams.set("fields", "id,name,access_token,category,tasks");
    pagesUrl.searchParams.set("limit", "100");
    pagesUrl.searchParams.set("access_token", longUserToken);
    const pagesRes = await fetch(pagesUrl);
    const pagesJson = await pagesRes.json();
    if (!pagesRes.ok) {
      throw new Error(pagesJson?.error?.message ?? `HTTP ${pagesRes.status}`);
    }

    const pages = (pagesJson.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
      category: p.category ?? null,
      tasks: p.tasks ?? [],
    }));

    return new Response(JSON.stringify({
      ok: true,
      long_user_token_expires_in: userTokenExpiresIn,
      pages,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
