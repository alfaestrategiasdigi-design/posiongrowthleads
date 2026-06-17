// Sincroniza campanhas e insights do Facebook Ads (Marketing API) -> tabela campaign_spend.
// POST body: { days?: number (default 30) }. Admin only.
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (!claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: roleOk } = await admin.rpc("has_role", { _user_id: claims.claims.sub, _role: "admin" });
  if (!roleOk) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* no body */ }
  const days = Math.max(1, Math.min(90, Number(body.days ?? 30)));
  const checkOnly = body.check_permissions === true;

  const { data: cfg } = await admin
    .from("facebook_webhook_config")
    .select("page_access_token, user_access_token, ad_account_id, default_tenant_id")
    .limit(1).maybeSingle();

  const token = cfg?.user_access_token || cfg?.page_access_token || FB_TOKEN_ENV;
  if (!token) {
    return new Response(JSON.stringify({ error: "Token Facebook ausente. Reconecte com escopo ads_read." }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Verifica permissões do token primeiro
  const permsRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(token)}`);
  const permsJson = await permsRes.json();
  const granted: string[] = Array.isArray(permsJson?.data)
    ? permsJson.data.filter((p: any) => p.status === "granted").map((p: any) => p.permission)
    : [];
  const required = ["ads_read"];
  const missing = required.filter(r => !granted.includes(r));

  if (checkOnly) {
    return new Response(JSON.stringify({
      ok: missing.length === 0,
      granted, missing,
      ad_account_id: cfg?.ad_account_id ?? null,
      last_campaigns_sync_at: null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (missing.length > 0) {
    return new Response(JSON.stringify({
      error: `Permissões da Marketing API ausentes: ${missing.join(", ")}. Reconecte sua conta do Facebook e marque essas permissões.`,
      missing, granted, need_reconnect: true,
    }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let adAccountId = cfg?.ad_account_id?.trim();
  if (!adAccountId) {
    return new Response(JSON.stringify({ error: "Ad Account ID não configurado." }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!adAccountId.startsWith("act_")) adAccountId = `act_${adAccountId}`;
  const tenantId: string | null = cfg?.default_tenant_id ?? null;

  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);

  // 1) lista campanhas
  const campUrl = new URL(`https://graph.facebook.com/v21.0/${adAccountId}/campaigns`);
  campUrl.searchParams.set("fields", "id,name,status,objective");
  campUrl.searchParams.set("limit", "200");
  campUrl.searchParams.set("access_token", token);
  const campRes = await fetch(campUrl);
  const campJson = await campRes.json();
  if (!campRes.ok) {
    console.error("[campaigns-sync] err listing campaigns", campJson);
    return new Response(JSON.stringify({ error: "Falha listando campanhas", detail: campJson }), {
      status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const campaigns: any[] = campJson.data ?? [];

  const results: any[] = [];
  for (const c of campaigns) {
    // 2) insights por campanha (agregado no período)
    const insUrl = new URL(`https://graph.facebook.com/v21.0/${c.id}/insights`);
    insUrl.searchParams.set("fields", "spend,impressions,clicks,actions");
    insUrl.searchParams.set("time_range", JSON.stringify({ since, until }));
    insUrl.searchParams.set("access_token", token);
    const insRes = await fetch(insUrl);
    const insJson = await insRes.json();
    if (!insRes.ok) {
      results.push({ id: c.id, name: c.name, error: insJson?.error?.message ?? `HTTP ${insRes.status}` });
      continue;
    }
    const row = insJson.data?.[0];
    const spend = Number(row?.spend ?? 0);
    const impressions = Number(row?.impressions ?? 0);
    const clicks = Number(row?.clicks ?? 0);
    let leads = 0;
    if (Array.isArray(row?.actions)) {
      for (const a of row.actions) {
        if (a.action_type === "lead" || a.action_type === "onsite_conversion.lead_grouped") {
          leads += Number(a.value || 0);
        }
      }
    }

    // upsert por (tenant_id, channel, campaign_id, period_start)
    const payload = {
      tenant_id: tenantId,
      period_start: since,
      period_end: until,
      channel: "meta_ads",
      campaign_id: c.id,
      campaign_name: c.name,
      amount_spent: spend,
      impressions,
      clicks,
      leads_generated: leads,
      notes: `auto · ${c.status ?? ""} · ${c.objective ?? ""}`.trim(),
    };

    // Tenta update primeiro (chave: tenant_id+channel+campaign_id+period_start)
    let q = admin.from("campaign_spend")
      .update(payload)
      .eq("channel", "meta_ads")
      .eq("campaign_id", c.id)
      .eq("period_start", since);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    else q = q.is("tenant_id", null);
    const upd = await q.select("id");
    if (upd.error) {
      results.push({ id: c.id, name: c.name, error: upd.error.message });
      continue;
    }
    if (!upd.data || upd.data.length === 0) {
      const ins = await admin.from("campaign_spend").insert(payload);
      if (ins.error) {
        results.push({ id: c.id, name: c.name, error: ins.error.message });
        continue;
      }
    }
    results.push({ id: c.id, name: c.name, spend, leads, impressions, clicks });
  }

  await admin.from("facebook_webhook_config")
    .update({ last_campaigns_sync_at: new Date().toISOString() })
    .not("id", "is", null);

  return new Response(JSON.stringify({
    ok: true,
    ad_account_id: adAccountId,
    period: { since, until },
    total_campaigns: campaigns.length,
    results,
  }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
