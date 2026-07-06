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

// Facebook rate-limit / transient codes that should NOT crash the client.
// 17 = User request limit, 4 = App request limit, 32 = Page-level rate limit,
// 613 = Custom-level rate limit, 80004 = Ads insights throttling.
function fbErr(body: any) {
  const code = Number(body?.error?.code ?? 0);
  const sub = Number(body?.error?.error_subcode ?? 0);
  const rateLimited = [17, 4, 32, 613, 80004].includes(code);
  return json({
    ok: false,
    error: body?.error?.message ?? body?.error?.error_user_msg ?? "Erro do Facebook",
    error_user_title: body?.error?.error_user_title,
    error_user_msg: body?.error?.error_user_msg,
    rate_limited: rateLimited,
    fallback: rateLimited,
    code, error_subcode: sub,
    raw: body,
  }, 200);
}

// Run async tasks with a small concurrency cap so we never hammer the Graph API.
async function mapLimit<T, R>(items: T[], limit: number, fn: (it: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// ===== Insights cache (short TTL, in-memory per worker) =====
// Avoids repeated Graph API calls when the UI refreshes within the TTL window.
// On rate-limit, serves stale value if available (stale-while-error).
const INSIGHTS_TTL_MS = Number(Deno.env.get("INSIGHTS_TTL_MS") ?? 180000); // 3 min
const insightsCache = new Map<string, { value: any; expiresAt: number; storedAt: number }>();

function cacheGet(key: string): { value: any; fresh: boolean } | null {
  const hit = insightsCache.get(key);
  if (!hit) return null;
  return { value: hit.value, fresh: Date.now() < hit.expiresAt };
}
function cacheSet(key: string, value: any) {
  if (insightsCache.size > 500) {
    const keys = [...insightsCache.entries()]
      .sort((a, b) => a[1].storedAt - b[1].storedAt)
      .slice(0, 50).map((e) => e[0]);
    for (const k of keys) insightsCache.delete(k);
  }
  insightsCache.set(key, { value, storedAt: Date.now(), expiresAt: Date.now() + INSIGHTS_TTL_MS });
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
    .select("page_access_token, user_access_token, ad_account_id, page_id")
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
        if (!r.ok) return fbErr(r.body);
        return json({ ok: true, data: r.body.data ?? [] });
      }
      case "list_campaigns": {
        if (!adAccount) return json({ error: "Ad Account não configurado" }, 400);
        const r = await fbGet(`${adAccount}/campaigns`, token, {
          fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time",
          limit: "200",
        });
        if (!r.ok) return fbErr(r.body);
        const campaigns: any[] = r.body.data ?? [];

        // Optional: enrich each campaign with aggregated insights for the window.
        if (payload.with_insights && campaigns.length) {
          const since = String(payload.since ?? new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
          const until = String(payload.until ?? new Date().toISOString().slice(0, 10));
          const fields = "spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,cost_per_action_type";
          let cacheStats = { hit: 0, miss: 0, stale: 0, error: 0 };
          const results = await mapLimit(campaigns, 3, async (c) => {
            const cacheKey = `c|${c.id}|${since}|${until}`;
            const cached = cacheGet(cacheKey);
            let row: any = null;
            let cacheStatus: "hit" | "miss" | "stale" | "error" = "miss";
            if (cached?.fresh) {
              row = cached.value; cacheStatus = "hit";
            } else {
              const ir = await fbGet(`${c.id}/insights`, token, {
                fields, time_range: JSON.stringify({ since, until }), level: "campaign",
              });
              if (ir.ok) {
                row = ir.body.data?.[0] ?? null;
                cacheSet(cacheKey, row);
                cacheStatus = "miss";
              } else if (cached) {
                row = cached.value; cacheStatus = "stale";
              } else {
                cacheStatus = "error";
              }
            }
            cacheStats[cacheStatus]++;
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
              cache: cacheStatus,
              insights: row ? {
                spend, impressions: Number(row.impressions || 0), clicks: Number(row.clicks || 0),
                ctr: Number(row.ctr || 0), cpc: Number(row.cpc || 0), cpm: Number(row.cpm || 0),
                reach: Number(row.reach || 0), frequency: Number(row.frequency || 0),
                leads, cpl: leads > 0 ? spend / leads : 0,
                purchases, purchase_value, roas: spend > 0 ? purchase_value / spend : 0,
              } : null,
            };
          });
          return json({ ok: true, data: results, ad_account_id: adAccount, since, until, cache_stats: cacheStats });
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
        if (!r.ok) return fbErr(r.body);
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
        if (!r.ok) return fbErr(r.body);
        return json({ ok: true, data: r.body.data ?? [] });
      }
      case "set_status": {
        // params: object_id, status (ACTIVE | PAUSED | ARCHIVED | DELETED)
        const id = String(payload.object_id ?? "");
        const status = String(payload.status ?? "").toUpperCase();
        const allowed = ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED"];
        if (!id || !allowed.includes(status)) return json({ error: "object_id e status válidos obrigatórios" }, 400);
        const r = await fbPost(id, token, { status });
        if (!r.ok) return fbErr(r.body);
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
        if (!r.ok) return fbErr(r.body);
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
        if (!r.ok) return fbErr(r.body);
        return json({ ok: true, result: r.body });
      }
      case "insights": {
        // params: object_id, since?, until?
        const id = String(payload.object_id ?? "");
        if (!id) return json({ error: "object_id obrigatório" }, 400);
        const since = String(payload.since ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10));
        const until = String(payload.until ?? new Date().toISOString().slice(0, 10));
        const cacheKey = `i|${id}|${since}|${until}`;
        const cached = cacheGet(cacheKey);
        if (cached?.fresh) {
          return json({ ok: true, data: cached.value ? [cached.value] : [], cache: "hit" });
        }
        const r = await fbGet(`${id}/insights`, token, {
          fields: "spend,impressions,clicks,ctr,cpc,cpm,actions",
          time_range: JSON.stringify({ since, until }),
        });
        if (!r.ok) {
          if (cached) return json({ ok: true, data: cached.value ? [cached.value] : [], cache: "stale" });
          return fbErr(r.body);
        }
        const row = r.body.data?.[0] ?? null;
        cacheSet(cacheKey, row);
        return json({ ok: true, data: r.body.data ?? [], cache: "miss" });
      }

      case "list_lead_forms": {
        // Agrega formulários de TODAS as Páginas acessíveis pelo user token:
        // /me/accounts + owned_pages/client_pages de cada Business Manager.
        const pagesMap = new Map<string, { id: string; name: string; access_token?: string }>();
        const errors: any[] = [];

        const meAcc = await fbGet(`me/accounts`, token, {
          fields: "id,name,access_token", limit: "200",
        });
        if (meAcc.ok) {
          for (const p of meAcc.body?.data ?? []) pagesMap.set(p.id, p);
        } else {
          errors.push({ page_id: "me/accounts", page_name: "Páginas pessoais (/me/accounts)", error: meAcc.body?.error?.message ?? "Erro Graph" });
        }

        const biz = await fbGet(`me/businesses`, token, { fields: "id,name", limit: "200" });
        if (!biz.ok) {
          errors.push({ page_id: "me/businesses", page_name: "Business Managers (/me/businesses)", error: biz.body?.error?.message ?? "Erro Graph" });
        } else {
          for (const b of biz.body?.data ?? []) {
            for (const edge of ["owned_pages", "client_pages"]) {
              const r = await fbGet(`${b.id}/${edge}`, token, {
                fields: "id,name,access_token", limit: "200",
              });
              if (r.ok) {
                for (const p of r.body?.data ?? []) if (!pagesMap.has(p.id)) pagesMap.set(p.id, p);
              } else {
                errors.push({
                  page_id: `${b.id}/${edge}`,
                  page_name: `BM ${b.name ?? b.id} · ${edge}`,
                  error: r.body?.error?.message ?? "Erro Graph",
                });
              }
            }
          }
        }

        // Fallback: página configurada (garante retro-compat)
        const cfgPageId = String(cfg?.page_id ?? "").trim();
        if (cfgPageId && !pagesMap.has(cfgPageId)) {
          pagesMap.set(cfgPageId, {
            id: cfgPageId,
            name: String(cfg?.connected_page_name ?? cfgPageId),
            access_token: String(cfg?.page_access_token ?? "").trim() || undefined,
          });
        }

        const pages = [...pagesMap.values()];
        if (pages.length === 0) {
          return json({
            ok: false,
            error: "Nenhuma Página acessível. Reconecte concedendo pages_show_list, leads_retrieval e business_management.",
            need_reconnect: true,
            errors,
          }, 200);
        }

        const forms: any[] = [];
        const pageSummary: any[] = [];

        await mapLimit(pages, 4, async (p) => {
          const pt = p.access_token || token;
          const r = await fbGet(`${p.id}/leadgen_forms`, pt, {
            fields: "id,name,status,leads_count,created_time", limit: "200",
          });
          if (!r.ok) {
            errors.push({ page_id: p.id, page_name: p.name || p.id, error: r.body?.error?.message ?? "Erro Graph" });
            pageSummary.push({ id: p.id, name: p.name || p.id, forms_count: 0, error: true });
            return;
          }
          const data = r.body?.data ?? [];
          const pageName = p.name || p.id;
          for (const f of data) forms.push({ ...f, page_id: p.id, page_name: pageName });
          pageSummary.push({ id: p.id, name: pageName, forms_count: data.length });
        });

        return json({ ok: true, data: forms, pages: pageSummary, errors });
      }


      default:
        return json({ error: `Ação desconhecida: ${action}` }, 400);
    }
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
});
