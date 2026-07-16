// Reconcilia mensagens sem wamid, correlacionando com irmãs (mesma conversa,
// mesma direção, mesmo conteúdo, janela de tempo próxima) que já receberam
// wamid via webhook messages.upsert. Ajuda o caso onde a mensagem foi gravada
// pelo painel (evolution-send) antes do webhook chegar e ficou sem wamid,
// impedindo o ACK (delivered/read) posterior.
//
// POST body: { tenant_id?: uuid|null, dry_run?: boolean, window_minutes?: number, limit?: number }
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const statusRank: Record<string, number> = { failed: 0, sent: 1, delivered: 2, read: 3 };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userRes } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const tenantFilter: string | null = body?.tenant_id ?? null;
  const dryRun: boolean = Boolean(body?.dry_run);
  const windowMinutes = Math.max(1, Math.min(Number(body?.window_minutes ?? 5), 60));
  const limit = Math.max(1, Math.min(Number(body?.limit ?? 500), 2000));

  if (tenantFilter && !isAdmin) {
    const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: tenantFilter });
    if (!allowed) return json({ error: "Sem acesso a este tenant" }, 403);
  }
  if (!tenantFilter && !isAdmin) return json({ error: "Somente admin master pode rodar em todos os tenants" }, 403);

  // 1) Puxa candidatos: mensagens sem wamid nos últimos 30 dias.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let q = admin
    .from("messages")
    .select("id, conversation_id, tenant_id, direction, sender, conteudo, tipo, media_url, status, wamid, created_at")
    .is("wamid", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (tenantFilter) q = q.eq("tenant_id", tenantFilter);
  const { data: candidates, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const stats = {
    scanned: candidates?.length ?? 0,
    matched: 0,
    updated: 0,
    duplicates_deleted: 0,
    unmatched: 0,
  };
  const details: any[] = [];

  for (const m of candidates ?? []) {
    // Busca irmãs na mesma conversa/direção com wamid dentro da janela.
    const from = new Date(new Date(m.created_at).getTime() - windowMinutes * 60_000).toISOString();
    const to = new Date(new Date(m.created_at).getTime() + windowMinutes * 60_000).toISOString();

    let sib = admin
      .from("messages")
      .select("id, wamid, status, conteudo, tipo, media_url, created_at")
      .eq("conversation_id", m.conversation_id)
      .eq("direction", m.direction)
      .not("wamid", "is", null)
      .gte("created_at", from)
      .lte("created_at", to)
      .neq("id", m.id)
      .order("created_at", { ascending: true })
      .limit(10);

    const { data: siblings } = await sib;
    if (!siblings || siblings.length === 0) { stats.unmatched++; continue; }

    // Melhor match: mesmo conteúdo (texto) ou mesmo media_url; senão o mais próximo no tempo.
    const scored = siblings.map((s) => {
      let score = 0;
      if (m.conteudo && s.conteudo && s.conteudo === m.conteudo) score += 10;
      if (m.tipo && s.tipo && s.tipo === m.tipo) score += 2;
      if (m.media_url && s.media_url && s.media_url === m.media_url) score += 8;
      const dt = Math.abs(new Date(s.created_at).getTime() - new Date(m.created_at).getTime());
      score += Math.max(0, 5 - dt / 60_000); // decai com tempo
      return { s, score };
    }).sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best || best.score < 3) { stats.unmatched++; continue; }

    stats.matched++;
    const sibling = best.s;

    // Se é claramente duplicata (mesmo conteúdo/mídia), remove esta linha vazia
    // e mantém a que tem wamid, promovendo status para o maior nível.
    const isDup = (m.conteudo && sibling.conteudo === m.conteudo) ||
                  (m.media_url && sibling.media_url === m.media_url);

    if (isDup) {
      if (!dryRun) {
        const bestStatus = [m.status, sibling.status].reduce(
          (acc, s) => (statusRank[s ?? "sent"] > statusRank[acc ?? "sent"] ? s : acc),
          sibling.status,
        );
        await admin.from("messages").update({ status: bestStatus }).eq("id", sibling.id);
        await admin.from("messages").delete().eq("id", m.id);
      }
      stats.duplicates_deleted++;
      details.push({ action: "deleted_duplicate", kept: sibling.id, removed: m.id, wamid: sibling.wamid });
    } else {
      if (!dryRun) {
        await admin.from("messages").update({ wamid: sibling.wamid }).eq("id", m.id);
      }
      stats.updated++;
      details.push({ action: "wamid_filled", message_id: m.id, wamid: sibling.wamid, sibling_id: sibling.id });
    }
  }

  return json({ ok: true, dry_run: dryRun, stats, details, window_minutes: windowMinutes });
});
