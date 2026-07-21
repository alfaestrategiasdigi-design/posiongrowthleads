// Detalhe de uma campanha Meta: adsets, ads, creatives com preview e insights.
// Auth: membro do tenant OU admin.
// Body: { tenant_id: uuid, campaign_id: string, since?: 'YYYY-MM-DD', until?: 'YYYY-MM-DD' }
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
const TTL = 5 * 60_000;

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

function extractInsights(row: any) {
  const spend = +row?.spend || 0;
  const impressions = +row?.impressions || 0;
  const clicks = +row?.clicks || 0;
  let leads = 0, purchases = 0, purchase_value = 0, link_clicks = 0, messaging = 0;
  for (const a of row?.actions ?? []) {
    if (["lead", "leadgen.other", "onsite_conversion.lead_grouped"].includes(a.action_type)) leads += +a.value || 0;
    if (["purchase", "offsite_conversion.fb_pixel_purchase"].includes(a.action_type)) purchases += +a.value || 0;
    if (a.action_type === "link_click") link_clicks += +a.value || 0;
    if (["onsite_conversion.messaging_conversation_started_7d","onsite_conversion.total_messaging_connection"].includes(a.action_type)) messaging += +a.value || 0;
  }
  for (const a of row?.action_values ?? []) {
    if (["purchase", "offsite_conversion.fb_pixel_purchase"].includes(a.action_type)) purchase_value += +a.value || 0;
  }
  const p25 = Number(row?.video_p25_watched_actions?.[0]?.value ?? 0);
  const thruplay = Number(row?.video_thruplay_watched_actions?.[0]?.value ?? 0);
  return {
    spend, impressions, clicks, link_clicks, leads, purchases, purchase_value, messaging,
    reach: +row?.reach || 0, frequency: +row?.frequency || 0,
    ctr: impressions ? (clicks / impressions) * 100 : 0,
    cpc: clicks ? spend / clicks : 0,
    cpm: impressions ? (spend / impressions) * 1000 : 0,
    cpl: leads ? spend / leads : 0,
    video_p25: p25, video_thruplay: thruplay,
    hook_rate: impressions ? (p25 / impressions) * 100 : 0,
    hold_rate: p25 ? (thruplay / p25) * 100 : 0,
    quality_ranking: row?.quality_ranking ?? null,
    engagement_rate_ranking: row?.engagement_rate_ranking ?? null,
    conversion_rate_ranking: row?.conversion_rate_ranking ?? null,
  };
}

