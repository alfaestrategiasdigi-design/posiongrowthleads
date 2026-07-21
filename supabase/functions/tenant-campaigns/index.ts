// Lista campanhas Meta filtradas pelas ad_accounts mapeadas ao tenant.
// Auth: usuário membro do tenant (tenant_users) OU admin master.
// Body: { tenant_id: uuid, days?: number, since?: 'YYYY-MM-DD', until?: 'YYYY-MM-DD', active_only?: boolean }
// Se `days` for enviado, since/until são calculados no fuso da conta de anúncios (correto para
// alinhar "hoje" / "gasto do dia" com o Ads Manager). since/until explícitos ganham prioridade.
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
const DEFAULT_TZ = "America/Sao_Paulo";

const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const cache = new Map<string, { v: any; exp: number }>();
const TTL = 180000;
const accountMetaCache = new Map<string, { tz: string; currency: string; exp: number }>();
const ACC_TTL = 30 * 60_000;

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

// Retorna 'YYYY-MM-DD' na data local do fuso informado.
function dateInTz(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

function computeRange(days: number, tz: string): { since: string; until: string } {
  const today = dateInTz(new Date(), tz);
  if (days <= 1) return { since: today, until: today };
  // since = today - (days-1) dias, mantendo até `today` inclusive => janela de `days` dias.
  const [y, m, d] = today.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() - (days - 1));
  const since = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
  return { since, until: today };
}

