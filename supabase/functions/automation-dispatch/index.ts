// Motor de execução de fluxos de automação.
// POST { trigger, tenant_id?, context, dry_run?, flow_id?, resume_execution_id? }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const MAX_STEPS = 50;

interface FlowNode { id: string; type: string; data: Record<string, any>; position?: any }
interface FlowEdge { id: string; source: string; target: string; sourceHandle?: string; label?: string }

interface RunContext {
  lead_id?: string | null;
  phone?: string | null;
  name?: string | null;
  email?: string | null;
  form_name?: string | null;
  origem?: string | null;
  appointment_id?: string | null;
  date_time?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  text?: string | null;
  valor?: number | null;
  [k: string]: any;
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function onlyDigits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

function interpolate(tpl: string, vars: Record<string, any>): string {
  if (!tpl) return "";
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path) => {
    const parts = String(path).split(".");
    let cur: any = vars;
    for (const p of parts) { cur = cur?.[p]; if (cur == null) break; }
    return cur == null ? "" : String(cur);
  });
}

function normalizeMatch(mode: string, source: string, target: string): boolean {
  if (!target) return false;
  const s = (source || "").toLowerCase().trim();
  const t = target.toLowerCase().trim();
  switch (mode) {
    case "exact": return s === t;
    case "starts_with": return s.startsWith(t);
    case "regex": try { return new RegExp(target, "i").test(source || ""); } catch { return false; }
    case "contains":
    default: return s.includes(t);
  }
}

function keywordsMatch(cfg: any, text: string): boolean {
  const rawKw: string = String(cfg?.keywords ?? "").trim();
  if (!rawKw) return true; // empty = match all
  const mode = String(cfg?.match ?? "contains");
  const list = rawKw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return list.some((k) => normalizeMatch(mode, text, k));
}

async function loadFullContext(tenantId: string | null, ctx: RunContext): Promise<Record<string, any>> {
  const vars: Record<string, any> = { lead: {}, agendamento: {}, clinica: {}, mensagem: {} };
  if (ctx.text) vars.mensagem.texto = ctx.text;

  // Lead
  let lead: any = null;
  if (ctx.lead_id) {
    const { data } = await admin.from("leads").select("*").eq("id", ctx.lead_id).maybeSingle();
    lead = data;
  } else if (ctx.phone && tenantId) {
    const digits = onlyDigits(ctx.phone);
    if (digits.length >= 8) {
      const { data } = await admin.from("leads")
        .select("*").eq("tenant_id", tenantId).ilike("whatsapp", `%${digits.slice(-8)}%`)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      lead = data;
    }
  }
  if (lead) {
    vars.lead = {
      id: lead.id,
      nome: lead.nome_completo || ctx.name || "",
      whatsapp: lead.whatsapp || ctx.phone || "",
      email: lead.email || ctx.email || "",
      produto: lead.especialidade || lead.facebook_form_name,
      status: lead.status, origem: lead.origem,
      valor: lead.valor_proposta,
    };
    ctx.lead_id = ctx.lead_id ?? lead.id;
  } else {
    vars.lead = { nome: ctx.name ?? "", whatsapp: ctx.phone ?? "", email: ctx.email ?? "" };
  }


  // Appointment
  if (ctx.appointment_id) {
    const { data: appt } = await admin.from("appointments").select("*").eq("id", ctx.appointment_id).maybeSingle();
    if (appt) {
      const dt = new Date(appt.date_time);
      vars.agendamento = {
        data: dt.toLocaleDateString("pt-BR"), hora: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
        tipo: appt.appointment_type, responsavel: appt.procedure,
      };
    }
  } else if (ctx.date_time) {
    const dt = new Date(ctx.date_time);
    vars.agendamento = {
      data: dt.toLocaleDateString("pt-BR"),
      hora: dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
    };
  }

  // Tenant / clinic
  if (tenantId) {
    const { data: tenant } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
    if (tenant) vars.clinica = { nome: tenant.name };
  }
  return vars;
}

