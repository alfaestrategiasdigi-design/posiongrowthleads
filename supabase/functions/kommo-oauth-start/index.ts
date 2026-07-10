// Retorna a URL de autorização Kommo para o tenant informado.
// POST body: { tenant_id }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenant_id ?? "");
  if (!tenantId) return json({ error: "tenant_id obrigatório" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  const { data: isTenantAdmin } = await admin.rpc("is_tenant_admin", { _user_id: userId, _tenant_id: tenantId });
  if (!isAdmin && !isTenantAdmin) return json({ error: "Sem permissão" }, 403);

  const { data: conn } = await admin.from("kommo_connections").select("subdomain, client_id").eq("tenant_id", tenantId).maybeSingle();
  if (!conn?.subdomain || !conn?.client_id) return json({ error: "Configure subdomain e client_id primeiro" }, 400);

  const state = `${tenantId}:${crypto.randomUUID()}`;
  const url = `https://${conn.subdomain}.kommo.com/oauth?client_id=${encodeURIComponent(conn.client_id)}&state=${encodeURIComponent(state)}&mode=post_message`;
  return json({ url, state });
});
