// Gerenciador da Marketing API: listar/pausar/reativar/criar campanhas, adsets e ads.
// POST body: { action, ...params }
// Actions: list_campaigns, list_adsets, list_ads, set_status, update_budget, create_campaign, insights
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
const GRAPH = "https://graph.facebook.com/v21.0";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fbGet(path: string, token: string, params: Record<string, string> = {}) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const r = await fetch(url);
  const j = await r.json();
  return { ok: r.ok, status: r.status, body: j };
}
async function fbPost(path: string, token: string, body: Record<string, any>) {
  const r = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: token }),
  });
  const j = await r.json();
  return { ok: r.ok, status: r.status, body: j };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } },
  });
  const { data: claims } = await userClient.auth.getClaims(auth.replace("Bearer ", ""));
  if (!claims?.claims) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roleOk } = await admin.rpc("has_role", { _user_id: claims.claims.sub, _role: "admin" });
  if (!roleOk) return json({ error: "Forbidden" }, 403);

  let payload: any = {};
  try { payload = await req.json(); } catch { return json({ error: "Body inválido" }, 400); }
  const action = String(payload.action ?? "");
  if (!action) return json({ error: "action é obrigatório" }, 400);

  const { data: cfg } = await admin
    .from("facebook_webhook_config")
    .select("page_access_token, user_access_token, ad_account_id")
    .limit(1).maybeSingle();

  // Marketing API (ad accounts, campaigns, insights) requires a USER token with ads_read/ads_management.
  // Page tokens/env fallback cannot list /me/adaccounts or read ads data, so missing user token is a
  // normal reconnect state for the UI — never a 4xx runtime error.
  const token = String(cfg?.user_access_token ?? "").trim();
  if (!token) {
    return json({
      ok: false,
      error: "Token de USUÁRIO do Facebook ausente. Reconecte sua conta concedendo as permissões ads_read e ads_management para acessar a Marketing API.",
      need_reconnect: true,
      reconnect_reason: "missing_user_access_token",
    }, 200);
  }

  // Allow the caller to override the saved ad_account_id (so the admin can browse any accessible account).
  let adAccount = String(payload.ad_account_id ?? cfg?.ad_account_id ?? "").trim();
  if (adAccount && !adAccount.startsWith("act_")) adAccount = `act_${adAccount}`;


  try {
    switch (action) {
      case "list_ad_accounts": {
        const r = await fbGet(`me/adaccounts`, token, {
          fields: "account_id,id,name,account_status,currency,business_name,timezone_name",
          limit: "200",
        });
        if (!r.ok) return json({ error: r.body?.error?.message ?? "Erro", raw: r.body }, 502);
        return json({ ok: true, data: r.body.data ?? [] });
      }
      case "list_campaigns": {
        if (!adAccount) return json({ error: "Ad Account não configurado" }, 400);
        const r = await fbGet(`${adAccount}/campaigns`, token, {
          fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time",
          limit: "200",
        });
        if (!r.ok) return json({ error: r.body?.error?.message ?? "Erro", raw: r.body }, 502);
        const campaigns: any[] = r.body.data ?? [];

        // Optional: enrich each campaign with aggregated insights for the window.
        if (payload.with_insights && campaigns.length) {
          const since = String(payload.since ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
          const until = String(payload.until ?? new Date().toISOString().slice(0, 10));
          const fields = "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,cost_per_action_type";
          const results = await Promise.all(campaigns.map(async (c) => {
            const ir = await fbGet(`${c.id}/insights`, token, {
              fields, time_range: JSON.stringify({ since, until }), level: "campaign",
            });
            const row = ir.ok ? (ir.body.data?.[0] ?? null) : null;
            let leads = 0, purchases = 0, purchase_value = 0;
            for (const a of row?.actions ?? []) {
              if (a.action_type === "lead" || a.action_type === "leadgen.other" || a.action_type === "onsite_conversion.lead_grouped") {
                leads += Number(a.value || 0);
              }
              if (a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase") {
                purchases += Number(a.value || 0);
              }
            }
            for (const a of row?.action_values ?? []) {
              if (a.action_type === "purchase" || a.action_type === "offsite_conversion.fb_pixel_purchase") {
                purchase_value += Number(a.value || 0);
              }
            }
            const spend = Number(row?.spend || 0);
            return {
              ...c,
              insights: row ? {
                spend, impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0),
                ctr: Number(row.ctr || 0), cpc: Number(row.cpc || 0), cpm: Number(row.cpm || 0),
                reach: Number(row.reach || 0), frequency: Number(row.frequency || 0),
                leads, cpl: leads > 0 ? spend / leads : 0,
                purchases, purchase_value, roas: spend > 0 ? purchase_value / spend : 0,
              } : null,
            };
          }));
          return json({ ok: true, data: results, ad_account_id: adAccount, since, until });
        }
        return json({ ok: true, data: campaigns, ad_account_id: adAccount });
      }

      case "list_adsets": {
        const campaignId = String(payload.campaign_id ?? "");
        if (!campaignId) return json({ error: "campaign_id obrigatório" }, 400);
        const r = await fbGet(`${campaignId}/adsets`, token, {
          fields: "id,name,status,effective_status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_amount",
          limit: "200",
        });
        if (!r.ok) return json({ error: r.body?.error?.message ?? "Erro", raw: r.body }, 502);
        return json({ ok: true, data: r.body.data ?? [] });
      }
      case "list_ads": {
        const parentId = String(payload.adset_id ?? payload.campaign_id ?? "");
        if (!parentId) return json({ error: "adset_id ou campaign_id obrigatório" }, 400);
        const edge = payload.adset_id ? `${parentId}/ads` : `${parentId}/ads`;
        const r = await fbGet(edge, token, {
          fields: "id,name,status,effective_status,adset_id,campaign_id,creative",
          limit: "200",
        });
        if (!r.ok) return json({ error: r.body?.error?.message ?? "Erro", raw: r.body }, 502);
        return json({ ok: true, data: r.body.data ?? [] });
      }
      case "set_status": {
        // params: object_id, status (ACTIVE | PAUSED | ARCHIVED | DELETED)
        const id = String(payload.object_id ?? "");
        const status = String(payload.status ?? "").toUpperCase();
        const allowed = ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"];
        if (!id || !allowed.includes(status)) return json({ error: "object_id e status válidos obrigatórios" }, 400);
        const r = await fbPost(id, token, { status });
        if (!r.ok) return json({ error: r.body?.error?.message ?? "Erro", raw: r.body }, 502);
        return json({ ok: true, result: r.body });
      }
      case "update_budget": {
        // params: object_id, daily_budget? (cents BRL), lifetime_budget?
        const id = String(payload.object_id ?? "");
        if (!id) return json({ error: "object_id obrigatório" }, 400);
        const body: Record<string, any> = {};
        if (payload.daily_budget != null) body.daily_budget = String(Math.round(Number(payload.daily_budget) * 100));
        if (payload.lifetime_budget != null) body.lifetime_budget = String(Math.round(Number(payload.lifetime_budget) * 100));
        if (!Object.keys(body).length) return json({ error: "Informe daily_budget ou lifetime_budget (em reais)" }, 400);
        const r = await fbPost(id, token, body);
        if (!r.ok) return json({ error: r.body?.error?.message ?? "Erro", raw: r.body }, 502);
        return json({ ok: true, result: r.body });
      }
      case "create_campaign": {
        if (!adAccount) return json({ error: "Ad Account não configurado" }, 400);
        const name = String(payload.name ?? "").trim();
        const objective = String(payload.objective ?? "OUTCOME_LEADS");
        const status = String(payload.status ?? "PAUSED");
        if (!name) return json({ error: "name obrigatório" }, 400);
        const r = await fbPost(`${adAccount}/campaigns`, token, {
          name, objective, status,
          special_ad_categories: payload.special_ad_categories ?? [],
        });
        if (!r.ok) return json({ error: r.body?.error?.message ?? "Erro", raw: r.body }, 502);
        return json({ ok: true, result: r.body });
      }
      case "insights": {
        // params: object_id, since?, until?
        const id = String(payload.object_id ?? "");
        if (!id) return json({ error: "object_id obrigatório" }, 400);
        const since = String(payload.since ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
        const until = String(payload.until ?? new Date().toISOString().slice(0, 10));
        const r = await fbGet(`${id}/insights`, token, {
          fields: "spend,impressions,clicks,ctr,cpc,cpm,actions",
          time_range: JSON.stringify({ since, until }),
        });
        if (!r.ok) return json({ error: r.body?.error?.message ?? "Erro", raw: r.body }, 502);
        return json({ ok: true, data: r.body.data ?? [] });
      }
      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
