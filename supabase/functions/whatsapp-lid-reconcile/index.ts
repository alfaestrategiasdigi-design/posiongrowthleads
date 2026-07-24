// Reconcilia conversas provisórias @lid de forma 100% automática.
// Estratégia (nenhuma decisão manual, nenhuma correlação por nome de lead):
//   0) Consulta a Evolution API (/chat/findContacts/{instance}) de cada conexão
//      ativa e importa o mapeamento (lid, phone) autoritativo do Baileys.
//      Cada par vira alias em whatsapp_jid_aliases e dispara merge automático.
//   1) Alias já conhecido em whatsapp_jid_aliases -> merge automático.
//   2) Correlação por wamid: mesma mensagem em duas conversas -> merge automático.
//   3) Conversa @lid sem candidato há mais de 48h -> removida silenciosamente.
// Aceita chamadas internas (Bearer SERVICE_KEY) e chamadas de admin autenticado.
import { createClient } from "npm:@supabase/supabase-js@2";
import { isPlausiblePhoneDigits, isTrustworthyPhoneJid } from "../_shared/phone-jid.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function onlyDigits(v: unknown) { return String(v ?? "").replace(/\D/g, ""); }

function normalizeBase(u: string) { return u.replace(/\/+$/, ""); }

function firstLidJid(list: unknown[]): string | null {
  for (const raw of list) {
    const s = String(raw ?? "").trim();
    if (!s) continue;
    if (s.includes("@lid")) {
      const digits = onlyDigits(s.split("@")[0]);
      if (digits) return `${digits}@lid`;
    }
  }
  return null;
}

function firstPhoneJid(list: unknown[]): string | null {
  for (const raw of list) {
    const s = String(raw ?? "").trim();
    if (!s || s.includes("@lid") || s.includes("@g.us") || s.includes("@broadcast")) continue;
    const digits = onlyDigits(s.split("@")[0]);
    // Only accept plausible E.164 (>=11, <=15, no leading zero). The previous
    // >=8 threshold was the residual porta that let truncated ids in.
    if (isPlausiblePhoneDigits(digits)) return `${digits}@s.whatsapp.net`;
  }
  return null;
}

async function mergeInto(admin: any, sourceId: string, target: any) {
  await admin.from("messages")
    .update({ conversation_id: target.id, metadata: {} })
    .eq("conversation_id", sourceId);
  await admin.from("message_reactions")
    .update({ conversation_id: target.id })
    .eq("conversation_id", sourceId);
  await admin.from("conversations")
    .update({
      ultima_interacao: new Date().toISOString(),
      needs_lid_review: false,
      lid_review_notes: null,
    })
    .eq("id", target.id);
  await admin.from("conversations").delete().eq("id", sourceId);
}

async function adoptLegacyGlobalConversation(admin: any, target: any, tenantId: string | null) {
  if (!tenantId || !target || target.tenant_id) return target;
  await admin.from("conversations")
    .update({ tenant_id: tenantId, needs_lid_review: false, lid_review_notes: null })
    .eq("id", target.id)
    .is("tenant_id", null);
  await admin.from("messages")
    .update({ tenant_id: tenantId })
    .eq("conversation_id", target.id)
    .is("tenant_id", null);
  await admin.from("message_reactions")
    .update({ tenant_id: tenantId })
    .eq("conversation_id", target.id)
    .is("tenant_id", null);
  return { ...target, tenant_id: tenantId };
}

