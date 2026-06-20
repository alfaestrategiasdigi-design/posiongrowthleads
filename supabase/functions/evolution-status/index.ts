// Consulta status da instância Evolution e sincroniza com zapi_connections.
// POST body: { instance_name }
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

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (!claims?.claims) return json({ error: "Unauthorized" }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roleOk } = await admin.rpc("has_role", { _user_id: claims.claims.sub, _role: "admin" });
  if (!roleOk) return json({ error: "Forbidden" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const instance_name = String(body.instance_name ?? "").trim();
  if (!instance_name) return json({ error: "instance_name obrigatório" }, 400);

  const { data: conn } = await admin.from("zapi_connections")
    .select("instance_url, api_key, status")
    .eq("provider", "evolution")
    .eq("instance_name", instance_name)
    .maybeSingle();
  if (!conn) return json({ error: "Instância não encontrada" }, 404);

  try {
    const r = await fetch(`${conn.instance_url}/instance/connectionState/${encodeURIComponent(instance_name)}`, {
      headers: { apikey: conn.api_key },
    });
    const j = await r.json();
    const state = j?.instance?.state ?? j?.state ?? "unknown";
    const status = state === "open" ? "connected" : (state === "connecting" ? "connecting" : "disconnected");
    await admin.from("zapi_connections")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("provider", "evolution")
      .eq("instance_name", instance_name);
    return json({ ok: true, state, status });
  } catch (e) {
    return json({ error: "Erro de rede", detail: String(e) }, 502);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
