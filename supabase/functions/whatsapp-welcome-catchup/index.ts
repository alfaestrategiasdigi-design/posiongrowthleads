// Catch-up de boas-vindas: garante 100% de cobertura dos leads de formulário.
// Roda por cron (a cada 10 min) e também pode ser invocado manualmente.
// Para cada lead de formulário recente que NÃO recebeu nenhuma mensagem de saída,
// dispara o mesmo pipeline de whatsapp-send-welcome (idempotente por lead).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const FORM_ORIGINS = ["facebook_ads", "facebook_organic"];

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function onlyDigits(s: string | null | undefined) {
  return (s || "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const hours = Math.min(Math.max(Number(body.hours ?? 24), 1), 168);
  const limit = Math.min(Math.max(Number(body.limit ?? 40), 1), 200);
  const dryRun = body.dry_run === true;
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  // Tenants com boas-vindas habilitadas
  const { data: cfgs } = await admin
    .from("whatsapp_welcome_config")
    .select("tenant_id, enabled")
    .eq("enabled", true);
  const enabledTenants = new Set((cfgs ?? []).map((c: any) => c.tenant_id ?? "null"));
  if (enabledTenants.size === 0) return json({ ok: true, skipped: "nenhuma config habilitada" });

  const { data: leads, error } = await admin
    .from("leads")
    .select("id, tenant_id, whatsapp, nome_completo, created_at")
    .in("origem", FORM_ORIGINS)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return json({ error: error.message }, 500);

  const candidates = (leads ?? []).filter(
    (l: any) => onlyDigits(l.whatsapp) && enabledTenants.has(l.tenant_id ?? "null"),
  );

  const results: any[] = [];
  let sent = 0;
  for (const lead of candidates) {
    if (results.length >= limit) break;

    // Já existe qualquer mensagem de saída para esse lead? (conversa vinculada)
    const { data: conv } = await admin
      .from("conversations")
      .select("id")
      .eq("lead_id", lead.id)
      .limit(1)
      .maybeSingle();
    if (conv?.id) {
      const { count } = await admin
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("conversation_id", conv.id)
        .eq("direction", "outbound");
      if ((count ?? 0) > 0) continue;
    }

    if (dryRun) {
      results.push({ lead_id: lead.id, would_send: true });
      continue;
    }

    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send-welcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (j?.ok) sent++;
      results.push({ lead_id: lead.id, status: r.status, result: j });
    } catch (e) {
      results.push({ lead_id: lead.id, error: String(e) });
    }
  }

  console.log("[welcome-catchup]", { hours, candidates: candidates.length, processed: results.length, sent });
  return json({ ok: true, hours, candidates: candidates.length, processed: results.length, sent, results });
});