// Persiste alias autoritativo (par lid+phone do MESMO objeto de contato Baileys)
// e mescla imediatamente qualquer conversa @lid provisória na canônica.
async function upsertAliasAndMerge(
  admin: any,
  tenantId: string | null,
  instanceName: string | null,
  lidJid: string,
  phoneJid: string,
) {
  if (!isTrustworthyPhoneJid(phoneJid)) {
    console.warn("[whatsapp-lid-reconcile] alias_rejected_implausible_phone", {
      lidJid, phoneJid, source: "evolution_lookup",
    });
    return { merged: 0, renamed: 0 };
  }
  await admin.from("whatsapp_jid_aliases").upsert({
    tenant_id: tenantId,
    instance_name: instanceName,
    lid_jid: lidJid,
    phone_jid: phoneJid,
    updated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }, { onConflict: "tenant_scope,lid_jid" });

  // Encontra a conversa @lid provisória e a canônica (por phoneJid ou telefone).
  const phone = onlyDigits(phoneJid.split("@")[0]);

  let provQ = admin.from("conversations")
    .select("id, tenant_id, nao_lidas, ultima_interacao, ultima_mensagem, nome_contato")
    .eq("remote_jid", lidJid);
  provQ = tenantId ? provQ.eq("tenant_id", tenantId) : provQ.is("tenant_id", null);
  const { data: provList } = await provQ;
  if (!provList || provList.length === 0) return { merged: 0, renamed: 0 };

  let canonQ = admin.from("conversations")
    .select("id, tenant_id, nao_lidas, remote_jid")
    .eq("remote_jid", phoneJid);
  canonQ = tenantId ? canonQ.eq("tenant_id", tenantId) : canonQ.is("tenant_id", null);
  let { data: canonical } = await canonQ.maybeSingle();
  if (!canonical && phone) {
    let pq = admin.from("conversations")
      .select("id, tenant_id, nao_lidas, remote_jid")
      .eq("telefone", phone);
    pq = tenantId ? pq.eq("tenant_id", tenantId) : pq.is("tenant_id", null);
    const { data } = await pq.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
    canonical = data;
  }

  let merged = 0;
  let renamed = 0;
  for (const prov of provList) {
    if (!canonical) {
      await admin.from("conversations")
        .update({ remote_jid: phoneJid, telefone: phone, needs_lid_review: false, lid_review_notes: null })
        .eq("id", prov.id);
      await admin.from("messages").update({ metadata: {} })
        .eq("conversation_id", prov.id)
        .filter("metadata->>pending_lid_resolution", "eq", "true");
      canonical = { id: prov.id, tenant_id: prov.tenant_id, nao_lidas: prov.nao_lidas ?? 0, remote_jid: phoneJid };
      renamed++;
      continue;
    }
    if (canonical.id === prov.id) continue;
    const adopted = await adoptLegacyGlobalConversation(admin, canonical, tenantId);
    await mergeInto(admin, prov.id, adopted);
    canonical = adopted;
    merged++;
  }
  return { merged, renamed };
}

