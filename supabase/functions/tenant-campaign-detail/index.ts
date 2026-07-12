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

  const since = String(body.since ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const until = String(body.until ?? new Date().toISOString().slice(0, 10));

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

  // 7) Leads atribuídos (por facebook_campaign_id ou nome, no tenant)
  const campName = camp.body?.name ?? "";
  const { data: leads } = await admin
    .from("leads")
    .select("id,nome_completo,whatsapp,email,status,valor_proposta,created_at,facebook_form_name,facebook_ad_name,facebook_adset_name,facebook_ad_id,facebook_adset_id,facebook_campaign_id,facebook_campaign,utm_campaign")
    .eq("tenant_id", tenantId)
    .or([
      `facebook_campaign_id.eq.${campaignId}`,
      campName ? `facebook_campaign.ilike.${campName}` : "",
      campName ? `utm_campaign.ilike.${campName}` : "",
    ].filter(Boolean).join(","))
    .order("created_at", { ascending: false })
    .limit(500);

  // 8) Appointments dos leads
  const leadIds = (leads ?? []).map((l: any) => l.id);
  const { data: appts } = leadIds.length ? await admin
    .from("appointments")
    .select("id,lead_id,status,date_time")
    .in("lead_id", leadIds) : { data: [] as any[] };

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
    appointments: appts ?? [],
    period: { since, until },
  };
  cache.set(cacheKey, { v: result, exp: Date.now() + TTL });
  return json(result);
});
