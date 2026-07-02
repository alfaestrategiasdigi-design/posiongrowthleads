// Lista campanhas Meta filtradas pelas ad_accounts mapeadas ao tenant.
// Auth: usuário membro do tenant (tenant_users) OU admin master.
// Body: { tenant_id: uuid, since?: 'YYYY-MM-DD', until?: 'YYYY-MM-DD', active_only?: boolean }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GRAPH = "https://graph.facebook.com/v21.0";

const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const cache = new Map<string, { v: any; exp: number }>();
const TTL = 180000;

async function fbGet(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const r = await fetch(url);
  return { ok: r.ok, body: await r.json() };
}

async function mapLimit<T, R>(items: T[], n: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (true) { const idx = i++; if (idx >= items.length) return; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
  const uid = claims?.claims?.sub;
  if (!uid) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const tenantId = String(body.tenant_id ?? "");
  if (!tenantId) return json({ error: "tenant_id obrigatório" }, 400);

  // Autoriza: membro ativo do tenant OU admin
  const { data: hasAccess } = await admin.rpc("has_tenant_access", { _user_id: uid, _tenant_id: tenantId });
  if (!hasAccess) return json({ error: "Forbidden" }, 403);

  // Contas de anúncio mapeadas
  const { data: mappings, error: mErr } = await admin
    .from("tenant_ad_accounts")
    .select("ad_account_id, label, active")
    .eq("tenant_id", tenantId).eq("active", true);
  if (mErr) return json({ error: mErr.message }, 500);
  if (!mappings || mappings.length === 0) {
    return json({ ok: true, data: [], ad_accounts: [], reason: "no_mapping" });
  }

  const { data: cfg } = await admin
    .from("facebook_webhook_config")
    .select("user_access_token").limit(1).maybeSingle();
  const token = String(cfg?.user_access_token ?? "").trim();
  if (!token) return json({ ok: false, error: "Token do Facebook indisponível.", need_reconnect: true }, 200);

  const since = String(body.since ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const until = String(body.until ?? new Date().toISOString().slice(0, 10));
  const activeOnly = !!body.active_only;

  const all: any[] = [];
  const accounts = mappings.map((m: any) => {
    let id = String(m.ad_account_id ?? "").trim();
    if (id && !id.startsWith("act_")) id = `act_${id}`;
    return { id, label: m.label as string | null };
  }).filter((a) => a.id);

  for (const acc of accounts) {
    const cr = await fbGet(`${acc.id}/campaigns`, token, {
      fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time",
      limit: "200",
    });
    if (!cr.ok) continue;
    let camps: any[] = cr.body?.data ?? [];
    if (activeOnly) camps = camps.filter((c) => c.effective_status === "ACTIVE" || c.status === "ACTIVE");
    if (!camps.length) continue;

    const withIns = await mapLimit(camps, 3, async (c) => {
      const key = `${c.id}|${since}|${until}`;
      const hit = cache.get(key);
      let row: any = null;
      if (hit && hit.exp > Date.now()) row = hit.v;
      else {
        const ir = await fbGet(`${c.id}/insights`, token, {
          fields: "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values",
          time_range: JSON.stringify({ since, until }), level: "campaign",
        });
        if (ir.ok) { row = ir.body?.data?.[0] ?? null; cache.set(key, { v: row, exp: Date.now() + TTL }); }
      }
      let leads = 0, purchases = 0, purchase_value = 0;
      for (const a of row?.actions ?? []) {
        if (["lead", "leadgen.other", "onsite_conversion.lead_grouped"].includes(a.action_type)) leads += +a.value || 0;
        if (["purchase", "offsite_conversion.fb_pixel_purchase"].includes(a.action_type)) purchases += +a.value || 0;
      }
      for (const a of row?.action_values ?? []) {
        if (["purchase", "offsite_conversion.fb_pixel_purchase"].includes(a.action_type)) purchase_value += +a.value || 0;
      }
      const spend = +row?.spend || 0;
      return {
        ...c,
        ad_account_id: acc.id,
        ad_account_label: acc.label,
        insights: row ? {
          spend, impressions: +row.impressions || 0, clicks: +row.clicks || 0,
          ctr: +row.ctr || 0, cpc: +row.cpc || 0, cpm: +row.cpm || 0,
          leads, cpl: leads > 0 ? spend / leads : 0,
          purchases, purchase_value, roas: spend > 0 ? purchase_value / spend : 0,
        } : null,
      };
    });
    all.push(...withIns);
  }

  return json({ ok: true, data: all, ad_accounts: accounts, since, until });
});