// Consulta ativamente a Evolution API para importar o mapeamento (lid, phone)
// mantido pelo Baileys, dispensando qualquer heurística por nome ou revisão manual.
async function resolveViaEvolutionApi(admin: any, tenantFilter: string | null) {
  const stats = { instances_scanned: 0, contacts_seen: 0, pairs_imported: 0, merged: 0, renamed: 0, errors: 0 };

  // Só consulta Evolution para tenants que TÊM conversas @lid pendentes,
  // evitando varreduras caras em instâncias que não precisam de reconciliação.
  let pendingQ = admin.from("conversations")
    .select("tenant_id")
    .like("remote_jid", "%@lid")
    .limit(500);
  if (tenantFilter) pendingQ = pendingQ.eq("tenant_id", tenantFilter);
  const { data: pendingRows } = await pendingQ;
  const tenantsWithPending = new Set((pendingRows ?? []).map((r: any) => r.tenant_id).filter(Boolean));
  if (tenantsWithPending.size === 0) return stats;

  let connQ = admin.from("zapi_connections")
    .select("tenant_id, instance_url, api_key, instance_name, status, provider")
    .eq("provider", "evolution")
    .eq("status", "connected")
    .in("tenant_id", Array.from(tenantsWithPending));
  const { data: conns } = await connQ;

  for (const conn of conns ?? []) {
    if (!conn?.instance_url || !conn?.api_key || !conn?.instance_name) continue;
    stats.instances_scanned++;
    const base = normalizeBase(conn.instance_url);
    const endpoints: Array<{ method: string; url: string; body?: any }> = [
      { method: "GET",  url: `${base}/chat/findContacts/${encodeURIComponent(conn.instance_name)}` },
      { method: "POST", url: `${base}/chat/findContacts/${encodeURIComponent(conn.instance_name)}`, body: { where: {} } },
    ];

    let contacts: any[] = [];
    let ok = false;
    for (const ep of endpoints) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const res = await fetch(ep.url, {
          method: ep.method,
          headers: { "Content-Type": "application/json", apikey: conn.api_key },
          body: ep.body ? JSON.stringify(ep.body) : undefined,
          signal: ctrl.signal,
        }).finally(() => clearTimeout(timer));
        if (!res.ok) continue;
        const parsed = await res.json().catch(() => null);
        if (Array.isArray(parsed)) contacts = parsed;
        else if (Array.isArray(parsed?.contacts)) contacts = parsed.contacts;
        else if (Array.isArray(parsed?.data)) contacts = parsed.data;
        else if (Array.isArray(parsed?.response?.contacts)) contacts = parsed.response.contacts;
        if (contacts.length > 0) { ok = true; break; }
      } catch (e) {
        stats.errors++;
        console.warn("[whatsapp-lid-reconcile] evolution_fetch_failed", String(e).slice(0, 200));
      }
    }
    if (!ok) continue;
    // Filtra localmente: só nos interessam contatos com AMBOS lid e phone.
    contacts = contacts.filter((c: any) => {
      const cands = [c?.id, c?.remoteJid, c?.jid, c?.lid, c?.lidJid, c?.pn, c?.phoneNumber, c?.wa_id];
      return firstLidJid(cands) && firstPhoneJid(cands);
    });
    if (contacts.length > 500) contacts = contacts.slice(0, 500);
    stats.contacts_seen += contacts.length;

    for (const c of contacts) {
      const candidates = [
        c?.id, c?.remoteJid, c?.remoteJidAlt, c?.jid, c?.jidAlt,
        c?.lid, c?.lidJid, c?.lid_jid,
        c?.pn, c?.phoneNumber, c?.wa_id, c?.senderPn, c?.participantPn,
      ];
      const lidJid = firstLidJid(candidates);
      const phoneJid = firstPhoneJid(candidates);
      if (!lidJid || !phoneJid) continue;
      try {
        const r = await upsertAliasAndMerge(admin, conn.tenant_id, conn.instance_name, lidJid, phoneJid);
        stats.pairs_imported++;
        stats.merged += r.merged;
        stats.renamed += r.renamed;
      } catch (e) {
        stats.errors++;
        console.warn("[whatsapp-lid-reconcile] evolution_pair_failed", String(e).slice(0, 200));
      }
    }
  }
  return stats;
}

