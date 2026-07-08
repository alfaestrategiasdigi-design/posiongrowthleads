// Public endpoint (no JWT) called from the browser to relay ViewContent /
// InitiateCheckout events to Meta CAPI. Injects client IP/UA and delegates to
// facebook-capi-event using the service role (never exposed to the browser).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const ALLOWED = new Set(["ViewContent", "InitiateCheckout"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const event_name = body?.event_name;
  const tenant_id = body?.tenant_id as string | undefined;
  const tenant_slug = body?.tenant_slug as string | undefined;
  const visitor_id = body?.visitor_id as string | undefined;

  if (!event_name || !ALLOWED.has(event_name)) return json({ ok: false, error: "invalid event_name" }, 400);
  if (!visitor_id) return json({ ok: false, error: "visitor_id required" }, 400);

  // Resolve tenant_id from slug when needed
  let resolvedTenant = tenant_id ?? null;
  if (!resolvedTenant && tenant_slug) {
    const { data } = await admin.from("tenants").select("id").eq("slug", tenant_slug).maybeSingle();
    resolvedTenant = data?.id ?? null;
  }
  if (!resolvedTenant) return json({ ok: false, error: "tenant not found" }, 404);

  const client_ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip");
  const client_ua = req.headers.get("user-agent") || "";

  const event_source_url = body?.event_source_url || null;
  const path = (() => { try { return event_source_url ? new URL(event_source_url).pathname : "/"; } catch { return "/"; } })();
  const event_id = body?.event_id
    || `${event_name === "ViewContent" ? "view" : "form_start"}:${resolvedTenant}:${visitor_id}:${path}`;

  const upstream = await admin.functions.invoke("facebook-capi-event", {
    body: {
      tenant_id: resolvedTenant,
      event_name,
      event_id,
      visitor_id,
      fbp: body?.fbp ?? null,
      fbc: body?.fbc ?? null,
      client_ip,
      client_ua,
      event_source_url,
      action_source: "website",
      content_name: body?.content_name,
    },
  });

  if (upstream.error) return json({ ok: false, error: upstream.error.message }, 502);
  return json({ ok: true, event_id, upstream: upstream.data }, 200);
});
