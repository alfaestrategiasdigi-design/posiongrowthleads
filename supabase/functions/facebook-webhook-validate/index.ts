// Valida ponta-a-ponta a configuração do webhook do Facebook Lead Ads.
// Roda 6 passos e devolve um array de { id, label, ok, message }.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PROJECT_REF = new URL(SUPABASE_URL).host.split(".")[0];
const WEBHOOK_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/facebook-leads-webhook`;

type Step = { id: string; label: string; ok: boolean; level: "ok" | "error" | "warn"; message: string; detail?: any };

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

  const steps: Step[] = [];

  const { data: cfg } = await admin
    .from("facebook_webhook_config").select("*").limit(1).maybeSingle();

  // 1. Verify Token
  if (cfg?.verify_token && cfg.verify_token.length >= 12) {
    steps.push({ id: "verify_token", label: "Verify Token salvo", ok: true, level: "ok", message: `OK (${cfg.verify_token.length} chars)` });
  } else {
    steps.push({ id: "verify_token", label: "Verify Token salvo", ok: false, level: "error", message: "Verify Token ausente ou muito curto (mín 12 chars)" });
  }

  // 2. Webhook GET respondendo o challenge
  if (cfg?.verify_token) {
    try {
      const url = new URL(WEBHOOK_URL);
      url.searchParams.set("hub.mode", "subscribe");
      url.searchParams.set("hub.verify_token", cfg.verify_token);
      url.searchParams.set("hub.challenge", "ping-12345");
      const r = await fetch(url.toString());
      const txt = await r.text();
      if (r.ok && txt === "ping-12345") {
        steps.push({ id: "webhook_get", label: "Webhook responde ao challenge", ok: true, level: "ok", message: `GET 200 · echo correto` });
      } else {
        steps.push({ id: "webhook_get", label: "Webhook responde ao challenge", ok: false, level: "error", message: `HTTP ${r.status} · body="${txt.slice(0, 80)}"` });
      }
    } catch (e: any) {
      steps.push({ id: "webhook_get", label: "Webhook responde ao challenge", ok: false, level: "error", message: e.message });
    }
  } else {
    steps.push({ id: "webhook_get", label: "Webhook responde ao challenge", ok: false, level: "error", message: "pulado — sem verify_token" });
  }

  // 3. Token Meta válido — Page token é opcional quando o User Token já tem acesso via BM
  const pat = cfg?.page_access_token as string | undefined;
  const userTok = (cfg?.user_access_token as string | undefined) ?? undefined;
  let tokenType: "page" | "user" | null = null;
  let me: any = null;
  const tokenForIdentity = pat || userTok;
  if (!tokenForIdentity) {
    steps.push({ id: "page_token", label: "Acesso Meta salvo", ok: false, level: "error", message: "Token de Página/User não salvo" });
  } else {
    try {
      // Passo 3a: /me básico (id,name) — funciona com qualquer token
      const r1 = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name&access_token=${encodeURIComponent(tokenForIdentity)}`);
      const j1 = await r1.json();
      if (!r1.ok) {
        steps.push({ id: "page_token", label: "Acesso Meta salvo", ok: false, level: "error", message: j1?.error?.message ?? `HTTP ${r1.status}` });
      } else {
        me = j1;
        // Passo 3b: tenta /me com category/tasks para saber se é Page Token
        try {
          const r2 = await fetch(`https://graph.facebook.com/v21.0/me?fields=id,name,category,tasks&access_token=${encodeURIComponent(tokenForIdentity)}`);
          const j2 = await r2.json();
          if (r2.ok && (j2.category || Array.isArray(j2.tasks))) {
            tokenType = "page";
            me = j2;
          } else {
            tokenType = "user";
          }
        } catch {
          tokenType = "user";
        }
        steps.push({ id: "page_token", label: "Acesso Meta salvo", ok: true, level: "ok", message: `${tokenType === "page" ? "Page Token" : "User Token/BM"} · ${j1.name} (${j1.id})` });
      }
    } catch (e: any) {
      steps.push({ id: "page_token", label: "Acesso Meta salvo", ok: false, level: "error", message: e.message });
    }
  }

  // 4. Permissões — prefere user_access_token (Page tokens não expõem /me/permissions)
  const permTok = userTok ?? pat;
  if (permTok) {
    try {
      const r = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${encodeURIComponent(permTok)}`);
      const j = await r.json();
      if (r.ok && Array.isArray(j.data)) {
        const granted = new Set(j.data.filter((p: any) => p.status === "granted").map((p: any) => p.permission));
        const needed = ["leads_retrieval", "pages_show_list", "pages_manage_metadata", "pages_read_engagement", "business_management"];
        const missing = needed.filter((p) => !granted.has(p));
        if (missing.length === 0) {
          steps.push({ id: "perms", label: "Permissões concedidas", ok: true, level: "ok", message: needed.join(", ") });
        } else {
          steps.push({ id: "perms", label: "Permissões concedidas", ok: false, level: "warn", message: `Faltam: ${missing.join(", ")} · concedidas: ${[...granted].join(", ") || "nenhuma"}` });
        }
      } else if (userTok) {
        steps.push({ id: "perms", label: "Permissões concedidas", ok: false, level: "error", message: j?.error?.message ?? `HTTP ${r.status}` });
      } else {
        steps.push({ id: "perms", label: "Permissões concedidas", ok: true, level: "warn", message: "Não foi possível listar (normal em Page Token) — reconecte com User Token para ver as permissões" });
      }
    } catch (e: any) {
      steps.push({ id: "perms", label: "Permissões concedidas", ok: false, level: "warn", message: e.message });
    }
  }

  // 5. Listar formulários — tenta page token, depois user token (varre todas as páginas)
  if (pat || userTok) {
    try {
      const forms: any[] = [];
      const seen = new Set<string>();
      const pushForms = (arr: any[], pageInfo?: { id: string; name: string }) => {
        for (const f of arr) {
          if (seen.has(f.id)) continue;
          seen.add(f.id);
          forms.push(pageInfo ? { ...f, page_id: pageInfo.id, page_name: pageInfo.name } : f);
        }
      };

      if (pat && tokenType === "page" && me?.id) {
        const r = await fetch(`https://graph.facebook.com/v21.0/${me.id}/leadgen_forms?fields=id,name,status,leads_count&limit=100&access_token=${encodeURIComponent(pat)}`);
        const j = await r.json();
        if (r.ok && Array.isArray(j.data)) pushForms(j.data, { id: me.id, name: me.name });
      }

      if (userTok) {
        const pages = new Map<string, any>();
        const rememberPage = (p: any, business?: any) => {
          if (!p?.id || pages.has(p.id)) return;
          pages.set(p.id, { ...p, business });
        };
        const acc = await fetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,business{id,name}&limit=100&access_token=${encodeURIComponent(userTok)}`).then(r => r.json());
        for (const p of acc?.data ?? []) rememberPage(p, p.business);
        const biz = await fetch(`https://graph.facebook.com/v21.0/me/businesses?fields=id,name&limit=100&access_token=${encodeURIComponent(userTok)}`).then(r => r.json());
        for (const b of biz?.data ?? []) {
          for (const edge of ["owned_pages", "client_pages"]) {
            const listed = await fetch(`https://graph.facebook.com/v21.0/${b.id}/${edge}?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userTok)}`).then(r => r.json());
            for (const p of listed?.data ?? []) rememberPage(p, b);
          }
        }
        for (const p of pages.values()) {
          const tok = p.access_token ?? userTok;
          const r = await fetch(`https://graph.facebook.com/v21.0/${p.id}/leadgen_forms?fields=id,name,status,leads_count&limit=100&access_token=${encodeURIComponent(tok)}`);
          const j = await r.json();
          if (r.ok && Array.isArray(j.data)) pushForms(j.data, { id: p.id, name: p.name });
        }
      }

      steps.push({
        id: "forms", label: "Formulários de Lead Ads", ok: forms.length > 0, level: forms.length > 0 ? "ok" : "warn",
        message: forms.length > 0 ? `${forms.length} formulário(s) encontrado(s)` : "0 formulário(s) — verifique se a Página tem campanhas de Lead Ads ativas e se o token tem acesso a ela",
        detail: forms,
      });
    } catch (e: any) {
      steps.push({ id: "forms", label: "Formulários de Lead Ads", ok: false, level: "error", message: e.message });
    }
  }

  // 6. App Secret (opcional, só warning)
  if (cfg?.app_secret) {
    steps.push({ id: "app_secret", label: "App Secret salvo (validação de assinatura)", ok: true, level: "ok", message: "Habilitada validação X-Hub-Signature-256" });
  } else {
    steps.push({ id: "app_secret", label: "App Secret salvo (validação de assinatura)", ok: true, level: "warn", message: "Opcional — sem ele, qualquer POST com formato válido é aceito" });
  }

  // grava resultado
  if (cfg?.id) {
    await admin.from("facebook_webhook_config")
      .update({ last_validated_at: new Date().toISOString(), last_validation_result: steps as any })
      .eq("id", cfg.id);
  }

  const allOk = steps.every((s) => s.level !== "error");
  return new Response(JSON.stringify({ ok: allOk, steps, webhook_url: WEBHOOK_URL }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
