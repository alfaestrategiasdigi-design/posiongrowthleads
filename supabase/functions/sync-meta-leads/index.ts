// Sincroniza leads do Meta (Lead Ads) por ad account e cria conversas no inbox.
// POST body: { limit_per_page?: number, max_pages?: number, since_minutes?: number }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const FB_TOKEN_ENV = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") ?? "";

const pick = (obj: any, keys: string[]): string | null => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
};
function flattenFieldData(arr: any[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    const name = (item?.name ?? "").toString().toLowerCase();
    const value = Array.isArray(item?.values) ? item.values[0] : item?.value;
    if (name && value != null) out[name] = String(value);
  }
  return out;
}
function normPhone(s: string | null): string {
  if (!s) return "";
  return s.replace(/^\+/, "").replace(/\D/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Allow: admin user JWT, service-role bearer, OR a valid X-Cron-Token (set by pg_cron)
  const cronToken = req.headers.get("x-cron-token") ?? req.headers.get("X-Cron-Token");
  let cronOk = false;
  if (cronToken) {
    const { data: cfgTok } = await admin.from("facebook_webhook_config").select("cron_token").limit(1).maybeSingle();
    cronOk = !!cfgTok?.cron_token && cfgTok.cron_token === cronToken;
  }

  if (!cronOk) {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const bearer = authHeader.replace("Bearer ", "").trim();
    const isService = bearer === SERVICE_KEY;
    if (!isService) {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claims } = await userClient.auth.getClaims(bearer);
      if (!claims?.claims) return json({ error: "Unauthorized" }, 401);
      const { data: roleOk } = await admin.rpc("has_role", { _user_id: claims.claims.sub, _role: "admin" });
      if (!roleOk) return json({ error: "Forbidden" }, 403);
    }
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const limitPerPage = Math.max(1, Math.min(200, Number(body.limit_per_page ?? 100)));
  const maxPages = Math.max(1, Math.min(20, Number(body.max_pages ?? 10)));

  const { data: cfg } = await admin.from("facebook_webhook_config")
    .select("page_access_token, user_access_token, ad_account_id, page_id, default_tenant_id")
    .limit(1).maybeSingle();
  const token = cfg?.user_access_token || cfg?.page_access_token || FB_TOKEN_ENV;
  if (!token) return json({ error: "Token Facebook ausente" }, 400);

  // Discover all lead forms for the page (so we can iterate per-form leads)
  if (!cfg?.page_id) return json({ error: "page_id não configurado" }, 400);
  const formsRes = await fetch(`https://graph.facebook.com/v21.0/${cfg.page_id}/leadgen_forms?fields=id,name&limit=100&access_token=${encodeURIComponent(token)}`);
  const formsJson = await formsRes.json();
  if (!formsRes.ok) return json({ error: "Falha listando forms", detail: formsJson }, 502);
  const forms: any[] = formsJson.data ?? [];

  // ISOLAMENTO ESTRITO: default_tenant_id NÃO é usado como fallback.
  // Cada lead precisa de uma regra explícita em lead_routing_rules.
  const adAccountId: string | null = (cfg as any)?.ad_account_id ?? null;
  const pageId: string | null = (cfg as any)?.page_id ?? null;
  let inserted = 0, deduped = 0, errors = 0, unrouted = 0;
  const perForm: any[] = [];

  for (const f of forms) {
    let url = `https://graph.facebook.com/v21.0/${f.id}/leads?fields=id,created_time,field_data,ad_id,adset_id,campaign_id,form_id&limit=${limitPerPage}&access_token=${encodeURIComponent(token)}`;
    let pages = 0, fIns = 0, fDup = 0, fErr = 0, fUnr = 0;
    while (url && pages < maxPages) {
      pages++;
      const r = await fetch(url);
      const j = await r.json();
      if (!r.ok) { fErr++; errors++; break; }
      for (const lead of (j.data ?? [])) {
        const fbId = String(lead.id);
        const dup = await admin.from("leads").select("id").eq("facebook_lead_id", fbId).maybeSingle();
        if (dup.data) { fDup++; deduped++; continue; }
        const fields = flattenFieldData(lead.field_data ?? []);
        const nome = pick(fields, ["full_name", "name", "nome", "nome_completo"]) ?? "(sem nome)";
        const email = pick(fields, ["email", "e-mail", "email_address"]);
        const whatsapp = normPhone(pick(fields, ["phone_number", "phone", "telefone", "whatsapp"]) ?? "");

        // Fase 2 — roteamento por mapeamento
        const { data: rpc } = await admin.rpc("resolve_tenant_for_lead", {
          p_form_id: lead.form_id ?? f.id,
          p_ad_account_id: adAccountId,
          p_page_id: pageId,
        });
        const tenantId = (rpc as string | null) ?? null;

        if (!tenantId) {
          await admin.from("unrouted_leads").insert({
            raw_payload: lead,
            form_id: lead.form_id ?? f.id,
            ad_account_id: adAccountId,
            page_id: pageId,
            facebook_lead_id: fbId,
            nome, whatsapp, email,
          });
          fUnr++; unrouted++;
          continue;
        }

        const insLead = await admin.from("leads").insert({
          nome_completo: nome,
          whatsapp: whatsapp || "(sem telefone)",
          email,
          tenant_id: tenantId,
          origem: "facebook_ads",
          facebook_lead_id: fbId,
          facebook_form_id: lead.form_id ?? f.id,
          facebook_form_name: f.name,
          facebook_ad_id: lead.ad_id ?? null,
          facebook_adset_id: lead.adset_id ?? null,
          facebook_campaign: lead.campaign_id ?? null,
        }).select("id").maybeSingle();
        if (insLead.error) { fErr++; errors++; continue; }
        fIns++; inserted++;


        // Create/upsert conversation so it shows in the WhatsApp inbox
        if (whatsapp) {
          const remoteJid = `${whatsapp}@s.whatsapp.net`;
          let convQ = admin.from("conversations").select("id").eq("remote_jid", remoteJid);
          if (tenantId) convQ = convQ.eq("tenant_id", tenantId);
          else convQ = convQ.is("tenant_id", null);
          let existing = await convQ.maybeSingle();
          if (!existing.data) {
            let phoneQ = admin.from("conversations").select("id").eq("telefone", whatsapp);
            phoneQ = tenantId ? phoneQ.eq("tenant_id", tenantId) : phoneQ.is("tenant_id", null);
            existing = await phoneQ.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
          }
          if (!existing.data) {
            const insertedConv = await admin.from("conversations").insert({
              tenant_id: tenantId,
              telefone: whatsapp,
              remote_jid: remoteJid,
              nome_contato: nome,
              provider: "evolution",
              lead_id: insLead.data?.id ?? null,
              ultima_mensagem: "Lead recém-chegado pelo Meta Ads",
              ultima_interacao: new Date().toISOString(),
            });
            if (insertedConv.error && insLead.data?.id) {
              let retryQ = admin.from("conversations").select("id").eq("telefone", whatsapp);
              retryQ = tenantId ? retryQ.eq("tenant_id", tenantId) : retryQ.is("tenant_id", null);
              const retry = await retryQ.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
              if (retry.data?.id) {
                await admin.from("conversations")
                  .update({ lead_id: insLead.data.id, nome_contato: nome, remote_jid: remoteJid, telefone: whatsapp })
                  .eq("id", retry.data.id);
              }
            }
          } else if (insLead.data?.id) {
            await admin.from("conversations")
              .update({ lead_id: insLead.data.id, nome_contato: nome, remote_jid: remoteJid, telefone: whatsapp })
              .eq("id", existing.data.id);
          }
        }
      }
      url = j?.paging?.next ?? "";
    }
    perForm.push({ form_id: f.id, name: f.name, pages, inserted: fIns, duplicated: fDup, errors: fErr, unrouted: fUnr });
  }

  await admin.from("facebook_webhook_config")
    .update({ last_leads_sync_at: new Date().toISOString() })
    .not("id", "is", null);

  return json({ ok: true, inserted, deduped, errors, unrouted, forms: perForm });

});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
