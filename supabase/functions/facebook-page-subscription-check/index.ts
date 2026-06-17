// Verifica se nosso app está inscrito na Página do Facebook para o campo `leadgen`.
// Body: { action?: "check" | "resubscribe" }  (default: check)
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

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
  if (!claims?.claims) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roleOk } = await admin.rpc("has_role", { _user_id: claims.claims.sub, _role: "admin" });
  if (!roleOk) return json({ error: "Forbidden" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const action = String(body?.action ?? "check");

  const { data: cfg } = await admin
    .from("facebook_webhook_config")
    .select("page_id, page_access_token, user_access_token, app_id")
    .limit(1).maybeSingle();
  const pageId = cfg?.page_id;
  const token = cfg?.user_access_token || cfg?.page_access_token || Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") || "";
  if (!pageId || !token) return json({ error: "Página não conectada. Faça login no Passo 4." }, 400);

  try {
    if (action === "resubscribe") {
      const u = new URL(`https://graph.facebook.com/v21.0/${pageId}/subscribed_apps`);
      u.searchParams.set("subscribed_fields", "leadgen");
      u.searchParams.set("access_token", token);
      const r = await fetch(u, { method: "POST" });
      const j = await r.json();
      if (!r.ok) return json({ error: j?.error?.message ?? `HTTP ${r.status}`, raw: j }, 502);
    }

    const r = await fetch(
      `https://graph.facebook.com/v21.0/${pageId}/subscribed_apps?access_token=${encodeURIComponent(token)}`,
    );
    const j = await r.json();
    if (!r.ok) return json({ error: j?.error?.message ?? `HTTP ${r.status}`, raw: j }, 502);
    const apps: Array<{ id: string; name: string; subscribed_fields?: string[] }> = j.data ?? [];
    const ourAppId = cfg?.app_id ?? null;
    const our = ourAppId ? apps.find((a) => String(a.id) === String(ourAppId)) : null;
    const subscribedToLeadgen = apps.some(
      (a) => (a.subscribed_fields ?? []).includes("leadgen"),
    );
    return json({
      ok: true,
      page_id: pageId,
      our_app_id: ourAppId,
      apps,
      our_app_subscribed: !!our,
      subscribed_to_leadgen: subscribedToLeadgen,
      action,
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
