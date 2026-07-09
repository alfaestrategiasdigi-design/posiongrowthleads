// Importação retroativa de leads do Facebook Lead Ads.
// POST body: { form_ids?: string[], max_per_form?: number }
// Se form_ids estiver vazio, busca todos os formulários acessíveis na conta/BM.
// IMPORTANTE: a origem de segurança é o USER token com acesso ao Business Manager.
// Page tokens são usados quando existem, mas não bloqueiam o sync: se a BM já tem
// acesso, o user token é fallback para listar formulários e buscar leads.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;
const FB_TOKEN_ENV = Deno.env.get("FACEBOOK_PAGE_ACCESS_TOKEN") ?? "";
const GRAPH = "https://graph.facebook.com/v21.0";

const pick = (obj: Record<string, any>, keys: string[]): string | null => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
};
function flattenFieldData(arr: any[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!Array.isArray(arr)) return out;
  for (const item of arr) {
    const name = (item?.name ?? "").toString().toLowerCase();
    const value = Array.isArray(item?.values) ? item.values[0] : item?.value;
    if (name && value != null) out[name] = String(value);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const bearer = authHeader.replace("Bearer ", "").trim();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const isService = bearer === SERVICE_KEY;
  let callerUserId: string | null = null;
  if (!isService) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims } = await userClient.auth.getClaims(bearer);
    if (!claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    callerUserId = claims.claims.sub;
  }

  let payload: any = {};
  try { payload = await req.json(); } catch { /* no body */ }
  const requestedForms: string[] = Array.isArray(payload.form_ids) ? payload.form_ids : [];
  const maxPerForm: number = Number(payload.max_per_form ?? 100);
  const scopeTenantId: string | null = typeof payload.tenant_id === "string" && payload.tenant_id
    ? payload.tenant_id : null;

  // Time budget: platform kills at 150s idle. Stop early and return partial.
  const START = Date.now();
  const BUDGET_MS = 120_000;
  const timeLeft = () => (Date.now() - START) < BUDGET_MS;
  let truncated = false;

  // Authorization: admin OR tenant member (when scoping to a specific tenant).
  if (!isService && callerUserId) {
    const { data: roleOk } = await admin.rpc("has_role", {
      _user_id: callerUserId, _role: "admin",
    });
    if (!roleOk) {
      if (!scopeTenantId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: canAccess } = await admin.rpc("has_tenant_access", {
        _user_id: callerUserId, _tenant_id: scopeTenantId,
      });
      if (!canAccess) {
        return new Response(JSON.stringify({ error: "Forbidden: no access to tenant" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
  }

  const { data: cfg } = await admin
    .from("facebook_webhook_config")
    .select("page_access_token, user_access_token, page_id, ad_account_id, default_tenant_id")
    .limit(1).maybeSingle();
  const pagePrimaryToken = (cfg as any)?.page_access_token || FB_TOKEN_ENV;
  const userToken = (cfg as any)?.user_access_token || "";
  const primaryPageId = (cfg as any)?.page_id || null;

  if (!pagePrimaryToken && !userToken) {
    return new Response(JSON.stringify({ error: "Nenhum token do Facebook configurado" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Cache de Páginas acessíveis via conta/BM. `token` pode não existir em páginas
  // vindas de Business Manager; nesses casos usamos o user token como fallback.
  const pageTokenCache: Record<string, { token?: string; name?: string; business_id?: string; business_name?: string }> = {};
  if (primaryPageId && pagePrimaryToken) {
    pageTokenCache[primaryPageId] = { token: pagePrimaryToken };
  }
  const rememberPage = (p: any, business?: any) => {
    if (!p?.id) return;
    const cur = pageTokenCache[p.id] ?? {};
    pageTokenCache[p.id] = {
      ...cur,
      token: p.access_token ?? cur.token,
      name: p.name ?? cur.name,
      business_id: business?.id ?? p.business?.id ?? cur.business_id,
      business_name: business?.name ?? p.business?.name ?? cur.business_name,
    };
  };
  const loadPagesErrors: any[] = [];
  if (userToken) {
    try {
      let url: string | null = `${GRAPH}/me/accounts?fields=id,name,access_token,business{id,name}&limit=200&access_token=${encodeURIComponent(userToken)}`;
      while (url) {
        const r = await fetch(url);
        const j: any = await r.json();
        if (!r.ok) { loadPagesErrors.push(j?.error ?? j); break; }
        for (const p of j.data ?? []) rememberPage(p);
        url = j.paging?.next ?? null;
      }
    } catch (e) { loadPagesErrors.push(String(e)); }

    try {
      let bizUrl: string | null = `${GRAPH}/me/businesses?fields=id,name&limit=200&access_token=${encodeURIComponent(userToken)}`;
      while (bizUrl) {
        const rb = await fetch(bizUrl);
        const jb: any = await rb.json();
        if (!rb.ok) { loadPagesErrors.push(jb?.error ?? jb); break; }
        for (const b of jb.data ?? []) {
          for (const edge of ["owned_pages", "client_pages"]) {
            let pageUrl: string | null = `${GRAPH}/${b.id}/${edge}?fields=id,name,access_token&limit=200&access_token=${encodeURIComponent(userToken)}`;
            while (pageUrl) {
              const rp = await fetch(pageUrl);
              const jp: any = await rp.json();
              if (!rp.ok) { loadPagesErrors.push({ business_id: b.id, edge, error: jp?.error ?? jp }); break; }
              for (const p of jp.data ?? []) rememberPage(p, b);
              pageUrl = jp.paging?.next ?? null;
            }
          }
        }
        bizUrl = jb.paging?.next ?? null;
      }
    } catch (e) { loadPagesErrors.push(String(e)); }
  }

  // Resolve list of forms — quando vazio, usa a página primária.
  // Se scopeTenantId estiver setado e nenhum form for enviado, usamos apenas os
  // formulários vinculados àquele tenant em lead_routing_rules.
  let formIds: string[] = requestedForms.slice();
  const formsMeta: Record<string, { name?: string; page_id?: string; page_name?: string }> = {};

  if (!formIds.length && scopeTenantId) {
    const { data: routes } = await admin
      .from("lead_routing_rules")
      .select("match_value")
      .eq("active", true)
      .eq("match_type", "form_id")
      .eq("tenant_id", scopeTenantId);
    formIds = Array.from(new Set((routes ?? []).map((r: any) => String(r.match_value)).filter(Boolean)));
    if (!formIds.length) {
      return new Response(JSON.stringify({
        ok: true, totals: { fetched: 0, imported: 0, deduped: 0, failed: 0 },
        by_form: [], tenant_id: scopeTenantId,
        message: "Nenhum formulário Meta está vinculado a este tenant.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  if (!formIds.length) {
    const pages = Object.entries(pageTokenCache);
    if (!pages.length && primaryPageId) pages.push([primaryPageId, { token: pagePrimaryToken }]);
    if (!pages.length) {
      return new Response(JSON.stringify({ error: "Nenhuma Página/BM acessível e nenhum form_ids enviado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    for (const [pageId, page] of pages) {
      const tok = page.token || userToken || pagePrimaryToken;
      if (!tok) continue;
      const r = await fetch(`${GRAPH}/${pageId}/leadgen_forms?fields=id,name&limit=200&access_token=${encodeURIComponent(tok)}`);
      const j = await r.json();
      if (!r.ok) { loadPagesErrors.push({ page_id: pageId, page_name: page.name, error: j?.error ?? j }); continue; }
      for (const f of j.data ?? []) {
        if (!formIds.includes(f.id)) formIds.push(f.id);
        formsMeta[f.id] = { name: f.name, page_id: pageId, page_name: page.name };
      }
    }
  }

  // Descobre Página dona de cada form usando user token (ou page primary token)
  const discoverToken = userToken || pagePrimaryToken;
  for (const formId of formIds) {
    if (formsMeta[formId]?.page_id) continue;
    try {
      const r = await fetch(`${GRAPH}/${formId}?fields=name,page{id,name}&access_token=${encodeURIComponent(discoverToken)}`);
      const j: any = await r.json();
      if (r.ok) {
        formsMeta[formId] = {
          name: j.name,
          page_id: j.page?.id,
          page_name: j.page?.name,
        };
        if (j.page?.id && !pageTokenCache[j.page.id]?.name && j.page?.name) {
          pageTokenCache[j.page.id] = { ...(pageTokenCache[j.page.id] ?? {}), name: j.page.name };
        }
      } else {
        formsMeta[formId] = { name: undefined };
      }
    } catch { formsMeta[formId] = {}; }
  }

  const by_form: any[] = [];

  for (const formId of formIds) {
    if (!timeLeft()) { truncated = true; break; }
    const meta = formsMeta[formId] ?? {};
    const pageId = meta.page_id;
    const formName = meta.name ?? null;
    const pageName = meta.page_name ?? (pageId ? pageTokenCache[pageId]?.name : undefined) ?? null;

    // Escolhe token da Página dona quando disponível; se a origem veio de BM,
    // o user token autorizado também pode buscar os leads do form.
    const pageToken = pageId ? pageTokenCache[pageId]?.token : undefined;
    const fetchToken = pageToken || userToken || (pageId === primaryPageId ? pagePrimaryToken : "");

    if (!fetchToken) {
      by_form.push({
        form_id: formId, form_name: formName, page_id: pageId, page_name: pageName,
        error: pageId
          ? `Sem token de usuário/BM para acessar a origem ${pageName ?? pageId}. Reconecte a conta Meta com acesso ao Business Manager.`
          : "Não foi possível identificar a Página dona do formulário.",
        imported: 0, deduped: 0, failed: 0, fetched: 0,
      });
      continue;
    }

    let imported = 0, deduped = 0, failed = 0, fetched = 0;
    let url: string | null =
      `${GRAPH}/${formId}/leads?fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&limit=50&access_token=${encodeURIComponent(fetchToken)}`;
    let errMsg: string | null = null;

    while (url && fetched < maxPerForm) {
      if (!timeLeft()) { truncated = true; break; }
      const r = await fetch(url);
      const j: any = await r.json();
      if (!r.ok) {
        errMsg = j?.error?.message ?? `HTTP ${r.status}`;
        url = null;
        break;
      }
      for (const lead of j.data ?? []) {
        if (!timeLeft()) { truncated = true; break; }
        fetched++;
        const flat = flattenFieldData(lead.field_data);
        const nome      = pick(flat, ["full_name","nome","nome_completo","name","first_name"]);
        let whatsapp    = pick(flat, ["phone_number","phone","whatsapp","telefone","celular"]);
        if (whatsapp) whatsapp = whatsapp.replace(/^p:\+?/i, "").replace(/\D/g, "");
        const email     = pick(flat, ["email","e_mail"]);
        const empresa   = pick(flat, ["company_name","empresa","clinica","nome_empresa","nome_clinica"]);
        const cidade    = pick(flat, ["city","cidade","cidade_estado"]);
        const especialidade = pick(flat, ["especialidade","specialty","nicho","você_já_realiza_cirurgias_de_transplante_capilar?"]);
        const faturamento   = pick(flat, ["faturamento","revenue","faturamento_mensal","qual_o_faturamento_médio_mensal_da_sua_clínica_hoje?"]);
        const instagram = pick(flat, ["instagram","qual_o_@_do_seu_instagram?"]);
        const trafego   = pick(flat, ["já_investiu_em_tráfego_pago?","trafego_pago"]);

        if (!nome && !whatsapp && !email) { failed++; continue; }

        // Monta pares [{name,label,value}] para exibir todos os campos do formulário no CRM
        const formFields = Array.isArray(lead.field_data)
          ? lead.field_data.map((f: any) => ({
              name: String(f?.name ?? ""),
              label: String(f?.name ?? "").replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
              value: Array.isArray(f?.values) ? f.values.join(", ") : (f?.value ?? ""),
            }))
          : [];
        const extrasPayload = {
          form_fields: formFields,
          facebook: {
            lead_id: lead.id, form_id: lead.form_id ?? formId, form_name: formName,
            ad_id: lead.ad_id, ad_name: lead.ad_name,
            adset_id: lead.adset_id, adset_name: lead.adset_name,
            campaign_id: lead.campaign_id, campaign_name: lead.campaign_name,
            created_time: lead.created_time,
          },
        };

        // ISOLAMENTO ESTRITO por form_id. Regras com is_admin_master=true → tenant NULL (POSION).
        const { data: routing } = await admin.rpc("resolve_form_routing", {
          p_form_id: lead.form_id ?? formId,
        });
        const routeRow: any = Array.isArray(routing) ? routing[0] : routing;
        const matched = !!routeRow?.matched;
        const isMaster = !!routeRow?.is_admin_master;
        const routedTenant: string | null = matched ? ((routeRow?.tenant_id as string | null) ?? null) : null;

        // Se importando com escopo de tenant, ignore leads que não sejam desse tenant.
        if (scopeTenantId && (!matched || isMaster || routedTenant !== scopeTenantId)) {
          failed++;
          continue;
        }

        const { data: existing } = await admin
          .from("leads").select("id, extras, tenant_id").eq("facebook_lead_id", lead.id).maybeSingle();
        if (existing) {
          // Lead já importado antes do vínculo: atualiza o tenant de acordo com a regra atual.
          const cur: any = (existing as any).extras ?? {};
          const patch: any = {};
          if (!cur.form_fields || (Array.isArray(cur.form_fields) && cur.form_fields.length === 0)) {
            patch.extras = { ...cur, ...extrasPayload };
          }
          if (matched && (existing as any).tenant_id !== routedTenant) {
            patch.tenant_id = routedTenant;
          }
          if (Object.keys(patch).length) {
            await admin.from("leads").update(patch).eq("id", (existing as any).id);
          }
          deduped++; continue;
        }

        if (!matched) {
          await admin.from("unrouted_leads").insert({
            raw_payload: lead,
            form_id: lead.form_id ?? formId,
            page_id: pageId ?? primaryPageId ?? null,
            ad_account_id: (cfg as any)?.ad_account_id ?? null,
            facebook_lead_id: lead.id,
            nome, whatsapp, email,
          });
          failed++;
          continue;
        }
        // matched=true: pode ser tenant OU master (routedTenant=null)


        const observacoesParts: string[] = [];
        if (instagram) observacoesParts.push(`Instagram: ${instagram}`);
        if (trafego)   observacoesParts.push(`Tráfego pago: ${trafego}`);

        const { error } = await admin.from("leads").insert({
          nome_completo: nome ?? "Lead Facebook Ads",
          whatsapp: whatsapp ?? "",
          email,
          nome_empresa: empresa,
          cidade_estado: cidade,
          especialidade,
          faturamento_mensal: faturamento,
          status: "lead",
          origem: "facebook_ads",
          revendedor_iniciante: false,
          facebook_lead_id: lead.id,
          facebook_form_id: lead.form_id ?? formId,
          facebook_form_name: formName,
          facebook_campaign: lead.campaign_name ?? null,
          facebook_ad_name: lead.ad_name ?? null,
          facebook_adset_name: lead.adset_name ?? null,
          observacoes: observacoesParts.length ? observacoesParts.join(" | ") : null,
          utm_source: "facebook",
          utm_medium: "paid",
          utm_campaign: lead.campaign_name ?? null,
          utm_content: lead.ad_name ?? null,
          utm_term: lead.adset_name ?? null,
          tenant_id: routedTenant,
          extras: extrasPayload,
          created_at: lead.created_time ?? undefined,
        } as any);
        if (error) {
          console.error("[backfill] erro insert:", error.message);
          failed++;
        } else {
          imported++;
        }
      }
      url = j.paging?.next ?? null;
    }

    by_form.push({
      form_id: formId, form_name: formName, page_id: pageId, page_name: pageName,
      fetched, imported, deduped, failed, ...(errMsg ? { error: errMsg } : {}),
    });
  }

  const totals = by_form.reduce((acc, s) => ({
    fetched: acc.fetched + (s.fetched ?? 0),
    imported: acc.imported + (s.imported ?? 0),
    deduped: acc.deduped + (s.deduped ?? 0),
    failed: acc.failed + (s.failed ?? 0),
  }), { fetched: 0, imported: 0, deduped: 0, failed: 0 });

  return new Response(JSON.stringify({
    ok: true,
    tenant_id: scopeTenantId,
    totals,
    by_form,
    summary: by_form, // compat com UI antiga
    pages_loaded: Object.keys(pageTokenCache).length,
    pages_errors: loadPagesErrors,
  }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
