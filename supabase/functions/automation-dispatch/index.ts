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

function compactText(value: unknown, fallback: string): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function buttonDisplayText(value: unknown, fallback: string): string {
  // WhatsApp quick-reply buttons are very strict; keep labels short and clean.
  return compactText(value, fallback).slice(0, 20);
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isGenericButtonArtifact(value: string): boolean {
  const key = stripDiacritics(value).toLowerCase().replace(/[^a-z0-9]/g, "");
  // Covers old/default labels that sometimes arrived in WhatsApp as "Botão~pp".
  return key === "botao" || /^botaop[cps]*$/.test(key);
}

function menuOptionText(value: unknown, fallback: string): string {
  const text = compactText(value, fallback).replace(/[\u0000-\u001F\u007F]/g, "").trim();
  if (!text || isGenericButtonArtifact(text)) return fallback;
  return text.slice(0, 60);
}

function buttonId(value: unknown, fallback: string): string {
  const safe = String(value ?? "").trim().replace(/[^\w-]/g, "_").slice(0, 64);
  return safe || fallback;
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

// Cache Evolution version per base URL to avoid a probe on every send.
const evolutionVersionCache = new Map<string, { version: string; at: number }>();
const EVO_VERSION_TTL_MS = 10 * 60 * 1000;

async function detectEvolutionVersion(base: string, apiKey: string): Promise<string> {
  const cached = evolutionVersionCache.get(base);
  if (cached && Date.now() - cached.at < EVO_VERSION_TTL_MS) return cached.version;
  let version = "";
  try {
    const r = await fetch(`${base}/`, {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(5_000),
    });
    if (r.ok) {
      const j = await r.json().catch(() => ({}));
      version = String(j?.version || j?.data?.version || "");
    }
  } catch { /* ignore */ }
  evolutionVersionCache.set(base, { version, at: Date.now() });
  return version;
}

function isFoundationVersion(v: string): boolean {
  // Evolution Foundation forks use v2.2+, and expect the buttonId/buttonText format.
  const m = /^(\d+)\.(\d+)/.exec(v || "");
  if (!m) return false;
  const major = Number(m[1]); const minor = Number(m[2]);
  return major > 2 || (major === 2 && minor >= 2);
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
    const rawButtons = (data.buttons || []).slice(0, 3);
    if (rawButtons.length === 0) return { ok: false, error: "buttons_empty" };
    const version = await detectEvolutionVersion(base, conn.api_key);
    const useFoundation = isFoundationVersion(version);
    const text = compactText(data.text || data.description, "Escolha uma opção");
    const footer = compactText(data.footer, "");
    if (useFoundation) {
      // Evolution Foundation v2.2+ payload
      const buttons = rawButtons.map((b: any, i: number) => ({
        buttonId: buttonId(b.id, `btn_${i}`),
        buttonText: { displayText: buttonDisplayText(b.displayLabel || b.label, `Botão ${i + 1}`) },
      }));
      body = { number: digits, text, footerText: footer || undefined, buttons };
    } else {
      // Evo API Cloud / v2.1.x payload
      const buttons = rawButtons.map((b: any, i: number) => ({
        type: "reply",
        displayText: buttonDisplayText(b.displayLabel || b.label, `Botão ${i + 1}`),
        id: buttonId(b.id, `btn_${i}`),
      }));
      body = {
        number: digits,
        title: compactText(data.title, ""),
        description: text,
        footer: footer || " ",
        buttons,
      };
    }
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
      rowId: buttonId(it.id, `row_${i}`),
      title: menuOptionText(it.label, `Opção ${i + 1}`).slice(0, 24),
      // Evolution rejects list rows when description is empty.
      description: menuOptionText(it.description || it.label || "Toque para selecionar", "Toque para selecionar"),
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
    const r = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    const raw = await r.text();
    let j: any = {};
    try { j = raw ? JSON.parse(raw) : {}; } catch { j = { raw }; }
    if (!r.ok) return { ok: false, error: `evolution_${r.status}: ${JSON.stringify(j).slice(0, 300)}` };
    const wamid = j?.key?.id ?? j?.messageId ?? null;
    return { ok: true, wamid };
  } catch (e) {
    const msg = e instanceof DOMException && e.name === "TimeoutError" ? "timeout_20s" : String(e).slice(0, 200);
    return { ok: false, error: `network: ${msg}` };
  }
}

function buildButtonsTextMessage(data: { title?: string; text?: string; footer?: string; buttons: Array<{ label: string; displayLabel?: string }> }) {
  const lines: string[] = [];
  const title = compactText(data.title, "");
  const text = compactText(data.text, "");
  const footer = compactText(data.footer, "");
  if (title) lines.push(`*${title}*`);
  if (text) lines.push(text);
  const options = data.buttons.slice(0, 3).map((b, i) => `${i + 1}. ${menuOptionText(b.displayLabel || b.label, `Opção ${i + 1}`)}`);
  if (options.length > 0) lines.push(options.join("\n"));
  if (footer) lines.push(footer);
  return lines.filter(Boolean).join("\n\n");
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
    // Find trigger node, or the first node with no incoming edges if the user forgot the trigger.
    const triggerNode = nodes.find((n) => n.type === "trigger") ?? null;
    const incoming = new Set(edges.map((e) => e.target));
    const positionedNodes = [...nodes]
      .filter((n) => n.type !== "end")
      .sort((a, b) => ((a.position?.y ?? 0) - (b.position?.y ?? 0)) || ((a.position?.x ?? 0) - (b.position?.x ?? 0)));
    const entryNode = positionedNodes.find((n) => !incoming.has(n.id)) ?? positionedNodes[0] ?? null;
    current = triggerNode ?? entryNode ?? nodes[0] ?? null;
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
        const title = interpolate(String(d.title || ""), vars);
        const footer = interpolate(String(d.footer || ""), vars);
        const btns = (d.buttons || []).map((b: any, i: number) => ({
          id: buttonId(b.id, `btn_${i}`),
          label: b.label || `Opção ${i + 1}`,
          displayLabel: menuOptionText(b.label, `Opção ${i + 1}`),
        }));
        // Build button_map: id/label -> target node
        const outEdges = edges.filter((e) => e.source === node.id);
        const buttonMap: Record<string, string> = {};
        btns.forEach((b, i) => {
          const match = outEdges.find((e) =>
            (e.sourceHandle || "") === b.id ||
            (e.sourceHandle || "").toLowerCase() === b.label.toLowerCase() ||
            (e.label || "").toLowerCase() === b.label.toLowerCase()
          ) || outEdges[i];
          if (match) {
            buttonMap[String(i + 1)] = match.target;
            buttonMap[b.id.toLowerCase()] = match.target;
            buttonMap[b.label.toLowerCase()] = match.target;
            buttonMap[b.displayLabel.toLowerCase()] = match.target;
          }
        });
        const buttonsText = buildButtonsTextMessage({ title, text, footer, buttons: btns });
        if (dryRun) detail = `enviaria list message: [${btns.map((b) => b.displayLabel).join(", ")}] → ${new Set(Object.values(buttonMap)).size} rotas`;
        else {
          // Tenta list message nativa; se a Evolution falhar (build/aparelho), cai para texto numerado.
          const listPayload = {
            title: title || "Opções",
            text: text || "Escolha uma opção",
            buttonText: "Ver opções",
            footer: footer || "",
            sectionTitle: "Opções",
            items: btns.map((b) => ({ id: b.id, label: b.displayLabel, description: b.displayLabel })),
          };
          let r = await sendWhatsapp(tenantId, vars.lead.whatsapp, "list", listPayload);
          if (!r.ok) {
            console.warn("[automation-dispatch] sendList falhou, fallback texto numerado:", r.error);
            const rt = await sendWhatsapp(tenantId, vars.lead.whatsapp, "text", { text: buttonsText });
            ok = rt.ok;
            detail = rt.ok
              ? `list falhou (${r.error}); menu numerado enviado (${btns.length}, ${new Set(Object.values(buttonMap)).size} rotas)`
              : `erro list: ${r.error} | erro texto: ${rt.error}`;
          } else {
            ok = true;
            detail = `list message enviada (${btns.length}, ${new Set(Object.values(buttonMap)).size} rotas, wamid ${r.wamid ?? "-"})`;
          }
        }

        if (ok && !dryRun) {
          stop = true;
          const newSteps = [...steps, { at: new Date().toISOString(), node_id: node.id, node_type: type, ok, detail }];
          if (execId) {
            // Merge button_map into execution context for resume
            const { data: currentExec } = await admin.from("automation_executions").select("context").eq("id", execId).maybeSingle();
            const newContext = { ...((currentExec?.context as any) || ctx), button_map: buttonMap };
            await admin.from("automation_executions").update({
              status: "waiting_response", current_node: node.id, next_node: null,
              context: newContext, updated_at: new Date().toISOString(), steps: newSteps,
            }).eq("id", execId);
          }
          return { status: "waiting_response", steps: newSteps, execId, next: null };
        }

      } else if (type === "list") {
        // Mesma abordagem do "buttons": envia menu numerado em texto e aguarda resposta.
        const title = interpolate(String(d.title || "Opções"), vars);
        const text = interpolate(String(d.text || d.description || "Escolha uma opção"), vars);
        const footer = interpolate(String(d.footer || ""), vars);
        const items = (d.items || []).map((it: any, i: number) => ({
          id: buttonId(it.id, `row_${i}`),
          label: menuOptionText(it.label, `Opção ${i + 1}`),
          displayLabel: menuOptionText(it.label, `Opção ${i + 1}`),
        }));
        const outEdges = edges.filter((e) => e.source === node.id);
        const listMap: Record<string, string> = {};
        items.forEach((it, i) => {
          const match = outEdges.find((e) =>
            (e.sourceHandle || "") === it.id ||
            (e.sourceHandle || "").toLowerCase() === it.label.toLowerCase() ||
            (e.label || "").toLowerCase() === it.label.toLowerCase()
          ) || outEdges[i] || (outEdges.length === 1 ? outEdges[0] : null);
          if (match) {
            listMap[String(i + 1)] = match.target;
            listMap[it.id.toLowerCase()] = match.target;
            listMap[it.label.toLowerCase()] = match.target;
          }
        });
        const menuText = buildButtonsTextMessage({ title, text, footer, buttons: items });
        if (dryRun) detail = `enviaria list message (${items.length}) → ${new Set(Object.values(listMap)).size} rotas`;
        else {
          const listPayload = {
            title: title || "Opções",
            text: text || "Escolha uma opção",
            buttonText: "Ver opções",
            footer: footer || "",
            sectionTitle: title || "Opções",
            items: items.map((it) => ({ id: it.id, label: it.displayLabel, description: it.displayLabel })),
          };
          let r = await sendWhatsapp(tenantId, vars.lead.whatsapp, "list", listPayload);
          if (!r.ok) {
            console.warn("[automation-dispatch] sendList falhou, fallback texto numerado:", r.error);
            const rt = await sendWhatsapp(tenantId, vars.lead.whatsapp, "text", { text: menuText });
            ok = rt.ok;
            detail = rt.ok
              ? `list falhou (${r.error}); lista numerada enviada (${items.length}, ${new Set(Object.values(listMap)).size} rotas)`
              : `erro list: ${r.error} | erro texto: ${rt.error}`;
          } else {
            ok = true;
            detail = `list message enviada (${items.length}, ${new Set(Object.values(listMap)).size} rotas, wamid ${r.wamid ?? "-"})`;
          }
        }

        if (ok && !dryRun) {
          stop = true;
          const newSteps = [...steps, { at: new Date().toISOString(), node_id: node.id, node_type: type, ok, detail }];
          if (execId) {
            const { data: currentExec } = await admin.from("automation_executions").select("context").eq("id", execId).maybeSingle();
            const newContext = { ...((currentExec?.context as any) || ctx), button_map: listMap };
            await admin.from("automation_executions").update({
              status: "waiting_response", current_node: node.id, next_node: null,
              context: newContext, updated_at: new Date().toISOString(), steps: newSteps,
            }).eq("id", execId);
          }
          return { status: "waiting_response", steps: newSteps, execId, next: null };
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
        const totalSeconds = (Number(d.seconds) || 0) + (Number(d.minutes) || 0) * 60 + (Number(d.hours) || 0) * 3600 + (Number(d.days) || 0) * 86400;
        detail = totalSeconds < 60 ? `aguardar ${totalSeconds}s` : `aguardar ${Math.round(totalSeconds / 60)} min`;
        if (!dryRun && execId) {
          const waitUntil = new Date(Date.now() + totalSeconds * 1000).toISOString();
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
        const target = interpolate(String(d.value || d.column || ""), vars);
        const allowed = new Set(["lead","qualificado","reuniao","proposta","negociacao","ganho","perdido"]);
        detail = `mover para "${target}"`;
        if (!target || !allowed.has(target.toLowerCase())) {
          ok = false; detail += ` (status inválido)`;
        } else if (!dryRun && ctx.lead_id) {
          const { error } = await admin.from("leads").update({ status: target.toLowerCase() }).eq("id", ctx.lead_id);
          if (error) { ok = false; detail += ` (erro: ${error.message})`; }
        } else if (!ctx.lead_id) {
          ok = false; detail += ` (sem lead_id no contexto)`;
        }
      } else if (type === "kanban_create") {
        detail = "criar lead";
        if (!dryRun && tenantId) {
          const { data: created, error } = await admin.from("leads").insert({
            tenant_id: tenantId,
            nome_completo: interpolate(d.nome || vars.lead.nome || "Lead", vars),
            whatsapp: interpolate(d.whatsapp || vars.lead.whatsapp || "", vars),
            email: interpolate(d.email || vars.lead.email || "", vars),
            status: d.status || "lead", origem: "automation",
          }).select("id").maybeSingle();
          if (error) { ok = false; detail += ` (erro: ${error.message})`; }
          else if (created) { ctx.lead_id = created.id; vars.lead.id = created.id; detail += ` (id ${created.id.slice(0,8)})`; }
        }

      } else if (type === "kanban_update") {
        // Whitelist de campos permitidos para evitar UPDATE em coluna inexistente.
        const ALLOWED_LEAD_FIELDS = new Set([
          "nome_completo","whatsapp","email","status","especialidade","origem",
          "valor_proposta","observacoes","motivo_perda","cidade_estado","nome_empresa",
          "cnpj","facebook_form_name","utm_campaign","utm_source","utm_medium",
        ]);
        const field = String(d.value || d.field || "").trim();
        detail = `atualizar ${field}=${d.newValue || ""}`;
        if (!ALLOWED_LEAD_FIELDS.has(field)) {
          ok = false; detail += ` (campo inválido)`;
        } else if (!dryRun && ctx.lead_id) {
          const patch: any = {}; patch[field] = interpolate(String(d.newValue || ""), vars);
          const { error } = await admin.from("leads").update(patch).eq("id", ctx.lead_id);
          if (error) { ok = false; detail += ` (erro: ${error.message})`; }
        }
      } else if (type === "kanban_tag") {
        const tag = String(d.value || "").trim();
        detail = `tag: ${tag}`;
        if (!tag) { ok = false; detail = "tag vazia"; }
        else if (!dryRun && ctx.lead_id) {
          const { data: lead } = await admin.from("leads").select("extras").eq("id", ctx.lead_id).maybeSingle();
          const extras = (lead?.extras as any) || {};
          const current: string[] = Array.isArray(extras.tags) ? extras.tags : [];
          if (!current.includes(tag)) {
            const next = { ...extras, tags: [...current, tag] };
            const { error } = await admin.from("leads").update({ extras: next }).eq("id", ctx.lead_id);
            if (error) { ok = false; detail += ` (erro: ${error.message})`; }
          }
        }
      } else if (type === "appointment_create") {
        detail = "criar agendamento";
        if (!dryRun && tenantId) {
          // Accept ISO, "+1d", "+2h", or fallback +24h
          let when: string;
          const dt = String(d.date_time || "").trim();
          const rel = dt.match(/^\+\s*(\d+)\s*([hdm])$/i);
          if (rel) {
            const n = Number(rel[1]);
            const unit = rel[2].toLowerCase();
            const ms = n * (unit === "d" ? 86400000 : unit === "h" ? 3600000 : 60000);
            when = new Date(Date.now() + ms).toISOString();
          } else if (dt) {
            const parsed = new Date(dt);
            when = isNaN(parsed.getTime()) ? new Date(Date.now() + 86400000).toISOString() : parsed.toISOString();
          } else {
            when = new Date(Date.now() + 86400000).toISOString();
          }
          const { data: appt, error } = await admin.from("appointments").insert({
            tenant_id: tenantId, lead_id: ctx.lead_id ?? null,
            client_name: vars.lead.nome || "Paciente",
            client_phone: vars.lead.whatsapp || "",
            date_time: when, duration_minutes: Number(d.duration) || 60,
            appointment_type: d.appointment_type || "consulta",
            procedure: d.procedure || null, status: "agendado",
          }).select("id").maybeSingle();
          if (error) { ok = false; detail += ` (erro: ${error.message})`; }
          else if (appt) { ctx.appointment_id = appt.id; detail += ` (${new Date(when).toLocaleString("pt-BR")})`; }
        }
      } else if (type === "appointment_link") {
        const link = interpolate(String(d.url || ""), vars);
        const label = interpolate(String(d.text || "Agende sua consulta:"), vars);
        const text = `${label} ${link}`.trim();
        detail = `enviaria: "${text.slice(0, 80)}"`;
        if (!dryRun) {
          const r = await sendWhatsapp(tenantId, vars.lead.whatsapp, "text", { text });
          ok = r.ok; if (!ok) detail = `erro: ${r.error}`;
        }

      } else if (type === "appointment_confirm" || type === "appointment_cancel") {
        const newStatus = type === "appointment_confirm" ? "confirmado" : "cancelado";
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
    if (execId && !dryRun) {
      await admin.from("automation_executions").update({
        current_node: node.id,
        steps,
        updated_at: new Date().toISOString(),
      }).eq("id", execId);
    }
    if (!ok) {
      if (execId && !dryRun) {
        await admin.from("automation_executions").update({
          status: "failed",
          steps,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", execId);
      }
      return { status: "failed", steps, execId };
    }
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

let cachedDispatchToken: { value: string; expiresAt: number } | null = null;
async function getDispatchToken(): Promise<string | null> {
  if (cachedDispatchToken && cachedDispatchToken.expiresAt > Date.now()) return cachedDispatchToken.value;
  const { data } = await admin.from("edge_internal_config").select("dispatch_token").eq("id", 1).maybeSingle();
  const value = (data as any)?.dispatch_token ?? null;
  if (value) cachedDispatchToken = { value, expiresAt: Date.now() + 60_000 };
  return value;
}

async function authorizeDispatch(req: Request, tenantId: string | null): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "unauthorized" };

  // 1. Internal callers: service role key or the internal dispatch token stored in edge_internal_config
  if (token === SERVICE_KEY) return { ok: true };
  const internal = await getDispatchToken();
  if (internal && token === internal) return { ok: true };

  // 2. Authenticated user with access to the tenant
  try {
    const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData } = await userClient.auth.getClaims(token);
    const sub = (claimsData?.claims as any)?.sub as string | undefined;
    if (!sub) return { ok: false, status: 401, error: "invalid_session" };
    if (!tenantId) {
      // No tenant scope → only admins may run untargeted dispatches
      const { data: isAdmin } = await admin.rpc("has_role", { _user_id: sub, _role: "admin" });
      return isAdmin ? { ok: true } : { ok: false, status: 403, error: "tenant_id_required" };
    }
    const { data: hasAccess } = await admin.rpc("has_tenant_access", { _user_id: sub, _tenant_id: tenantId });
    return hasAccess ? { ok: true } : { ok: false, status: 403, error: "forbidden" };
  } catch {
    return { ok: false, status: 401, error: "invalid_token" };
  }
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

  const authz = await authorizeDispatch(req, tenantId);
  if (!authz.ok) return json({ error: authz.error }, authz.status);

  if (!trigger && !explicitFlowId) return json({ error: "trigger_or_flow_id_required" }, 400);

  // Resume path pelo scheduler (nó "Aguardar X horas/dias" cujo wait_until já passou)
  const resumeExecId: string | null = payload.resume_execution_id ?? null;
  const startNodeOverride: string | null = payload.start_node ?? null;
  if (resumeExecId && startNodeOverride && !dryRun) {
    const { data: exec } = await admin.from("automation_executions").select("*").eq("id", resumeExecId).maybeSingle();
    if (!exec) return json({ error: "execution_not_found" }, 404);
    const { data: flow } = await admin.from("automation_flows").select("*").eq("id", exec.flow_id).maybeSingle();
    if (!flow) return json({ error: "flow_not_found" }, 404);
    const savedCtx = (exec.context as any) || {};
    const res = await runFlow(flow, { ...savedCtx, ...ctx, lead_id: exec.lead_id }, exec.tenant_id, false, resumeExecId, startNodeOverride, (exec.steps as any) || []);
    return json({ ok: true, resumed: 1, ...res });
  }

  // Resume path: incoming message may resume waiting executions
  if (trigger === "message_received" && !dryRun) {
    const digits = onlyDigits(ctx.phone || "");
    if (digits) {
      let rq = admin.from("automation_executions").select("*")
        .eq("status", "waiting_response").ilike("contact_phone", `%${digits.slice(-8)}%`);
      rq = tenantId ? rq.eq("tenant_id", tenantId) : rq.is("tenant_id", null);
      const { data: waiting } = await rq.order("updated_at", { ascending: false }).limit(5);
      const resumedFlowIds = new Set<string>();
      for (const w of waiting || []) {
        const { data: flow } = await admin.from("automation_flows").select("*").eq("id", w.flow_id).maybeSingle();
        if (!flow) continue;
        const edges: FlowEdge[] = flow.edges || [];
        const savedCtx = (w.context as any) || {};
        const buttonMap: Record<string, string> = savedCtx.button_map || {};
        const buttonId = String(ctx.button_id || "").toLowerCase();
        const rawText = String(ctx.text || "").trim();
        const text = rawText.toLowerCase();
        let start: string | null = null;
        // 1) button id vindo do webhook (interactive nativo, quando existir)
        if (buttonId && buttonMap[buttonId]) start = buttonMap[buttonId];
        // 2) match exato de rótulo/id
        if (!start && text && buttonMap[text]) start = buttonMap[text];
        // 3) primeiro dígito na resposta ("1", "opção 2", "quero a 3.")
        if (!start && rawText) {
          const digitMatch = rawText.match(/\d+/);
          if (digitMatch && buttonMap[digitMatch[0]]) start = buttonMap[digitMatch[0]];
        }
        // 4) fuzzy: qualquer chave (rótulo) contida no texto ou vice-versa, ignorando acentos
        if (!start && text) {
          const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
          const nText = norm(rawText);
          const entries = Object.entries(buttonMap).filter(([k]) => !/^\d+$/.test(k) && k.length >= 3);
          const hit = entries.find(([k]) => {
            const nk = norm(k);
            return nText.includes(nk) || nk.includes(nText);
          });
          if (hit) start = hit[1];
        }
        // 5) fallback pelas arestas / next_node
        if (!start) {
          const candidates = edges.filter((e) => e.source === w.current_node);
          const matched = candidates.find((e) => (e.label || "").toLowerCase().trim() === text);
          if (matched) start = matched.target;
          else if (w.next_node) start = w.next_node;
          else if (candidates.length === 1) start = candidates[0].target;
        }
        if (!start) continue;
        resumedFlowIds.add(w.flow_id);
        await runFlow(flow, { ...savedCtx, ...ctx, lead_id: w.lead_id }, tenantId, false, w.id, start, (w.steps as any) || []);
      }
      // If we resumed at least one execution, don't also fire new flows for the same trigger
      // (avoids re-triggering the same flow when user replies to its buttons).
      if (resumedFlowIds.size > 0 && !explicitFlowId) {
        return json({ ok: true, resumed: resumedFlowIds.size });
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
