// Merge manual de uma conversa @lid escolhido pelo atendente.
// POST body: { lid_conversation_id: uuid, target_conversation_id?: uuid, target_phone?: string }
// - target_conversation_id: mescla mensagens/reações na conversa alvo e apaga a @lid.
// - target_phone: E.164 ou dígitos; renomeia a @lid para <digits>@s.whatsapp.net (se não existir canônica). Se já existir uma canônica com esse telefone, mescla nela.
// Sempre registra o alias em whatsapp_jid_aliases para prevenir recorrência do mesmo LID.
import { createClient } from "npm:@supabase/supabase-js@2";
import { isTrustworthyPhoneJid } from "../_shared/phone-jid.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const onlyDigits = (v: unknown) => String(v ?? "").replace(/\D/g, "");

async function mergeInto(admin: any, sourceId: string, target: { id: string; nao_lidas?: number | null }, sourceUnread = 0) {
  await admin.from("messages")
    .update({ conversation_id: target.id, metadata: {} })
    .eq("conversation_id", sourceId);
  await admin.from("message_reactions")
    .update({ conversation_id: target.id })
    .eq("conversation_id", sourceId);
  await admin.from("conversations")
    .update({
      ultima_interacao: new Date().toISOString(),
      nao_lidas: (target.nao_lidas ?? 0) + (sourceUnread ?? 0),
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
  const lidId: string = body?.lid_conversation_id ?? "";
  const targetId: string | null = body?.target_conversation_id ?? null;
  const targetPhoneRaw: string | null = body?.target_phone ?? null;
  if (!lidId) return json({ error: "lid_conversation_id obrigatório" }, 400);
  if (!targetId && !targetPhoneRaw) return json({ error: "Informe target_conversation_id ou target_phone" }, 400);

  const { data: lid } = await admin.from("conversations")
    .select("id, tenant_id, remote_jid, telefone, nome_contato, nao_lidas")
    .eq("id", lidId).maybeSingle();
  if (!lid) return json({ error: "Conversa @lid não encontrada" }, 404);
  if (lid.tenant_id) {
    if (!isAdmin) {
      const { data: allowed } = await admin.rpc("has_tenant_access", { _user_id: userId, _tenant_id: lid.tenant_id });
      if (!allowed) return json({ error: "Sem permissão" }, 403);
    }
  } else if (!isAdmin) {
    return json({ error: "Somente admin master pode mesclar conversas globais" }, 403);
  }

  // Register alias when possible (unblocks future merges automatically).
  const lidJid = lid.remote_jid?.includes("@lid") ? lid.remote_jid : null;

  // Path A: mesclar em conversa existente
  if (targetId) {
    const { data: target } = await admin.from("conversations")
      .select("id, tenant_id, remote_jid, telefone, nao_lidas")
      .eq("id", targetId).maybeSingle();
    if (!target) return json({ error: "Conversa alvo não encontrada" }, 404);
    if ((target.tenant_id ?? null) !== (lid.tenant_id ?? null)) {
      return json({ error: "Alvo e origem devem estar no mesmo tenant" }, 400);
    }
    if (lidJid && target.remote_jid && !target.remote_jid.includes("@lid")) {
      if (!isTrustworthyPhoneJid(target.remote_jid)) {
        console.warn("[whatsapp-lid-merge] alias_rejected_implausible_phone", {
          lidJid, phoneJid: target.remote_jid, source: "manual_merge_target",
        });
      } else {
        await admin.from("whatsapp_jid_aliases").upsert({
          tenant_id: lid.tenant_id,
          lid_jid: lidJid,
          phone_jid: target.remote_jid,
          updated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        }, { onConflict: "tenant_scope,lid_jid" });
      }
    }
    await mergeInto(admin, lid.id, target, lid.nao_lidas ?? 0);
    return json({ ok: true, action: "merged_into", target_id: target.id });
  }

  // Path B: renomear/mesclar por telefone
  const digits = onlyDigits(targetPhoneRaw);
  if (digits.length < 8) return json({ error: "target_phone inválido" }, 400);
  const phoneJid = `${digits}@s.whatsapp.net`;

  // Já existe canônica com esse número?
  let cq = admin.from("conversations")
    .select("id, nao_lidas, remote_jid")
    .or(`remote_jid.eq.${phoneJid},telefone.eq.${digits}`);
  cq = lid.tenant_id ? cq.eq("tenant_id", lid.tenant_id) : cq.is("tenant_id", null);
  const { data: existing } = await cq.neq("id", lid.id).limit(1).maybeSingle();

  if (lidJid) {
    await admin.from("whatsapp_jid_aliases").upsert({
      tenant_id: lid.tenant_id,
      lid_jid: lidJid,
      phone_jid: phoneJid,
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "tenant_scope,lid_jid" });
  }

  if (existing) {
    await mergeInto(admin, lid.id, existing, lid.nao_lidas ?? 0);
    return json({ ok: true, action: "merged_into_existing_by_phone", target_id: existing.id });
  }

  // Renomeia em lugar
  await admin.from("conversations")
    .update({ remote_jid: phoneJid, telefone: digits, needs_lid_review: false, lid_review_notes: null })
    .eq("id", lid.id);
  await admin.from("messages").update({ metadata: {} })
    .eq("conversation_id", lid.id)
    .filter("metadata->>pending_lid_resolution", "eq", "true");
  return json({ ok: true, action: "renamed_in_place", conversation_id: lid.id, phone: digits });
});
