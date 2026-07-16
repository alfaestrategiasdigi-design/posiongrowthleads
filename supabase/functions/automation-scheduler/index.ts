// Scheduler: retoma execuções em waiting_delay cujo wait_until já passou.
// Chamado por pg_cron a cada minuto.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const nowIso = new Date().toISOString();
  const { data: due, error } = await admin
    .from("automation_executions")
    .select("id, tenant_id, flow_id, current_node, next_node, context, steps, lead_id")
    .eq("status", "waiting_delay")
    .lte("wait_until", nowIso)
    .limit(50);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const dispatchUrl = `${SUPABASE_URL}/functions/v1/automation-dispatch`;
  const results: any[] = [];
  for (const exec of due || []) {
    const startNode = exec.next_node || exec.current_node;
    if (!startNode) continue;
    // Marca como running para evitar corrida com próximo tick.
    await admin.from("automation_executions").update({
      status: "running", updated_at: new Date().toISOString(),
    }).eq("id", exec.id);

    try {
      const r = await fetch(dispatchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          trigger: "resume_delay",
          tenant_id: exec.tenant_id,
          flow_id: exec.flow_id,
          resume_execution_id: exec.id,
          start_node: startNode,
          context: exec.context || {},
        }),
      });
      results.push({ id: exec.id, status: r.status });
    } catch (e) {
      results.push({ id: exec.id, error: String(e).slice(0, 200) });
      await admin.from("automation_executions").update({
        status: "failed", updated_at: new Date().toISOString(),
      }).eq("id", exec.id);
    }
  }

  // Reconciliação automática de conversas @lid: roda a cada ~15 min (a cada 15 ticks).
  // Chama a função com a service-role key para autorização interna.
  const shouldRunLidReconcile = new Date().getUTCMinutes() % 15 === 0;
  if (shouldRunLidReconcile) {
    // Fire-and-forget: reconcile pode levar >30s consultando Evolution API,
    // não queremos bloquear o retorno do scheduler.
    fetch(`${SUPABASE_URL}/functions/v1/whatsapp-lid-reconcile`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({}),
    }).catch((e) => console.warn("[automation-scheduler] lid_reconcile_failed", String(e).slice(0, 200)));
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
