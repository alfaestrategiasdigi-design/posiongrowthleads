// Valida o FACEBOOK_PAGE_ACCESS_TOKEN e lista formulários de Lead Ads disponíveis.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const TOKEN = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") ?? "";

async function gget(path: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ access_token: TOKEN, ...extra });
  const res = await fetch(`https://graph.facebook.com/v21.0/${path}?${params}`);
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);
  return json;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // auth: exigir usuário logado (admin checagem opcional pode ser feita no client)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: claims, error: authErr } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (authErr || !claims?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // Only Admin Master can run the diagnostic (same check used by the other Facebook admin functions)
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: isAdmin } = await admin.rpc("has_role", {
    _user_id: (claims.claims as any).sub, _role: "admin",
  });
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!TOKEN) {
    return new Response(JSON.stringify({
      ok: false,
      error: "FACEBOOK_PAGE_ACCESS_TOKEN não configurado nos secrets.",
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    // 1) /me básico → confirma token (funciona com qualquer tipo)
    const meBasic = await gget("me", { fields: "id,name" });

    // 2) Tenta inferir se é Page Token (category/tasks) ou User Token
    let me = meBasic;
    let tokenType: "page" | "user" = "user";
    try {
      const meExtended = await gget("me", { fields: "id,name,category,tasks" });
      if (meExtended.category || Array.isArray(meExtended.tasks)) {
        tokenType = "page";
        me = meExtended;
      }
    } catch {
      tokenType = "user";
    }

    // 3) Tenta listar formulários
    let forms: any[] = [];
    let formsError: string | null = null;
    let pages: any[] = [];

    if (tokenType === "page") {
      try {
        const f = await gget(`${me.id}/leadgen_forms`, { fields: "id,name,status,created_time,leads_count", limit: "100" });
        forms = f.data ?? [];
      } catch (e: any) { formsError = e.message; }
    } else {
      // user token → lista páginas e tenta forms de cada
      try {
        const acc = await gget("me/accounts", { fields: "id,name,access_token,tasks", limit: "50" });
        pages = (acc.data ?? []).map((p: any) => ({ id: p.id, name: p.name, tasks: p.tasks }));
        for (const p of acc.data ?? []) {
          try {
            const url = new URL(`https://graph.facebook.com/v21.0/${p.id}/leadgen_forms`);
            url.searchParams.set("access_token", p.access_token);
            url.searchParams.set("fields", "id,name,status,created_time,leads_count");
            url.searchParams.set("limit", "100");
            const r = await fetch(url);
            const j = await r.json();
            if (r.ok && Array.isArray(j.data)) {
              for (const form of j.data) forms.push({ ...form, page_id: p.id, page_name: p.name });
            }
          } catch {}
        }
      } catch (e: any) { formsError = e.message; }
    }

    return new Response(JSON.stringify({
      ok: true,
      tokenType,
      me: { id: me.id, name: me.name, category: me.category ?? null },
      pages,
      forms,
      formsError,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
