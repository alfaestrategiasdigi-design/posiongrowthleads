// Verifica quais permissões da Meta foram concedidas ao token armazenado.
// Retorna o status individual de cada permissão exigida pelo guia oficial
// de Webhooks para Lead Ads.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const REQUIRED = [
  "leads_retrieval",
  "pages_manage_metadata",
  "pages_show_list",
  "pages_read_engagement",
  "ads_management",
  "ads_read",
  "business_management",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
  if (!claims?.claims) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: ok } = await admin.rpc("has_role", { _user_id: claims.claims.sub, _role: "admin" });
  if (!ok) return json({ error: "Forbidden" }, 403);

  const { data: cfg } = await admin
    .from("facebook_webhook_config")
    .select("page_access_token, user_access_token")
    .limit(1).maybeSingle();
  const token = cfg?.user_access_token || cfg?.page_access_token || Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") || "";
  if (!token) return json({ error: "Token de página ausente. Reconecte sua conta." }, 400);

  try {
    const url = `https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const j = await r.json();
    if (!r.ok) return json({ error: j?.error?.message ?? `HTTP ${r.status}`, raw: j }, 502);
    const list: Array<{ permission: string; status: string }> = j.data ?? [];
    const map = new Map(list.map((p) => [p.permission, p.status]));
    const result = REQUIRED.map((p) => ({
      permission: p,
      status: map.get(p) ?? "not_requested",
      granted: map.get(p) === "granted",
    }));
    const missing = result.filter((r) => !r.granted).map((r) => r.permission);
    return json({
      ok: true,
      all_granted: missing.length === 0,
      missing,
      permissions: result,
      need_reconnect: missing.length > 0,
    });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
