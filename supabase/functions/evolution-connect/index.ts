// Salva config da Evolution API e busca o QR Code para parear o WhatsApp.
// POST body: { instance_url, api_key, instance_name, tenant_id? }
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
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
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
  const instance_url = String(body.instance_url ?? "").trim().replace(/\/+$/, "");
  const api_key = String(body.api_key ?? "").trim();
  const instance_name = String(body.instance_name ?? "").trim();
  const tenant_id: string | null = body.tenant_id ?? null;

  if (!instance_url || !api_key || !instance_name) {
    return json({ error: "instance_url, api_key e instance_name são obrigatórios" }, 400);
  }

  // Upsert connection (tenant_id null = global Posion)
  const existing = await admin.from("zapi_connections")
    .select("id, webhook_secret")
    .eq("provider", "evolution")
    .eq("instance_name", instance_name)
    .maybeSingle();

  const webhook_secret = existing.data?.webhook_secret ?? crypto.randomUUID();
  const payload = {
    provider: "evolution",
    instance_url, api_key, instance_name,
    tenant_id, webhook_secret,
    instance_id: instance_name, token: api_key, client_token: api_key,
    updated_at: new Date().toISOString(),
  };
  if (existing.data?.id) {
    await admin.from("zapi_connections").update(payload).eq("id", existing.data.id);
  } else {
    await admin.from("zapi_connections").insert(payload);
  }

  // Ensure instance exists, then fetch QR
  // Try /instance/connect first (returns base64 QR)
  try {
    const r = await fetch(`${instance_url}/instance/connect/${encodeURIComponent(instance_name)}`, {
      headers: { apikey: api_key },
    });
    const j = await r.json();
    if (!r.ok) {
      return json({ error: "Falha ao chamar Evolution API", detail: j, status: r.status }, 502);
    }
    return json({
      ok: true,
      qr: j?.base64 ?? j?.qrcode?.base64 ?? j?.code ?? null,
      pairingCode: j?.pairingCode ?? null,
      raw: j,
      webhook_secret,
    });
  } catch (e) {
    return json({ error: "Erro de rede ao conectar com Evolution", detail: String(e) }, 502);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
