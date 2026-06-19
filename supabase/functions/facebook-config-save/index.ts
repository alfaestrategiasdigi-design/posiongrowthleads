// Salva credenciais Meta (Page Access Token, App Secret, Page ID, Verify Token)
// na tabela facebook_webhook_config. Apenas admins.
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
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405, headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: claims, error: authErr } = await userClient.auth.getClaims(token);
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

  // monta patch só com campos enviados (não-vazios)
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  const setIf = (k: string, v: any) => {
    if (typeof v === "string" && v.trim()) patch[k] = v.trim();
  };
  setIf("page_access_token", body.page_access_token);
  setIf("app_secret", body.app_secret);
  setIf("app_id", body.app_id);
  setIf("page_id", body.page_id);
  setIf("verify_token", body.verify_token);
  setIf("ad_account_id", body.ad_account_id);

  if (body.default_tenant_id === null) {
    patch.default_tenant_id = null;
  } else if (typeof body.default_tenant_id === "string" && body.default_tenant_id.trim()) {
    patch.default_tenant_id = body.default_tenant_id.trim();
  }

  if (body.clear_page_access_token === true) {
    patch.page_access_token = null;
    patch.token_expires_at = null;
    patch.connected_page_name = null;
  }
  if (body.clear_app_secret === true) patch.app_secret = null;
  if (body.clear_ad_account_id === true) patch.ad_account_id = null;

  const { data: existing } = await admin
    .from("facebook_webhook_config").select("id").limit(1).maybeSingle();

  let id: string;
  if (existing) {
    if (!patch.verify_token && Object.keys(patch).length === 1) {
      // nada além do updated_at
      return new Response(JSON.stringify({ ok: true, id: existing.id, noop: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { error } = await admin
      .from("facebook_webhook_config").update(patch).eq("id", existing.id);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    id = existing.id;
  } else {
    if (!patch.verify_token) {
      return new Response(JSON.stringify({ error: "verify_token obrigatório na primeira configuração" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data, error } = await admin
      .from("facebook_webhook_config").insert(patch).select("id").single();
    if (error || !data) {
      return new Response(JSON.stringify({ error: error?.message ?? "insert failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    id = data.id;
  }

  return new Response(JSON.stringify({ ok: true, id }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
