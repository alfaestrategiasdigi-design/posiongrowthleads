// Recebe um short-lived USER access token (vindo do FB JS SDK no browser),
// troca por long-lived USER token usando app_id+app_secret guardados no banco,
// e devolve a lista de páginas que o usuário administra (com page_access_token
// já de longa duração — Page Tokens derivados de long-lived User Tokens não expiram).
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const tokenJwt = authHeader.replace("Bearer ", "");
  const { data: claims, error: authErr } = await userClient.auth.getClaims(tokenJwt);
  if (authErr || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roleOk } = await admin.rpc("has_role", {
    _user_id: claims.claims.sub, _role: "admin",
  });
  if (!roleOk) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any;
  try { body = await req.json(); }
  catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const shortToken = String(body?.short_lived_token ?? "").trim();
  if (!shortToken) {
    return new Response(JSON.stringify({ error: "short_lived_token obrigatório" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: cfg } = await admin
    .from("facebook_webhook_config").select("id,app_id,app_secret").limit(1).maybeSingle();

  if (!cfg?.app_id || !cfg?.app_secret) {
    return new Response(JSON.stringify({
      error: "Salve primeiro o App ID e o App Secret do seu app Meta nos campos acima.",
    }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    // 1) Troca por long-lived USER token (~60 dias)
    const exchUrl = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
    exchUrl.searchParams.set("grant_type", "fb_exchange_token");
    exchUrl.searchParams.set("client_id", cfg.app_id);
    exchUrl.searchParams.set("client_secret", cfg.app_secret);
    exchUrl.searchParams.set("fb_exchange_token", shortToken);
    const exchRes = await fetch(exchUrl);
    const exchJson = await exchRes.json();
    if (!exchRes.ok) {
      throw new Error(exchJson?.error?.message ?? `HTTP ${exchRes.status}`);
    }
    const longUserToken: string = exchJson.access_token;
    const userTokenExpiresIn: number = exchJson.expires_in ?? 60 * 24 * 3600;
    const userTokenExpiresAt = new Date(Date.now() + Number(userTokenExpiresIn) * 1000).toISOString();

    // 2) Lista páginas administradas com seus page_access_tokens (que já vêm de longa duração)
    const pagesUrl = new URL("https://graph.facebook.com/v21.0/me/accounts");
    pagesUrl.searchParams.set("fields", "id,name,access_token,category,tasks");
    pagesUrl.searchParams.set("limit", "100");
    pagesUrl.searchParams.set("access_token", longUserToken);
    const pagesRes = await fetch(pagesUrl);
    const pagesJson = await pagesRes.json();
    if (!pagesRes.ok) {
      throw new Error(pagesJson?.error?.message ?? `HTTP ${pagesRes.status}`);
    }

    const pages = (pagesJson.data ?? []).map((p: any) => ({
      id: p.id,
      name: p.name,
      access_token: p.access_token,
      category: p.category ?? null,
      tasks: p.tasks ?? [],
    }));

    const normalizeAdAccount = (account: any) => {
      const id = account?.id ? String(account.id).trim() : null;
      let account_id = account?.account_id ? String(account.account_id).trim() : id;
      if (account_id && !account_id.startsWith("act_")) account_id = `act_${account_id}`;
      return id || account_id ? {
        id: id ?? account_id,
        account_id: account_id ?? id,
        name: account?.name ?? null,
      } : null;
    };

    const uniqueAccounts = (accounts: Array<{ id: string; account_id: string; name: string | null }>) => {
      const seen = new Set<string>();
      return accounts.filter((account) => {
        const key = account.account_id || account.id;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };

    let adAccounts: Array<{ id: string; account_id: string; name: string | null }> = [];

    const fetchAccountList = async (url: URL) => {
      const res = await fetch(url);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      return Array.isArray(json.data) ? json.data : [];
    };

    try {
      const adUrl = new URL("https://graph.facebook.com/v21.0/me/adaccounts");
      adUrl.searchParams.set("fields", "id,account_id,name");
      adUrl.searchParams.set("limit", "200");
      adUrl.searchParams.set("access_token", longUserToken);
      const directAccounts = await fetchAccountList(adUrl);
      adAccounts.push(...directAccounts.map((a: any) => normalizeAdAccount(a)).filter(Boolean) as any[]);
    } catch (e: any) {
      console.error("[oauth-exchange] failed to list direct ad accounts:", e?.message ?? e);
    }

    try {
      const businessesUrl = new URL("https://graph.facebook.com/v21.0/me/businesses");
      businessesUrl.searchParams.set("fields", "id,name");
      businessesUrl.searchParams.set("limit", "50");
      businessesUrl.searchParams.set("access_token", longUserToken);
      const businessesJson = await fetch(businessesUrl).then((r) => r.json());
      if (Array.isArray(businessesJson.data)) {
        for (const biz of businessesJson.data) {
          try {
            const ownedUrl = new URL(`https://graph.facebook.com/v21.0/${biz.id}/owned_ad_accounts`);
            ownedUrl.searchParams.set("fields", "id,account_id,name");
            ownedUrl.searchParams.set("limit", "200");
            ownedUrl.searchParams.set("access_token", longUserToken);
            const ownedAccounts = await fetchAccountList(ownedUrl);
            adAccounts.push(...ownedAccounts.map((a: any) => normalizeAdAccount(a)).filter(Boolean) as any[]);
          } catch (e: any) {
            console.error(`[oauth-exchange] failed to list owned_ad_accounts for business ${biz.id}:`, e?.message ?? e);
          }
          try {
            const clientUrl = new URL(`https://graph.facebook.com/v21.0/${biz.id}/client_ad_accounts`);
            clientUrl.searchParams.set("fields", "id,account_id,name");
            clientUrl.searchParams.set("limit", "200");
            clientUrl.searchParams.set("access_token", longUserToken);
            const clientAccounts = await fetchAccountList(clientUrl);
            adAccounts.push(...clientAccounts.map((a: any) => normalizeAdAccount(a)).filter(Boolean) as any[]);
          } catch (e: any) {
            console.error(`[oauth-exchange] failed to list client_ad_accounts for business ${biz.id}:`, e?.message ?? e);
          }
        }
      }
    } catch (e: any) {
      console.error("[oauth-exchange] failed to list businesses:", e?.message ?? e);
    }

    adAccounts = uniqueAccounts(adAccounts).map((account) => ({
      id: account.id,
      account_id: account.account_id.startsWith("act_") ? account.account_id : account.account_id,
      name: account.name,
    }));

    return new Response(JSON.stringify({
      ok: true,
      long_user_token_expires_in: userTokenExpiresIn,
      long_user_token_expires_at: userTokenExpiresAt,
      long_lived_user_token: longUserToken,
      pages,
      ad_accounts: adAccounts,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
