// Callback OAuth do Kommo. Troca `code` por tokens e faz postMessage pro opener.
// GET query: ?code=...&state=<tenantId:nonce>&referer=<subdomain>.kommo.com
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function html(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

function closingPage(payload: unknown) {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  return html(`<!doctype html><meta charset="utf-8"><title>Kommo</title>
<body style="font-family:system-ui;padding:32px;color:#111">
<p>Autenticação Kommo concluída. Fechando janela...</p>
<script>
  try { window.opener && window.opener.postMessage(${json}, "*"); } catch(e){}
  setTimeout(()=>window.close(), 300);
</script></body>`);
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  const code = u.searchParams.get("code");
  const state = u.searchParams.get("state") ?? "";
  const referer = u.searchParams.get("referer") ?? "";
  const tenantId = state.split(":")[0];

  if (!code || !tenantId) {
    return closingPage({ source: "kommo-oauth", ok: false, error: "Parâmetros inválidos" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: conn } = await admin.from("kommo_connections").select("*").eq("tenant_id", tenantId).maybeSingle();
  if (!conn) return closingPage({ source: "kommo-oauth", ok: false, error: "Conexão não encontrada" });

  const subdomain = referer ? referer.split(".")[0] : conn.subdomain;

  try {
    const r = await fetch(`https://${subdomain}.kommo.com/oauth2/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: conn.client_id,
        client_secret: conn.client_secret,
        grant_type: "authorization_code",
        code,
        redirect_uri: `${SUPABASE_URL}/functions/v1/kommo-oauth-callback`,
      }),
    });
    const j = await r.json();
    if (!r.ok) return closingPage({ source: "kommo-oauth", ok: false, error: `Token exchange falhou: ${JSON.stringify(j)}` });

    const expiresAt = new Date(Date.now() + (j.expires_in ?? 86400) * 1000).toISOString();

    // Buscar metadata da conta
    let accountId: number | null = null, accountName: string | null = null;
    try {
      const ar = await fetch(`https://${subdomain}.kommo.com/api/v4/account`, {
        headers: { Authorization: `Bearer ${j.access_token}` },
      });
      if (ar.ok) {
        const acc = await ar.json();
        accountId = acc?.id ?? null;
        accountName = acc?.name ?? null;
      }
    } catch { /* ignore */ }

    await admin.from("kommo_connections").update({
      subdomain,
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: expiresAt,
      account_id: accountId,
      account_name: accountName,
      status: "connected",
    }).eq("id", conn.id);

    return closingPage({ source: "kommo-oauth", ok: true, account: accountName });
  } catch (e) {
    return closingPage({ source: "kommo-oauth", ok: false, error: String(e) });
  }
});
