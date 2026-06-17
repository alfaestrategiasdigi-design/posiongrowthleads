// Salva a página selecionada pelo usuário (id, nome, page_access_token) no banco
// e inscreve automaticamente o app na página para o campo `leadgen`.
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

  const pageId = String(body?.page_id ?? "").trim();
  const pageName = String(body?.page_name ?? "").trim();
  const pageAccessToken = String(body?.page_access_token ?? "").trim();
  if (!pageId || !pageAccessToken) {
    return new Response(JSON.stringify({ error: "page_id e page_access_token são obrigatórios" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: existing } = await admin
    .from("facebook_webhook_config").select("id").limit(1).maybeSingle();

  // 60 dias de validade — Page Token derivado de long-lived user token costuma não expirar,
  // mas guardamos uma data de "checagem" defensiva
  const expiresAt = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();

  const normalizeAdAccountId = (value: any) => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
  };

  const patch: any = {
    page_id: pageId,
    connected_page_name: pageName || null,
    page_access_token: pageAccessToken,
    token_expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  };
  // opção: salvar ad_account_id junto se fornecido
  const normalizedAdAccountId = normalizeAdAccountId(body?.ad_account_id);
  if (normalizedAdAccountId) patch.ad_account_id = normalizedAdAccountId;
  if (body?.user_access_token) patch.user_access_token = String(body.user_access_token).trim() || null;
  if (body?.user_access_token_expires_at) patch.user_access_token_expires_at = String(body.user_access_token_expires_at).trim() || null;

  if (existing) {
    const { error } = await admin
      .from("facebook_webhook_config").update(patch).eq("id", existing.id);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } else {
    const { error } = await admin
      .from("facebook_webhook_config").insert(patch);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  // Subscribe app to page for leadgen field (best-effort; falha não bloqueia)
  let subscribed = false;
  let subscribeError: string | null = null;
  try {
    const subUrl = new URL(`https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`);
    subUrl.searchParams.set("subscribed_fields", "leadgen");
    subUrl.searchParams.set("access_token", pageAccessToken);
    const r = await fetch(subUrl, { method: "POST" });
    const j = await r.json();
    if (r.ok && j.success) subscribed = true;
    else subscribeError = j?.error?.message ?? `HTTP ${r.status}`;
  } catch (e: any) {
    subscribeError = e.message;
  }

  return new Response(JSON.stringify({
    ok: true, subscribed, subscribeError,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
