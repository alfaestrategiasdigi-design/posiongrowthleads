// Import histórico de leads via endpoint oficial de export CSV/TSV da Meta:
//   GET https://www.facebook.com/ads/lead_gen/export_csv/?id={form_id}&type=form&from_date=...&to_date=...&access_token=...
//
// Actions:
//   { action: "list_forms" }  → retorna formulários da página configurada (Graph API)
//   { action: "import", form_id, from_date?, to_date? }
//        from_date/to_date em segundos UNIX. Defaults: últimos 30 dias.
//
// Apenas admins (role 'admin') podem chamar.
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

function pick(row: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

function normPhone(s: string | null): string {
  if (!s) return "";
  return s.replace(/^p:\+?/i, "").replace(/\D/g, "");
}

// TSV parser respeitando aspas
function parseTsv(text: string): Record<string, string>[] {
  // Meta às vezes retorna BOM UTF-16; o fetch já decodificou pra string
  const cleaned = text.replace(/^\uFEFF/, "");
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim().length);
  if (lines.length < 2) return [];
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === sep && !inQ) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (cells[i] ?? "").trim(); });
    return row;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth + admin
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
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: roleOk } = await admin.rpc("has_role", {
    _user_id: claims.claims.sub, _role: "admin",
  });
  if (!roleOk) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let payload: any = {};
  try { payload = await req.json(); } catch { /* no body */ }
  const action = payload.action ?? "import";

  const { data: cfg } = await admin
    .from("facebook_webhook_config")
    .select("page_access_token, page_id").limit(1).maybeSingle();
  const token = cfg?.page_access_token || FB_TOKEN_ENV;
  if (!token) {
    return new Response(JSON.stringify({ error: "Token do Facebook não configurado" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- LIST FORMS ---
  if (action === "list_forms") {
    if (!cfg?.page_id) {
      return new Response(JSON.stringify({ error: "page_id não configurado" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const r = await fetch(
      `https://graph.facebook.com/v21.0/${cfg.page_id}/leadgen_forms?fields=id,name,status,leads_count&limit=100&access_token=${encodeURIComponent(token)}`,
    );
    const j = await r.json();
    if (!r.ok) {
      return new Response(JSON.stringify({ error: "Falha listando forms", detail: j }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, forms: j.data ?? [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // --- IMPORT via export_csv ---
  if (action === "import") {
    const formId: string = String(payload.form_id ?? "");
    if (!formId) {
      return new Response(JSON.stringify({ error: "form_id é obrigatório" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const now = Math.floor(Date.now() / 1000);
    const defaultFrom = now - 30 * 24 * 60 * 60;
    const fromDate = Number(payload.from_date ?? defaultFrom);
    const toDate   = Number(payload.to_date ?? now);

    const url = `https://www.facebook.com/ads/lead_gen/export_csv/?id=${encodeURIComponent(formId)}&type=form&from_date=${fromDate}&to_date=${toDate}&access_token=${encodeURIComponent(token)}`;
    console.log(`[export-csv] GET form=${formId} from=${fromDate} to=${toDate}`);

    const r = await fetch(url);
    if (!r.ok) {
      const text = await r.text();
      console.error(`[export-csv] HTTP ${r.status}:`, text.slice(0, 500));
      return new Response(JSON.stringify({ error: `Meta retornou HTTP ${r.status}`, detail: text.slice(0, 1000) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Pode vir UTF-16 LE
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const isUtf16 = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
    const text = new TextDecoder(isUtf16 ? "utf-16le" : "utf-8").decode(buf);
    const rows = parseTsv(text);
    console.log(`[export-csv] parsed ${rows.length} linhas`);

    let inserted = 0, deduped = 0, errors = 0, organic = 0;
    const errorMsgs: string[] = [];

    for (const row of rows) {
      const fbLeadId = pick(row, ["id", "lead_id"]);
      if (fbLeadId) {
        const { data: exist } = await admin
          .from("leads").select("id").eq("facebook_lead_id", fbLeadId).maybeSingle();
        if (exist) { deduped++; continue; }
      }

      const nome = pick(row, ["full_name", "nome", "nome_completo", "name", "first_name"]);
      const whatsapp = normPhone(pick(row, ["phone_number", "phone", "whatsapp", "telefone", "celular"]));
      const email = pick(row, ["email", "e_mail"]);
      const empresa = pick(row, ["company_name", "empresa", "clinica", "nome_empresa"]);
      const cidade = pick(row, ["city", "cidade", "cidade_estado"]);
      const especialidade = pick(row, ["especialidade", "specialty", "nicho", "você_já_realiza_cirurgias_de_transplante_capilar?"]);
      const faturamento = pick(row, ["faturamento", "qual_o_faturamento_médio_mensal_da_sua_clínica_hoje?"]);
      const instagram = pick(row, ["instagram", "qual_o_@_do_seu_instagram?"]);
      const trafego = pick(row, ["já_investiu_em_tráfego_pago?", "trafego_pago"]);
      const adId = pick(row, ["ad_id", "adgroup_id"]);
      const adName = pick(row, ["ad_name"]);
      const adsetName = pick(row, ["adset_name"]);
      const campaignName = pick(row, ["campaign_name", "campaign_id"]);
      const formName = pick(row, ["form_name"]);
      const isOrganicRaw = pick(row, ["is_organic"]);
      const isOrganic = isOrganicRaw === "1" || isOrganicRaw?.toLowerCase() === "true" || (!adId && !adName);
      const createdTime = pick(row, ["created_time", "creation_date"]);

      if (!nome && !whatsapp && !email) { errors++; continue; }

      const obs: string[] = [];
      if (instagram) obs.push(`Instagram: ${instagram}`);
      if (trafego) obs.push(`Tráfego: ${trafego}`);

      const { error } = await admin.from("leads").insert({
        nome_completo: nome ?? "Lead Facebook Ads",
        whatsapp: whatsapp ?? "",
        email,
        nome_empresa: empresa,
        cidade_estado: cidade,
        especialidade,
        faturamento_mensal: faturamento,
        status: "novo",
        origem: isOrganic ? "facebook_organic" : "facebook_ads",
        revendedor_iniciante: false,
        facebook_lead_id: fbLeadId,
        facebook_form_id: formId,
        facebook_form_name: formName,
        facebook_campaign: campaignName,
        facebook_ad_name: adName,
        facebook_adset_name: adsetName,
        is_organic: isOrganic,
        observacoes: obs.length ? obs.join(" | ") : null,
        utm_source: "facebook",
        utm_medium: isOrganic ? "organic" : "lead_ads",
        utm_campaign: campaignName ?? adName ?? null,
        created_at: createdTime && !isNaN(Date.parse(createdTime))
          ? new Date(createdTime).toISOString()
          : undefined,
      });
      if (error) {
        errors++;
        if (errorMsgs.length < 5) errorMsgs.push(error.message);
      } else {
        inserted++;
        if (isOrganic) organic++;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      total: rows.length,
      inserted,
      deduped,
      organic,
      errors,
      error_samples: errorMsgs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response(JSON.stringify({ error: `Ação desconhecida: ${action}` }), {
    status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