const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";
const onlyDigits = (value: unknown) => String(value ?? "").replace(/\D/g, "");
const samePhone = (a: unknown, b: unknown) => {
  const pa = onlyDigits(a);
  const pb = onlyDigits(b);
  if (!pa || !pb) return false;
  return pa === pb || pa === `55${pb}` || `55${pa}` === pb || pa.slice(-8) === pb.slice(-8);
};
const normalizeCampaignText = (value: unknown) => String(value ?? "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

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
  const campaignId = String(body.campaign_id ?? "");
  if (!tenantId || !campaignId) return json({ error: "tenant_id e campaign_id obrigatórios" }, 400);

  const { data: hasAccess } = await admin.rpc("has_tenant_access", { _user_id: uid, _tenant_id: tenantId });
  if (!hasAccess) return json({ error: "Forbidden" }, 403);

  const { data: cfg } = await admin
    .from("facebook_webhook_config")
    .select("user_access_token").limit(1).maybeSingle();
  const token = String(cfg?.user_access_token ?? "").trim();
  if (!token) return json({ ok: false, error: "Token do Facebook indisponível.", need_reconnect: true }, 200);

  // Descobre timezone da conta a partir do próprio campaign (account_id) para alinhar since/until.
  const campMeta = await fbGet(campaignId, token, { fields: "account_id" });
  const actId = campMeta.ok && campMeta.body?.account_id ? `act_${String(campMeta.body.account_id).replace(/^act_/, "")}` : null;
  let tz = "America/Sao_Paulo";
  if (actId) {
    const accRes = await fbGet(actId, token, { fields: "timezone_name" });
    if (accRes.ok && accRes.body?.timezone_name) tz = String(accRes.body.timezone_name);
  }
  const dateInTz = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
    return `${g("year")}-${g("month")}-${g("day")}`;
  };
  const days = Number.isFinite(Number(body.days)) ? Math.max(1, Math.min(365, Number(body.days))) : null;
  let since: string;
  let until: string;
  if (typeof body.since === "string" && typeof body.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.since) && /^\d{4}-\d{2}-\d{2}$/.test(body.until)) {
    since = body.since; until = body.until;
  } else {
    const d = days ?? 30;
    until = dateInTz(new Date());
    if (d <= 1) since = until;
    else {
      const [y, m, dd] = until.split("-").map(Number);
      const base = new Date(Date.UTC(y, m - 1, dd));
      base.setUTCDate(base.getUTCDate() - (d - 1));
      since = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
    }
  }

  const cacheKey = `${campaignId}|${since}|${until}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return json(hit.v);

  // 1) Campaign meta
  const camp = await fbGet(campaignId, token, {
    fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,account_id",
  });
  if (!camp.ok) return json({ ok: false, error: "Falha ao carregar campanha", detail: camp.body }, 502);

  // 2) AdSets
  const adsetsRes = await fbGet(`${campaignId}/adsets`, token, {
    fields: "id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,targeting",
    limit: "50",
  });
  const adsets: any[] = adsetsRes.ok ? (adsetsRes.body?.data ?? []) : [];

  // 3) Ads by adset (paralelo, limite 3)
  const adsByAdset: Record<string, any[]> = {};
  await mapLimit(adsets, 3, async (as) => {
    const r = await fbGet(`${as.id}/ads`, token, {
      fields: "id,name,status,effective_status,creative{id,name,image_url,thumbnail_url,object_story_spec,body,title,call_to_action_type,instagram_permalink_url,effective_object_story_id,video_id}",
      limit: "50",
    });
    adsByAdset[as.id] = r.ok ? (r.body?.data ?? []) : [];
  });

  const allAds = Object.values(adsByAdset).flat();

  // 4) Insights por ad (batched)
  const insightsByAd: Record<string, any> = {};
  await mapLimit(allAds, 3, async (ad: any) => {
    const ir = await fbGet(`${ad.id}/insights`, token, {
      fields: "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions,video_thruplay_watched_actions,quality_ranking,engagement_rate_ranking,conversion_rate_ranking",
      time_range: JSON.stringify({ since, until }),
      level: "ad",
    });
    const row = ir.ok ? (ir.body?.data?.[0] ?? null) : null;
    insightsByAd[ad.id] = row ? extractInsights(row) : null;
  });

  // 5) Insights por adset (agregar dos ads)
  const insightsByAdset: Record<string, any> = {};
  for (const as of adsets) {
    const ads = adsByAdset[as.id] ?? [];
    const agg: any = { spend: 0, impressions: 0, clicks: 0, leads: 0, purchases: 0, purchase_value: 0, reach: 0, frequency: 0, cpl: 0, ctr: 0, cpm: 0 };
    let n = 0;
    for (const ad of ads) {
      const i = insightsByAd[ad.id];
      if (!i) continue;
      agg.spend += i.spend; agg.impressions += i.impressions; agg.clicks += i.clicks;
      agg.leads += i.leads; agg.purchases += i.purchases; agg.purchase_value += i.purchase_value;
      agg.reach += i.reach; agg.frequency = Math.max(agg.frequency, i.frequency);
      n++;
    }
    agg.ctr = agg.impressions ? (agg.clicks / agg.impressions) * 100 : 0;
    agg.cpm = agg.impressions ? (agg.spend / agg.impressions) * 1000 : 0;
    agg.cpl = agg.leads ? agg.spend / agg.leads : 0;
    insightsByAdset[as.id] = agg;
  }

  // 6) Preview HTML por ad (opcional; leve — só mobile feed)
  const previewsByAd: Record<string, string | null> = {};
  await mapLimit(allAds, 4, async (ad: any) => {
    const pr = await fbGet(`${ad.id}/previews`, token, { ad_format: "MOBILE_FEED_STANDARD" });
    previewsByAd[ad.id] = pr.ok ? (pr.body?.data?.[0]?.body ?? null) : null;
  });

  // 7) Leads atribuídos (por facebook_campaign_id, facebook_campaign, manual ou nome).
  // No Posion Master os leads da conta Alfa Reserva entram sem tenant_id, então não podem
  // ser filtrados por tenant_id = master.
  const campName = camp.body?.name ?? "";
  let leadsQuery = admin
    .from("leads")
    .select("id,nome_completo,whatsapp,email,status,valor_proposta,created_at,facebook_form_name,facebook_ad_name,facebook_adset_name,facebook_ad_id,facebook_adset_id,facebook_campaign_id,facebook_campaign,utm_campaign,campaign_id_manual")
    .or([
      `facebook_campaign_id.eq.${campaignId}`,
      `facebook_campaign.eq.${campaignId}`,
      `campaign_id_manual.eq.${campaignId}`,
    ].filter(Boolean).join(","))
    .order("created_at", { ascending: false })
    .limit(500);
  leadsQuery = tenantId === MASTER_TENANT_ID ? leadsQuery.is("tenant_id", null) : leadsQuery.eq("tenant_id", tenantId);
  const { data: directLeads } = await leadsQuery;

  let leads = directLeads ?? [];
  if (campName) {
    let nameQuery = admin
      .from("leads")
      .select("id,nome_completo,whatsapp,email,status,valor_proposta,created_at,facebook_form_name,facebook_ad_name,facebook_adset_name,facebook_ad_id,facebook_adset_id,facebook_campaign_id,facebook_campaign,utm_campaign,campaign_id_manual")
      .gte("created_at", `${since}T00:00:00`)
      .lte("created_at", `${until}T23:59:59`)
      .order("created_at", { ascending: false })
      .limit(1000);
    nameQuery = tenantId === MASTER_TENANT_ID ? nameQuery.is("tenant_id", null) : nameQuery.eq("tenant_id", tenantId);
    const { data: tenantPeriodLeads } = await nameQuery;
    const campNorm = normalizeCampaignText(campName);
    const fuzzy = (tenantPeriodLeads ?? []).filter((l: any) => {
      const fb = normalizeCampaignText(l.facebook_campaign);
      const utm = normalizeCampaignText(l.utm_campaign);
      return (fb && (fb === campNorm || fb.startsWith(campNorm) || campNorm.startsWith(fb))) ||
        (utm && (utm === campNorm || utm.startsWith(campNorm) || campNorm.startsWith(utm)));
    });
    const byId = new Map<string, any>();
    [...leads, ...fuzzy].forEach((l: any) => byId.set(l.id, l));
    leads = Array.from(byId.values()).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  // 8) Appointments dos leads
  const leadIds = leads.map((l: any) => l.id);
  let appts: any[] = [];
  if (tenantId === MASTER_TENANT_ID) {
    const { data: rows } = await admin
      .from("appointments")
      .select("id,lead_id,client_phone,status,date_time,tenant_id")
      .is("tenant_id", null)
      .gte("date_time", `${since}T00:00:00`)
      .lte("date_time", `${until}T23:59:59`)
      .limit(500);
    appts = (rows ?? []).filter((a: any) =>
      (a.lead_id && leadIds.includes(a.lead_id)) || (leads ?? []).some((l: any) => samePhone(l.whatsapp, a.client_phone))
    );
  } else if (leadIds.length) {
    const { data: rows } = await admin
      .from("appointments")
      .select("id,lead_id,client_phone,status,date_time,tenant_id")
      .in("lead_id", leadIds);
    appts = rows ?? [];
  }

  const result = {
    ok: true,
    campaign: camp.body,
    adsets: adsets.map((as: any) => ({
      ...as,
      ads: adsByAdset[as.id] ?? [],
      insights: insightsByAdset[as.id],
    })),
    ads: allAds.map((ad: any) => ({
      ...ad,
      insights: insightsByAd[ad.id],
      preview_html: previewsByAd[ad.id],
    })),
    leads: leads ?? [],
    appointments: appts,
    period: { since, until },
  };
  cache.set(cacheKey, { v: result, exp: Date.now() + TTL });
  return json(result);
});
