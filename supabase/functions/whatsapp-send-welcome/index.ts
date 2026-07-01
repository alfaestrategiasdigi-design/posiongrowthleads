// Disparo automático de mensagem de boas-vindas para leads novos.
// Invocado por trigger pg_net com body { lead_id }. Endpoint público (verify_jwt=false).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function normalizeBase(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try { const u = new URL(s); return `${u.protocol}//${u.host}`; }
  catch { return s.replace(/\/+$/, ""); }
}

function render(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? "");
}

function onlyDigits(s: string | null | undefined): string {
  return (s || "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const lead_id = String(body.lead_id ?? "");
  if (!lead_id) return json({ error: "lead_id obrigatório" }, 400);

  const { data: lead } = await admin.from("leads").select("*").eq("id", lead_id).maybeSingle();
  if (!lead) return json({ error: "Lead não encontrado" }, 404);

  let phone = onlyDigits(lead.whatsapp);
  if (!phone) return json({ skipped: "sem whatsapp" });
  if (phone.length === 10 || phone.length === 11) phone = "55" + phone; // BR default

  // Config
  let cfgQ = admin.from("whatsapp_welcome_config").select("*");
  if (lead.tenant_id) cfgQ = cfgQ.eq("tenant_id", lead.tenant_id);
  else cfgQ = cfgQ.is("tenant_id", null);
  const { data: cfg } = await cfgQ.maybeSingle();
  if (!cfg || !cfg.enabled) return json({ skipped: "config desativada" });

  // Instância
  let connQ = admin.from("zapi_connections")
    .select("instance_url, api_key, instance_name, tenant_id")
    .eq("provider", "evolution");
  if (lead.tenant_id) connQ = connQ.eq("tenant_id", lead.tenant_id);
  else connQ = connQ.is("tenant_id", null);
  let { data: conn } = await connQ.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (!conn) {
    const r = await admin.from("zapi_connections")
      .select("instance_url, api_key, instance_name, tenant_id")
      .eq("provider", "evolution").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    conn = r.data;
  }
  if (!conn) return json({ skipped: "sem instância" });

  // Delay
  if (cfg.delay_seconds > 0) {
    await new Promise(r => setTimeout(r, Math.min(cfg.delay_seconds, 60) * 1000));
  }

  const vars = {
    nome: (lead.nome_completo || "").split(" ")[0] || "",
    nome_completo: lead.nome_completo || "",
    empresa: lead.nome_empresa || "",
    especialidade: lead.especialidade || "",
  };
  const text = render(cfg.message_template, vars);
  const remoteJid = `${phone}@s.whatsapp.net`;
  const base = normalizeBase(conn.instance_url);

  // Envio
  let wamid: string | null = null;
  try {
    const r = await fetch(`${base}/message/sendText/${encodeURIComponent(conn.instance_name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.api_key },
      body: JSON.stringify({ number: phone, text }),
    });
    const j = await r.json();
    if (!r.ok) {
      console.error("[welcome send fail]", j);
      return json({ error: "envio falhou", detail: j }, 502);
    }
    wamid = j?.key?.id ?? j?.messageId ?? null;
  } catch (e) {
    return json({ error: String(e) }, 502);
  }

  // Conversa
  let convQ = admin.from("conversations").select("id").eq("remote_jid", remoteJid);
  if (lead.tenant_id) convQ = convQ.eq("tenant_id", lead.tenant_id);
  else convQ = convQ.is("tenant_id", null);
  let { data: conv } = await convQ.maybeSingle();
  if (!conv) {
    let phoneQ = admin.from("conversations").select("id").eq("telefone", phone);
    phoneQ = lead.tenant_id ? phoneQ.eq("tenant_id", lead.tenant_id) : phoneQ.is("tenant_id", null);
    const existingByPhone = await phoneQ.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
    conv = existingByPhone.data;
  }
  if (!conv) {
    const ins = await admin.from("conversations").insert({
      tenant_id: lead.tenant_id,
      telefone: phone,
      remote_jid: remoteJid,
      nome_contato: lead.nome_completo || phone,
      provider: "evolution",
      lead_id: lead.id,
      ultima_mensagem: text,
      ultima_interacao: new Date().toISOString(),
      nao_lidas: 0,
    }).select("id").maybeSingle();
    conv = ins.data;
    if (!conv && ins.error) {
      let retryQ = admin.from("conversations").select("id").eq("telefone", phone);
      retryQ = lead.tenant_id ? retryQ.eq("tenant_id", lead.tenant_id) : retryQ.is("tenant_id", null);
      conv = (await retryQ.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle()).data;
    }
  } else {
    await admin.from("conversations").update({
      ultima_mensagem: text,
      ultima_interacao: new Date().toISOString(),
      lead_id: lead.id,
      telefone: phone,
      remote_jid: remoteJid,
    }).eq("id", conv.id);
  }

  if (conv?.id) {
    await admin.from("messages").insert({
      conversation_id: conv.id,
      sender: "usuario",
      conteudo: text,
      tipo: "text",
      direction: "outbound",
      status: "sent",
      wamid,
      tenant_id: lead.tenant_id,
      tipo_disparo: "boas_vindas",
    });
  }

  return json({ ok: true, wamid });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