async function sendWhatsapp(
  tenantId: string | null, phone: string, kind: "text" | "buttons" | "list" | "audio" | "media",
  data: any,
): Promise<{ ok: boolean; error?: string; wamid?: string | null }> {
  const digits = onlyDigits(phone);
  if (!digits || digits.length < 8) return { ok: false, error: "phone_invalid" };

  // Find evolution connection
  let q = admin.from("zapi_connections").select("instance_url, api_key, instance_name")
    .eq("provider", "evolution");
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  const { data: conn } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) return { ok: false, error: "no_evolution_connection" };

  let base = conn.instance_url.trim();
  if (!/^https?:\/\//i.test(base)) base = "http://" + base;
  try { const u = new URL(base); base = `${u.protocol}//${u.host}`; } catch {}
  const inst = encodeURIComponent(conn.instance_name);
  const headers = { "Content-Type": "application/json", apikey: conn.api_key };

  let endpoint = "";
  let body: any = { number: digits };

  if (kind === "text") {
    endpoint = `${base}/message/sendText/${inst}`;
    body.text = data.text || "";
  } else if (kind === "buttons") {
    endpoint = `${base}/message/sendButtons/${inst}`;
    body = {
      number: digits,
      title: data.title || "",
      description: data.text || "",
      footer: data.footer || "",
      buttons: (data.buttons || []).slice(0, 3).map((b: any, i: number) => ({
        type: "reply",
        displayText: b.label || `Botão ${i + 1}`,
        id: b.id || `btn_${i}`,
      })),
    };

  } else if (kind === "list") {
    endpoint = `${base}/message/sendList/${inst}`;
    body = {
      number: digits,
      title: data.title || "",
      description: data.text || "",
      buttonText: data.buttonText || "Ver opções",
      footerText: data.footer || "",
      sections: [{
        title: data.sectionTitle || "Opções",
        rows: (data.items || []).map((it: any, i: number) => ({
          rowId: it.id || `row_${i}`, title: it.label || `Opção ${i + 1}`, description: it.description || "",
        })),
      }],
    };
  } else if (kind === "audio") {
    endpoint = `${base}/message/sendWhatsAppAudio/${inst}`;
    body.audio = data.url;
  } else if (kind === "media") {
    endpoint = `${base}/message/sendMedia/${inst}`;
    body = {
      number: digits,
      mediatype: data.media_type === "video" ? "video" : data.media_type === "document" ? "document" : "image",
      media: data.url, caption: data.caption || "",
    };
  }

  try {
    const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, error: `evolution_${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
    const wamid = j?.key?.id ?? j?.messageId ?? null;
    return { ok: true, wamid };
  } catch (e) {
    return { ok: false, error: `network: ${String(e).slice(0, 200)}` };
  }
}

function nextNodeIds(edges: FlowEdge[], from: string, handle?: string | null): string[] {
  return edges
    .filter((e) => e.source === from && (!handle || (e.sourceHandle ?? null) === handle || (e.label ?? null) === handle))
    .map((e) => e.target);
}

interface StepLog { at: string; node_id: string; node_type: string; ok: boolean; detail?: string }

async function runFlow(
  flow: any, ctx: RunContext, tenantId: string | null, dryRun: boolean,
  execId: string | null, startNodeId?: string, existingSteps: StepLog[] = [],
): Promise<{ status: string; steps: StepLog[]; execId: string | null; next?: string | null }> {
  const nodes: FlowNode[] = flow.nodes || [];
  const edges: FlowEdge[] = flow.edges || [];
  const findNode = (id: string) => nodes.find((n) => n.id === id) || null;

  const vars = await loadFullContext(tenantId, ctx);
  const steps: StepLog[] = [...existingSteps];

  // start
  let current: FlowNode | null;
  if (startNodeId) {
    current = findNode(startNodeId);
  } else {
    // Find trigger node, or the first node (buttons/message) if the user forgot the trigger.
    current = nodes.find((n) => n.type === "trigger") ?? nodes[0] ?? null;
  }

  let count = 0;
  while (current && count < MAX_STEPS) {
    count++;
    const node: FlowNode = current;
    const type = node.type;
    const d = node.data || {};
    let ok = true; let detail = ""; let branchHandle: string | null = null;
    let stop = false;

    try {
      if (type === "trigger") {
        detail = "início";
      } else if (type === "message") {
        const text = interpolate(String(d.text || ""), vars);
        if (dryRun) detail = `enviaria texto: "${text.slice(0, 80)}"`;
        else {
          const r = await sendWhatsapp(tenantId, vars.lead.whatsapp, "text", { text });
          ok = r.ok; detail = r.ok ? `enviado (wamid ${r.wamid ?? "-"})` : `erro: ${r.error}`;
        }
      } else if (type === "buttons") {
        const text = interpolate(String(d.text || ""), vars);
        if (dryRun) detail = `enviaria botões: "${text.slice(0, 60)}" [${(d.buttons || []).map((b: any) => b.label).join(", ")}]`;
        else {
          const r = await sendWhatsapp(tenantId, vars.lead.whatsapp, "buttons", {
            text, buttons: d.buttons || [], title: d.title, footer: d.footer,
          });
          ok = r.ok; detail = r.ok ? "botões enviados" : `erro: ${r.error}`;
        }
        // buttons implies pause waiting for user click (treated as wait_response)
        if (ok && !dryRun) {
          stop = true;
          if (execId) await admin.from("automation_executions").update({
            status: "waiting_response", current_node: node.id, next_node: node.id,
            updated_at: new Date().toISOString(), steps: [...steps, { at: new Date().toISOString(), node_id: node.id, node_type: type, ok, detail }],
          }).eq("id", execId);
          return { status: "waiting_response", steps: [...steps, { at: new Date().toISOString(), node_id: node.id, node_type: type, ok, detail }], execId, next: node.id };
        }
      } else if (type === "list") {
        const text = interpolate(String(d.text || ""), vars);
        if (dryRun) detail = `enviaria lista com ${(d.items || []).length} opções`;
        else {
          const r = await sendWhatsapp(tenantId, vars.lead.whatsapp, "list", { text, items: d.items || [], title: d.title, buttonText: d.buttonText, footer: d.footer });
          ok = r.ok; detail = r.ok ? "lista enviada" : `erro: ${r.error}`;
          if (ok) stop = true;
        }
      } else if (type === "audio") {
        if (dryRun) detail = `enviaria áudio: ${d.url || "(sem url)"}`;
        else {
          const r = await sendWhatsapp(tenantId, vars.lead.whatsapp, "audio", { url: d.url });
          ok = r.ok; detail = r.ok ? "áudio enviado" : `erro: ${r.error}`;
        }
      } else if (type === "media") {
        if (dryRun) detail = `enviaria mídia: ${d.url || "(sem url)"}`;
        else {
          const r = await sendWhatsapp(tenantId, vars.lead.whatsapp, "media", { url: d.url, media_type: d.media_type, caption: interpolate(String(d.caption || ""), vars) });
          ok = r.ok; detail = r.ok ? "mídia enviada" : `erro: ${r.error}`;
        }
      } else if (type === "wait_response") {
        detail = "aguardando resposta do contato";
        if (!dryRun && execId) {
          const nexts = nextNodeIds(edges, node.id);
          await admin.from("automation_executions").update({
            status: "waiting_response", current_node: node.id, next_node: nexts[0] || null,
            updated_at: new Date().toISOString(),
            steps: [...steps, { at: new Date().toISOString(), node_id: node.id, node_type: type, ok: true, detail }],
          }).eq("id", execId);
          return { status: "waiting_response", steps: [...steps, { at: new Date().toISOString(), node_id: node.id, node_type: type, ok: true, detail }], execId, next: nexts[0] || null };
        }
        stop = dryRun ? false : true;
      } else if (type === "wait") {
        const minutes = (Number(d.minutes) || 0) + (Number(d.hours) || 0) * 60 + (Number(d.days) || 0) * 60 * 24;
        detail = `aguardar ${minutes} min`;
        if (!dryRun && execId) {
          const waitUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();
          const nexts = nextNodeIds(edges, node.id);
          await admin.from("automation_executions").update({
            status: "waiting_delay", current_node: node.id, next_node: nexts[0] || null, wait_until: waitUntil,
            updated_at: new Date().toISOString(),
            steps: [...steps, { at: new Date().toISOString(), node_id: node.id, node_type: type, ok: true, detail }],
          }).eq("id", execId);
          return { status: "waiting_delay", steps: [...steps, { at: new Date().toISOString(), node_id: node.id, node_type: type, ok: true, detail }], execId, next: nexts[0] || null };
        }
      } else if (type === "condition") {
        const expr: string = d.expression || "";
        // Simple parser: "lead.status = 'ganho'" or "lead.origem contains 'facebook'"
        const m = expr.match(/^\s*([\w.]+)\s*(=|!=|contains|>|<)\s*['"]?([^'"]+)['"]?\s*$/i);
        let cond = false;
        if (m) {
          const left = interpolate(`{{${m[1]}}}`, vars);
          const op = m[2].toLowerCase(); const right = m[3];
          if (op === "=") cond = left == right;
          else if (op === "!=") cond = left != right;
          else if (op === "contains") cond = left.toLowerCase().includes(right.toLowerCase());
          else if (op === ">") cond = Number(left) > Number(right);
          else if (op === "<") cond = Number(left) < Number(right);
        }
        branchHandle = cond ? "true" : "false";
        detail = `${expr || "(sem expressão)"} → ${branchHandle}`;
      } else if (type === "split") {
        branchHandle = Math.random() < 0.5 ? "a" : "b";
        detail = `split → ${branchHandle}`;
      } else if (type === "kanban_move") {
        detail = `mover para "${d.value || d.column || ""}"`;
        if (!dryRun && ctx.lead_id) {
          const { error } = await admin.from("leads").update({ status: d.value || d.column }).eq("id", ctx.lead_id);
          if (error) { ok = false; detail += ` (erro: ${error.message})`; }
        }
      } else if (type === "kanban_create") {
        detail = "criar lead";
        if (!dryRun && tenantId) {
          const { error } = await admin.from("leads").insert({
            tenant_id: tenantId, nome_completo: interpolate(d.nome || vars.lead.nome || "Lead", vars),
            whatsapp: interpolate(d.whatsapp || vars.lead.whatsapp || "", vars),
            email: interpolate(d.email || vars.lead.email || "", vars),
            status: d.status || "lead", origem: "automation",
          });
          if (error) { ok = false; detail += ` (erro: ${error.message})`; }
        }
      } else if (type === "kanban_update") {
        detail = `atualizar ${d.value || d.field}=${d.newValue || ""}`;
        if (!dryRun && ctx.lead_id && d.value) {
          const patch: any = {}; patch[d.value] = interpolate(String(d.newValue || ""), vars);
          const { error } = await admin.from("leads").update(patch).eq("id", ctx.lead_id);
          if (error) { ok = false; detail += ` (erro: ${error.message})`; }
        }
      } else if (type === "kanban_tag") {
        detail = `tag: ${d.value || ""}`;
        if (!dryRun && ctx.lead_id) {
          const { data: lead } = await admin.from("leads").select("observacoes").eq("id", ctx.lead_id).maybeSingle();
          const tag = String(d.value || "").trim();
          if (tag) {
            const obs = (lead?.observacoes || "") + `\n[tag:${tag}]`;
            await admin.from("leads").update({ observacoes: obs }).eq("id", ctx.lead_id);
          }
        }
      } else if (type === "appointment_create") {
        detail = "criar agendamento";
        if (!dryRun && tenantId) {
          const when = d.date_time ? new Date(d.date_time).toISOString() : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
          const { error } = await admin.from("appointments").insert({
            tenant_id: tenantId, lead_id: ctx.lead_id ?? null,
            client_name: vars.lead.nome || "Paciente",
            client_phone: vars.lead.whatsapp || "",
            date_time: when, duration_minutes: Number(d.duration) || 60,
            appointment_type: d.appointment_type || "consulta",
            procedure: d.procedure || null, status: "agendado",
          });
          if (error) { ok = false; detail += ` (erro: ${error.message})`; }
        }
      } else if (type === "appointment_link") {
        const link = interpolate(String(d.url || ""), vars);
        detail = `enviaria link ${link}`;
        if (!dryRun) {
          const text = interpolate(String(d.text || "Agende sua consulta:") + " " + link, vars);
          const r = await sendWhatsapp(tenantId, vars.lead.whatsapp, "text", { text });
          ok = r.ok; if (!ok) detail = `erro: ${r.error}`;
        }
      } else if (type === "appointment_confirm" || type === "appointment_cancel") {
        const newStatus = type === "appointment_confirm" ? "compareceu" : "cancelado";
        detail = `${type} → ${newStatus}`;
        if (!dryRun && ctx.appointment_id) {
          await admin.from("appointments").update({ status: newStatus }).eq("id", ctx.appointment_id);
        }
      } else if (type === "notify_team") {
        const text = interpolate(String(d.text || `Novo evento no fluxo ${flow.name}`), vars);
        detail = `notificar equipe: "${text.slice(0, 60)}"`;
        if (!dryRun && tenantId) {
          // Send to configured recipients (phones list) or all tenant admins
          const nums: string[] = Array.isArray(d.phones) ? d.phones : String(d.phones || "").split(",").map((s: string) => s.trim()).filter(Boolean);
          for (const p of nums) await sendWhatsapp(tenantId, p, "text", { text });
        }
      } else if (type === "end") {
        detail = "fim";
        stop = true;
      } else {
        detail = "nó desconhecido, ignorando";
      }
    } catch (e) {
      ok = false; detail = `exceção: ${String(e).slice(0, 200)}`;
    }

    steps.push({ at: new Date().toISOString(), node_id: node.id, node_type: type, ok, detail });
    if (stop) break;

    // Advance
    const nexts = nextNodeIds(edges, node.id, branchHandle ?? undefined);
    if (nexts.length === 0) break;
    current = findNode(nexts[0]);
  }

  const status = "completed";
  if (execId && !dryRun) {
    await admin.from("automation_executions").update({
      status, steps, completed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", execId);
  }
  return { status, steps, execId };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  let payload: any = {};
  try { payload = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  const trigger: string = String(payload.trigger || "");
  const tenantId: string | null = payload.tenant_id ?? null;
  const ctx: RunContext = payload.context || {};
  const dryRun: boolean = Boolean(payload.dry_run);
  const explicitFlowId: string | null = payload.flow_id ?? null;

  if (!trigger && !explicitFlowId) return json({ error: "trigger_or_flow_id_required" }, 400);

  // Resume path: incoming message may resume waiting executions
  if (trigger === "message_received" && !dryRun) {
    const digits = onlyDigits(ctx.phone || "");
    if (digits) {
      let rq = admin.from("automation_executions").select("*")
        .eq("status", "waiting_response").ilike("contact_phone", `%${digits.slice(-8)}%`);
      rq = tenantId ? rq.eq("tenant_id", tenantId) : rq.is("tenant_id", null);
      const { data: waiting } = await rq.order("updated_at", { ascending: false }).limit(5);
      for (const w of waiting || []) {
        const { data: flow } = await admin.from("automation_flows").select("*").eq("id", w.flow_id).maybeSingle();
        if (!flow) continue;
        const nextNode = w.next_node || w.current_node;
        if (!nextNode) continue;
        const edges: FlowEdge[] = flow.edges || [];
        // Route by button/list label if applicable
        const candidates = edges.filter((e) => e.source === w.current_node);
        let start = nextNode;
        const label = (ctx.text || "").toLowerCase().trim();
        const matched = candidates.find((e) => (e.label || "").toLowerCase().trim() === label);
        if (matched) start = matched.target;
        await runFlow(flow, { ...ctx, lead_id: w.lead_id }, tenantId, false, w.id, start, (w.steps as any) || []);
      }
    }
  }

  // Find matching flows
  let flowsQ = admin.from("automation_flows").select("*").eq("status", "active");
  if (explicitFlowId) flowsQ = flowsQ.eq("id", explicitFlowId);
  else flowsQ = flowsQ.eq("trigger_type", trigger);
  if (tenantId) flowsQ = flowsQ.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  const { data: flows, error: flowsErr } = await flowsQ;
  if (flowsErr) return json({ error: flowsErr.message }, 500);

  const runs: any[] = [];
  for (const flow of flows || []) {
    // Filter by trigger_config
    const cfg = flow.trigger_config || {};
    if (trigger === "message_received") {
      if (!keywordsMatch(cfg, String(ctx.text || ""))) continue;
    }
    if ((trigger === "form_submitted" || trigger === "lead_entered") && cfg.form_name) {
      if (!String(ctx.form_name || "").toLowerCase().includes(String(cfg.form_name).toLowerCase())) continue;
    }
    if (trigger === "kanban_moved" && cfg.column) {
      if (String(ctx.to_status || "").toLowerCase() !== String(cfg.column).toLowerCase()) continue;
    }

    let execId: string | null = null;
    if (!dryRun) {
      const { data: exec } = await admin.from("automation_executions").insert({
        tenant_id: tenantId, flow_id: flow.id, lead_id: ctx.lead_id ?? null,
        contact_name: ctx.name ?? null, contact_phone: ctx.phone ?? null,
        status: "running", trigger_type: trigger, context: ctx as any, steps: [] as any,
        started_at: new Date().toISOString(),
      }).select("id").maybeSingle();
      execId = exec?.id ?? null;
    }
    const res = await runFlow(flow, ctx, tenantId, dryRun, execId);
    runs.push({ flow_id: flow.id, flow_name: flow.name, execution_id: execId, ...res });
  }

  return json({ ok: true, matched: runs.length, runs });
});
