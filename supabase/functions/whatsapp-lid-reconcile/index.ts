// Reconcilia conversas provisórias @lid em lote, sem depender de CONTACTS_UPDATE.
// Estratégia:
//   1) Se já existe alias em whatsapp_jid_aliases -> merge automático.
//   2) Se existe EXATAMENTE UMA conversa canônica no mesmo tenant com o mesmo
//      nome_contato (case-insensitive, trimado) -> merge automático.
//   3) Caso 0 ou mais de 1 candidata canônica -> marca needs_lid_review=true
//      com nota explicando o motivo. Não decide nada sozinho.
// POST body: { tenant_id?: uuid, dry_run?: boolean }
import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const token = authHeader.replace("Bearer ", "");
  const { data: userRes } = await userClient.auth.getUser(token);
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });

  let body: any = {};
  try { body = await req.json(); } catch {}
  const tenantFilter: string | null = body?.tenant_id ?? null;
  const dryRun: boolean = Boolean(body?.dry_run);

  if (tenantFilter && !isAdmin) {
    const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: tenantFilter });
    if (!allowed) return json({ error: "Sem acesso a este tenant" }, 403);
  }
  if (!tenantFilter && !isAdmin) return json({ error: "Somente admin master pode rodar em todos os tenants" }, 403);

  let q = admin.from("conversations")
    .select("id, tenant_id, remote_jid, telefone, nome_contato, ultima_interacao, nao_lidas")
    .like("remote_jid", "%@lid");
  if (tenantFilter) q = q.eq("tenant_id", tenantFilter);
  const { data: lidConvs, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const perTenant: Record<string, { found: number; auto_merged: number; renamed: number; manual_review: number }> = {};
  const bumpT = (t: string | null, k: keyof typeof perTenant[string]) => {
    const key = t ?? "__global__";
    perTenant[key] ??= { found: 0, auto_merged: 0, renamed: 0, manual_review: 0 };
    perTenant[key][k] += 1;
  };

  const details: any[] = [];

  for (const lid of lidConvs ?? []) {
    bumpT(lid.tenant_id, "found");

    // 1) Alias já conhecido?
    let aliasQ = admin.from("whatsapp_jid_aliases")
      .select("phone_jid").eq("lid_jid", lid.remote_jid);
    aliasQ = lid.tenant_id ? aliasQ.eq("tenant_id", lid.tenant_id) : aliasQ.is("tenant_id", null);
    const { data: alias } = await aliasQ.maybeSingle();

    let target: any = null;
    let reason = "";

    if (alias?.phone_jid) {
      const phone = onlyDigits(alias.phone_jid.split("@")[0]);
      let cq = admin.from("conversations")
        .select("id, nao_lidas")
        .eq("remote_jid", alias.phone_jid);
      cq = lid.tenant_id ? cq.eq("tenant_id", lid.tenant_id) : cq.is("tenant_id", null);
      const { data: byJid } = await cq.maybeSingle();
      if (byJid) { target = byJid; reason = "alias_hit_by_jid"; }
      else if (phone) {
        let pq = admin.from("conversations")
          .select("id, nao_lidas")
          .eq("telefone", phone);
        pq = lid.tenant_id ? pq.eq("tenant_id", lid.tenant_id) : pq.is("tenant_id", null);
        const { data: byPhone } = await pq.maybeSingle();
        if (byPhone) { target = byPhone; reason = "alias_hit_by_phone"; }
      }
      if (!target) {
        // Rename in place using alias.
        if (!dryRun) {
          await admin.from("conversations")
            .update({ remote_jid: alias.phone_jid, telefone: phone, needs_lid_review: false, lid_review_notes: null })
            .eq("id", lid.id);
          await admin.from("messages").update({ metadata: {} })
            .eq("conversation_id", lid.id)
            .filter("metadata->>pending_lid_resolution", "eq", "true");
        }
        bumpT(lid.tenant_id, "renamed");
        details.push({ id: lid.id, tenant_id: lid.tenant_id, action: "renamed_by_alias", target: alias.phone_jid });
        continue;
      }
    }

    // 2) Match por nome_contato (case-insensitive) no mesmo tenant.
    if (!target && lid.nome_contato && lid.nome_contato.length >= 2) {
      let nq = admin.from("conversations")
        .select("id, nao_lidas, remote_jid")
        .ilike("nome_contato", lid.nome_contato.trim())
        .neq("id", lid.id);
      nq = lid.tenant_id ? nq.eq("tenant_id", lid.tenant_id) : nq.is("tenant_id", null);
      const { data: candidates } = await nq;
      const canonicals = (candidates ?? []).filter((c: any) => !c.remote_jid?.includes("@lid"));
      if (canonicals.length === 1) {
        target = canonicals[0];
        reason = "pushname_unique_canonical";
      } else if (canonicals.length > 1) {
        if (!dryRun) {
          await admin.from("conversations")
            .update({ needs_lid_review: true, lid_review_notes: `pushName '${lid.nome_contato}' bate com ${canonicals.length} conversas canônicas — revisar manualmente.` })
            .eq("id", lid.id);
        }
        bumpT(lid.tenant_id, "manual_review");
        details.push({ id: lid.id, tenant_id: lid.tenant_id, action: "manual_multiple_canonical", count: canonicals.length });
        continue;
      }
    }

    if (target) {
      if (!dryRun) await mergeInto(admin, lid.id, target);
      bumpT(lid.tenant_id, "auto_merged");
      details.push({ id: lid.id, tenant_id: lid.tenant_id, action: "auto_merged", target_id: target.id, reason });
      continue;
    }

    // 3) Sem candidato -> revisão manual.
    if (!dryRun) {
      await admin.from("conversations")
        .update({ needs_lid_review: true, lid_review_notes: "Sem candidato canônico automático — revisar manualmente." })
        .eq("id", lid.id);
    }
    bumpT(lid.tenant_id, "manual_review");
    details.push({ id: lid.id, tenant_id: lid.tenant_id, action: "manual_no_candidate" });
  }

  return json({ ok: true, dry_run: dryRun, per_tenant: perTenant, details });
});