// Remove silenciosamente conversas @lid órfãs há muito tempo (sem candidato
// canônico após consulta à Evolution API e correlação por wamid). Cascata
// remove mensagens associadas — mas mensagens úteis já foram mescladas antes.
async function archiveStaleLidConversations(admin: any, tenantFilter: string | null) {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  let sel = admin.from("conversations")
    .select("id")
    .like("remote_jid", "%@lid")
    .lt("ultima_interacao", cutoff);
  if (tenantFilter) sel = sel.eq("tenant_id", tenantFilter);
  const { data: stale } = await sel;
  const ids = (stale ?? []).map((r: any) => r.id);
  if (ids.length === 0) return { archived: 0 };
  const { error } = await admin.from("conversations").delete().in("id", ids);
  if (error) return { archived: 0, error: error.message };
  return { archived: ids.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = authHeader.replace("Bearer ", "");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  // Chamada interna (scheduler / cron / webhook) usa a service-role key direta.
  const isInternal = token === SERVICE_KEY;

  let isAdmin = false;
  let userId: string | null = null;
  if (!isInternal) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes } = await userClient.auth.getUser(token);
    userId = userRes?.user?.id ?? null;
    if (!userId) return json({ error: "Unauthorized" }, 401);
    const { data: adm } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
    isAdmin = Boolean(adm);
  }

  let body: any = {};
  try { body = await req.json(); } catch {}
  const tenantFilter: string | null = body?.tenant_id ?? null;
  const dryRun: boolean = Boolean(body?.dry_run);
  const rawLimit = Number(body?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : 100;

  if (!isInternal && tenantFilter && !isAdmin) {
    const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: tenantFilter });
    if (!allowed) return json({ error: "Sem acesso a este tenant" }, 403);
  }
  if (!isInternal && !tenantFilter && !isAdmin) {
    return json({ error: "Somente admin master pode rodar em todos os tenants" }, 403);
  }

  // Etapa 0: importa mapeamento autoritativo lid<->phone via Evolution API.
  const evolutionStats = dryRun ? { skipped: true } : await resolveViaEvolutionApi(admin, tenantFilter);

  // Etapa 1/2: percorre @lid remanescentes tentando alias já persistido e wamid.
  let q = admin.from("conversations")
    .select("id, tenant_id, remote_jid, telefone, nome_contato, ultima_interacao, nao_lidas")
    .like("remote_jid", "%@lid")
    .order("ultima_interacao", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (tenantFilter) q = q.eq("tenant_id", tenantFilter);
  const { data: lidConvs, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const perTenant: Record<string, { found: number; auto_merged: number; renamed: number }> = {};
  const bumpT = (t: string | null, k: keyof typeof perTenant[string]) => {
    const key = t ?? "__global__";
    perTenant[key] ??= { found: 0, auto_merged: 0, renamed: 0 };
    perTenant[key][k] += 1;
  };
  const details: any[] = [];

  for (const lid of lidConvs ?? []) {
    bumpT(lid.tenant_id, "found");

    // 1) Alias já conhecido.
    let aliasQ = admin.from("whatsapp_jid_aliases")
      .select("phone_jid").eq("lid_jid", lid.remote_jid)
      .is("quarantined_at", null);
    aliasQ = lid.tenant_id ? aliasQ.eq("tenant_id", lid.tenant_id) : aliasQ.is("tenant_id", null);
    let { data: alias } = await aliasQ.maybeSingle();
    if (!alias?.phone_jid && lid.tenant_id) {
      const { data: globalAlias } = await admin.from("whatsapp_jid_aliases")
        .select("phone_jid")
        .eq("lid_jid", lid.remote_jid)
        .is("tenant_id", null)
        .is("quarantined_at", null)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      alias = globalAlias;
    }
    // HARDENED: ignore aliases whose phone_jid isn't a plausible E.164 phone.
    // Legacy rows persist in the table (356 in Donna Face alone) — treating
    // them as absent prevents "rename by alias" from stamping a truncated
    // <digits>@s.whatsapp.net onto a conversation.
    if (alias && !isTrustworthyPhoneJid(alias.phone_jid)) {
      console.warn("[whatsapp-lid-reconcile] alias_read_skipped_implausible_phone", {
        lidJid: lid.remote_jid, phoneJid: alias.phone_jid,
      });
      alias = null;
    }

    let target: any = null;

    if (alias?.phone_jid) {
      const phone = onlyDigits(alias.phone_jid.split("@")[0]);
      let cq = admin.from("conversations")
        .select("id, tenant_id, nao_lidas, remote_jid")
        .eq("remote_jid", alias.phone_jid);
      cq = lid.tenant_id ? cq.or(`tenant_id.eq.${lid.tenant_id},tenant_id.is.null`) : cq.is("tenant_id", null);
      const { data: byJid } = await cq.order("tenant_id", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      if (byJid) target = await adoptLegacyGlobalConversation(admin, byJid, lid.tenant_id);
      else if (phone) {
        let pq = admin.from("conversations")
          .select("id, tenant_id, nao_lidas, remote_jid")
          .eq("telefone", phone);
        pq = lid.tenant_id ? pq.or(`tenant_id.eq.${lid.tenant_id},tenant_id.is.null`) : pq.is("tenant_id", null);
        const { data: byPhone } = await pq.order("tenant_id", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
        if (byPhone) target = await adoptLegacyGlobalConversation(admin, byPhone, lid.tenant_id);
      }
      if (!target) {
        if (!dryRun) {
          await admin.from("conversations")
            .update({ remote_jid: alias.phone_jid, telefone: phone, needs_lid_review: false, lid_review_notes: null })
            .eq("id", lid.id);
          await admin.from("messages").update({ metadata: {} })
            .eq("conversation_id", lid.id)
            .filter("metadata->>pending_lid_resolution", "eq", "true");
        }
        bumpT(lid.tenant_id, "renamed");
        details.push({ id: lid.id, action: "renamed_by_alias", target: alias.phone_jid });
        continue;
      }
    }

    // 2) Correlação por wamid.
    if (!target) {
      const { data: lidMsgs } = await admin.from("messages")
        .select("wamid")
        .eq("conversation_id", lid.id)
        .not("wamid", "is", null)
        .limit(50);
      const wamids = Array.from(new Set((lidMsgs ?? []).map((m: any) => m.wamid).filter(Boolean)));
      if (wamids.length > 0) {
        let mq = admin.from("messages")
          .select("conversation_id")
          .in("wamid", wamids)
          .neq("conversation_id", lid.id);
        mq = lid.tenant_id ? mq.eq("tenant_id", lid.tenant_id) : mq.is("tenant_id", null);
        const { data: hits } = await mq.limit(50);
        const otherConvIds = Array.from(new Set((hits ?? []).map((h: any) => h.conversation_id).filter(Boolean)));
        if (otherConvIds.length === 1) {
          const { data: cand } = await admin.from("conversations")
            .select("id, tenant_id, nao_lidas, remote_jid")
            .eq("id", otherConvIds[0])
            .maybeSingle();
          if (cand && !cand.remote_jid?.includes("@lid")) {
            target = await adoptLegacyGlobalConversation(admin, cand, lid.tenant_id);
          }
        }
      }
    }

    if (target) {
      if (!dryRun && lid.remote_jid?.includes("@lid") && target.remote_jid && !target.remote_jid.includes("@lid")) {
        if (!isTrustworthyPhoneJid(target.remote_jid)) {
          console.warn("[whatsapp-lid-reconcile] alias_rejected_implausible_phone", {
            lidJid: lid.remote_jid, phoneJid: target.remote_jid, source: "wamid_correlation",
          });
        } else {
          await admin.from("whatsapp_jid_aliases").upsert({
            tenant_id: lid.tenant_id,
            lid_jid: lid.remote_jid,
            phone_jid: target.remote_jid,
            updated_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString(),
          }, { onConflict: "tenant_scope,lid_jid" });
        }
      }
      if (!dryRun) await mergeInto(admin, lid.id, target);
      bumpT(lid.tenant_id, "auto_merged");
      details.push({ id: lid.id, action: "auto_merged", target_id: target.id });
      continue;
    }

    // Nenhum candidato agora. NÃO marcar needs_lid_review — fluxo é automático.
    // O arquivamento silencioso cuida das que ficarem órfãs por muito tempo.
    if (!dryRun) {
      await admin.from("conversations")
        .update({ needs_lid_review: false, lid_review_notes: null })
        .eq("id", lid.id);
    }
    details.push({ id: lid.id, action: "pending_evolution_sync" });
  }

  const archiveStats = dryRun ? { skipped: true } : await archiveStaleLidConversations(admin, tenantFilter);

  return json({
    ok: true,
    dry_run: dryRun,
    evolution: evolutionStats,
    per_tenant: perTenant,
    archived: archiveStats,
    processed: (lidConvs ?? []).length,
    details,
  });
});