async function getAccountMeta(actId: string, token: string): Promise<{ tz: string; currency: string }> {
  const hit = accountMetaCache.get(actId);
  if (hit && hit.exp > Date.now()) return { tz: hit.tz, currency: hit.currency };
  const r = await fbGet(actId, token, { fields: "timezone_name,currency" });
  const tz = (r.ok && r.body?.timezone_name) ? String(r.body.timezone_name) : DEFAULT_TZ;
  const currency = (r.ok && r.body?.currency) ? String(r.body.currency) : "BRL";
  accountMetaCache.set(actId, { tz, currency, exp: Date.now() + ACC_TTL });
  return { tz, currency };
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

  const { data: hasAccess } = await admin.rpc("has_tenant_access", { _user_id: uid, _tenant_id: tenantId });
  if (!hasAccess) return json({ error: "Forbidden" }, 403);

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

  const days = Number.isFinite(Number(body.days)) ? Math.max(1, Math.min(365, Number(body.days))) : null;
  const explicitSince = typeof body.since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.since) ? body.since : null;
  const explicitUntil = typeof body.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.until) ? body.until : null;
  const activeOnly = !!body.active_only;

  const all: any[] = [];
  const accounts = mappings.map((m: any) => {
    let id = String(m.ad_account_id ?? "").trim();
    if (id && !id.startsWith("act_")) id = `act_${id}`;
    return { id, label: m.label as string | null };
  }).filter((a) => a.id);

  const accountMetaOut: Array<{ id: string; label: string | null; timezone: string; currency: string; since: string; until: string }> = [];

  for (const acc of accounts) {
    // Fuso/moeda da conta para computar a janela correta e formatação futura
    const meta = await getAccountMeta(acc.id, token);
    const effectiveDays = days ?? 30;
    const range = explicitSince && explicitUntil
      ? { since: explicitSince, until: explicitUntil }
      : computeRange(effectiveDays, meta.tz);
    const since = range.since;
    const until = range.until;
    accountMetaOut.push({ id: acc.id, label: acc.label, timezone: meta.tz, currency: meta.currency, since, until });

    const cr = await fbGet(`${acc.id}/campaigns`, token, {
      fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time",
      limit: "200",
    });
    if (!cr.ok) continue;
    let camps: any[] = cr.body?.data ?? [];
    if (activeOnly) camps = camps.filter((c) => c.effective_status === "ACTIVE" || c.status === "ACTIVE");
    if (!camps.length) continue;

    const withIns = await mapLimit(camps, 3, async (c) => {
      const dailyKey = `${c.id}|${since}|${until}|daily|v2`;
      const aggKey = `${c.id}|${since}|${until}|agg|v2`;
      const hitDaily = cache.get(dailyKey);
      const hitAgg = cache.get(aggKey);

      let rows: any[] | null = null;
      if (hitDaily && hitDaily.exp > Date.now()) rows = hitDaily.v;
      else {
        const ir = await fbGet(`${c.id}/insights`, token, {
          fields: "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking",
          time_range: JSON.stringify({ since, until }),
          level: "campaign",
          time_increment: "1",
        });
        if (ir.ok) { rows = ir.body?.data ?? []; cache.set(dailyKey, { v: rows, exp: Date.now() + TTL }); }
      }

      // Linha agregada (sem time_increment) para reach/frequency reais do período.
      let aggRow: any = null;
      if (hitAgg && hitAgg.exp > Date.now()) aggRow = hitAgg.v;
      else {
        const ar = await fbGet(`${c.id}/insights`, token, {
          fields: "reach,frequency,impressions,spend,quality_ranking,engagement_rate_ranking,conversion_rate_ranking",
          time_range: JSON.stringify({ since, until }),
          level: "campaign",
        });
        if (ar.ok) { aggRow = ar.body?.data?.[0] ?? null; cache.set(aggKey, { v: aggRow, exp: Date.now() + TTL }); }
      }

      const agg = {
        spend: 0, impressions: 0, clicks: 0,
        leads: 0, purchases: 0, purchase_value: 0, messaging: 0, link_clicks: 0,
        video_p25: 0, video_thruplay: 0,
      };
      const daily: Array<{ date: string; spend: number; leads: number; clicks: number; impressions: number }> = [];
      for (const row of rows ?? []) {
        let dLeads = 0, dPurch = 0, dPurchVal = 0, dMsg = 0, dLinkClicks = 0;
        for (const a of row?.actions ?? []) {
          if (["lead", "leadgen.other", "onsite_conversion.lead_grouped"].includes(a.action_type)) dLeads += +a.value || 0;
          if (["purchase", "offsite_conversion.fb_pixel_purchase"].includes(a.action_type)) dPurch += +a.value || 0;
          if ([
            "onsite_conversion.messaging_conversation_started_7d",
            "onsite_conversion.total_messaging_connection",
          ].includes(a.action_type)) dMsg += +a.value || 0;
          if (a.action_type === "link_click") dLinkClicks += +a.value || 0;
        }
        for (const a of row?.action_values ?? []) {
          if (["purchase", "offsite_conversion.fb_pixel_purchase"].includes(a.action_type)) dPurchVal += +a.value || 0;
        }
        const dSpend = +row?.spend || 0;
        const dImpr = +row?.impressions || 0;
        const dClicks = +row?.clicks || 0;
        agg.spend += dSpend; agg.impressions += dImpr; agg.clicks += dClicks;
        agg.leads += dLeads; agg.purchases += dPurch; agg.purchase_value += dPurchVal;
        agg.messaging += dMsg; agg.link_clicks += dLinkClicks;

        const p25 = Number(row?.video_p25_watched_actions?.[0]?.value ?? 0);
        const thruplay = Number(row?.video_thruplay_watched_actions?.[0]?.value ?? 0);
        agg.video_p25 += p25; agg.video_thruplay += thruplay;

        daily.push({ date: row?.date_start ?? "", spend: dSpend, leads: dLeads, clicks: dClicks, impressions: dImpr });
      }

      // Reach e frequency reais do período (dedup pela Meta).
      const reach = Number(aggRow?.reach ?? 0);
      const frequency = Number(aggRow?.frequency ?? (reach > 0 ? agg.impressions / reach : 0));
      const quality_ranking = aggRow?.quality_ranking ?? null;
      const engagement_ranking = aggRow?.engagement_rate_ranking ?? null;
      const conversion_ranking = aggRow?.conversion_rate_ranking ?? null;

      const spend = agg.spend;

      // Rótulo do "resultado" com base no objetivo — só cai em messaging se de fato houver mensagens.
      const obj = String(c.objective || "").toUpperCase();
      let result_kind: "messaging" | "leads" | "purchases" | "link_clicks" = "leads";
      if (obj.includes("MESSAG") || obj === "OUTCOME_ENGAGEMENT") {
        if (agg.messaging > 0) result_kind = "messaging";
        else if (agg.leads > 0) result_kind = "leads";
        else if (agg.link_clicks > 0) result_kind = "link_clicks";
        else result_kind = "messaging";
      }
      else if (obj.includes("LEAD")) result_kind = "leads";
      else if (obj.includes("SALES") || obj.includes("CONVERSION") || obj.includes("PURCHASE")) result_kind = "purchases";
      else if (obj.includes("TRAFFIC") || obj.includes("LINK_CLICK")) result_kind = "link_clicks";

      const result_map = {
        messaging: { value: agg.messaging, label: "Conversas" },
        leads: { value: agg.leads, label: "Leads" },
        purchases: { value: agg.purchases, label: "Compras" },
        link_clicks: { value: agg.link_clicks, label: "Cliques" },
      } as const;
      const result_value = result_map[result_kind].value;

      const hook_rate = agg.impressions > 0 ? (agg.video_p25 / agg.impressions) * 100 : 0;
      const hold_rate = agg.video_p25 > 0 ? (agg.video_thruplay / agg.video_p25) * 100 : 0;

      return {
        ...c,
        ad_account_id: acc.id,
        ad_account_label: acc.label,
        account_currency: meta.currency,
        account_timezone: meta.tz,
        insights: (rows && rows.length) ? {
          spend, impressions: agg.impressions, clicks: agg.clicks,
          reach, frequency,
          ctr: agg.impressions ? (agg.clicks / agg.impressions) * 100 : 0,
          cpc: agg.clicks ? spend / agg.clicks : 0,
          cpm: agg.impressions ? (spend / agg.impressions) * 1000 : 0,
          leads: agg.leads, cpl: agg.leads > 0 ? spend / agg.leads : 0,
          messaging: agg.messaging,
          link_clicks: agg.link_clicks,
          result_kind,
          result_label: result_map[result_kind].label,
          result_value,
          cost_per_result: result_value > 0 ? spend / result_value : 0,
          purchases: agg.purchases, purchase_value: agg.purchase_value,
          roas: spend > 0 ? agg.purchase_value / spend : 0,
          hook_rate, hold_rate,
          video_p25: agg.video_p25, video_thruplay: agg.video_thruplay,
          quality_ranking, engagement_ranking, conversion_ranking,
        } : null,
        daily,
        period: { since, until, timezone: meta.tz },
      };

    });
    all.push(...withIns);
  }

  // Detecta mistura de moeda para o front alertar (formatação por-conta é ideal, mas requer refator).
  const currencies = Array.from(new Set(accountMetaOut.map((a) => a.currency)));
  const timezones = Array.from(new Set(accountMetaOut.map((a) => a.timezone)));
  const period = accountMetaOut[0] ? { since: accountMetaOut[0].since, until: accountMetaOut[0].until, timezone: accountMetaOut[0].timezone } : null;

  return json({ ok: true, data: all, ad_accounts: accountMetaOut, currencies, timezones, period });
});
