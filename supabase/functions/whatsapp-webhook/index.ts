// Webhook público da Evolution API.
// Eventos suportados: messages.upsert, messages.update (status), connection.update,
// contacts.update / contacts.upsert (pushName + profilePicUrl). Mídia (image/audio/video/document)
// é baixada via getBase64FromMediaMessage e salva em storage whatsapp-media.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY);

function normalizeBase(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch { return s.replace(/\/+$/, ""); }
}

function onlyDigits(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizePhoneJid(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  if (raw.endsWith("@g.us") || raw.endsWith("@broadcast")) return null;
  if (raw.includes("@lid")) return raw;
  const digits = onlyDigits(raw.split("@")[0]);
  if (!digits) return null;
  return `${digits}@s.whatsapp.net`;
}

function firstStandardJid(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const jid = normalizePhoneJid(candidate);
    if (jid && !jid.includes("@lid")) return jid;
  }
  return null;
}

function firstLidJid(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const jid = normalizePhoneJid(candidate);
    if (jid?.includes("@lid")) return jid;
  }
  return null;
}

async function upsertJidAlias(tenantId: string | null, instanceName: string | null, lidJid: string | null, phoneJid: string | null) {
  if (!lidJid?.includes("@lid") || !phoneJid || phoneJid.includes("@lid")) return;
  try {
    await admin.from("whatsapp_jid_aliases").upsert({
      tenant_id: tenantId,
      instance_name: instanceName,
      lid_jid: lidJid,
      phone_jid: phoneJid,
      updated_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "tenant_scope,lid_jid" });
    // Now that we know the canonical JID for this @lid, migrate any provisional
    // conversation/messages that were ingested under the raw @lid.
    await mergeProvisionalLidConversations(tenantId, lidJid, phoneJid);
  } catch (e) {
    console.warn("[whatsapp-webhook] upsertJidAlias_failed", String(e));
  }
}

// When a @lid alias becomes known, migrate messages that were ingested with the
// raw @lid as remote_jid into the canonical phone-jid conversation and clear
// the pending flag. If no canonical conversation exists yet, rename the
// provisional one in place. Safe to call repeatedly.
async function mergeProvisionalLidConversations(tenantId: string | null, lidJid: string, phoneJid: string) {
  const phone = onlyDigits(phoneJid.split("@")[0]);
  if (!phone) return;

  let provQ = admin.from("conversations")
    .select("id, nao_lidas, ultima_interacao, ultima_mensagem, nome_contato")
    .eq("remote_jid", lidJid);
  provQ = tenantId ? provQ.eq("tenant_id", tenantId) : provQ.is("tenant_id", null);
  const { data: provisional } = await provQ.maybeSingle();
  if (!provisional) return;

  let canonQ = admin.from("conversations")
    .select("id, nao_lidas, ultima_interacao")
    .eq("remote_jid", phoneJid);
  canonQ = tenantId ? canonQ.eq("tenant_id", tenantId) : canonQ.is("tenant_id", null);
  let { data: canonical } = await canonQ.maybeSingle();
  if (!canonical) {
    let byPhoneQ = admin.from("conversations")
      .select("id, nao_lidas, ultima_interacao")
      .eq("telefone", phone);
    byPhoneQ = tenantId ? byPhoneQ.eq("tenant_id", tenantId) : byPhoneQ.is("tenant_id", null);
    const { data } = await byPhoneQ.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
    canonical = data;
  }

  if (!canonical) {
    // No canonical yet: just rename the provisional in place.
    await admin.from("conversations")
      .update({ remote_jid: phoneJid, telefone: phone })
      .eq("id", provisional.id);
    await admin.from("messages")
      .update({ metadata: {} })
      .eq("conversation_id", provisional.id)
      .eq("metadata->>pending_lid_resolution", "true");
    return;
  }

  // Move messages from provisional -> canonical and clear pending flag.
  await admin.from("messages")
    .update({ conversation_id: canonical.id, metadata: {} })
    .eq("conversation_id", provisional.id);
  await admin.from("message_reactions")
    .update({ conversation_id: canonical.id })
    .eq("conversation_id", provisional.id);
  await admin.from("conversations")
    .update({
      ultima_mensagem: provisional.ultima_mensagem ?? undefined,
      ultima_interacao: provisional.ultima_interacao ?? new Date().toISOString(),
      nao_lidas: (canonical.nao_lidas ?? 0) + (provisional.nao_lidas ?? 0),
      nome_contato: provisional.nome_contato ?? undefined,
    })
    .eq("id", canonical.id);
  await admin.from("conversations").delete().eq("id", provisional.id);
}

async function mappedPhoneJid(tenantId: string | null, lidJid: string | null): Promise<string | null> {
  if (!lidJid?.includes("@lid")) return null;
  let q = admin.from("whatsapp_jid_aliases").select("phone_jid").eq("lid_jid", lidJid);
  q = tenantId ? q.eq("tenant_id", tenantId) : q.is("tenant_id", null);
  const { data } = await q.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  return data?.phone_jid ?? null;
}

async function resolveRemoteJid(message: any, key: any, tenantId: string | null, instanceName: string | null): Promise<{ remoteJid: string | null; rawRemoteJid: string | null; unresolvedLid: boolean }> {
  const rawRemoteJid = String(key?.remoteJid ?? message?.remoteJid ?? "").trim() || null;
  const candidates = [
    key?.remoteJidAlt,
    key?.remoteJid_alt,
    key?.participantAlt,
    message?.remoteJidAlt,
    message?.remoteJid_alt,
    message?.participantAlt,
    message?.message?.key?.remoteJidAlt,
    message?.message?.key?.remoteJid_alt,
    rawRemoteJid,
  ];
  const standard = firstStandardJid(candidates);
  const lid = firstLidJid(candidates);
  if (standard) {
    await upsertJidAlias(tenantId, instanceName, lid, standard);
    return { remoteJid: standard, rawRemoteJid, unresolvedLid: false };
  }

  const normalizedRaw = normalizePhoneJid(rawRemoteJid);
  const mapped = await mappedPhoneJid(tenantId, normalizedRaw ?? null);
  if (mapped) return { remoteJid: mapped, rawRemoteJid, unresolvedLid: false };

  return {
    remoteJid: normalizedRaw?.includes("@lid") ? null : normalizedRaw,
    rawRemoteJid,
    unresolvedLid: Boolean(normalizedRaw?.includes("@lid")),
  };
}

async function findConversation(tenantId: string | null, remoteJid: string, phone: string) {
  let byJid = admin.from("conversations")
    .select("id, nao_lidas, remote_jid, telefone")
    .eq("remote_jid", remoteJid);
  byJid = tenantId ? byJid.eq("tenant_id", tenantId) : byJid.is("tenant_id", null);
  const jidResult = await byJid.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
  if (jidResult.data) return jidResult.data;

  let byPhone = admin.from("conversations")
    .select("id, nao_lidas, remote_jid, telefone")
    .eq("telefone", phone);
  byPhone = tenantId ? byPhone.eq("tenant_id", tenantId) : byPhone.is("tenant_id", null);
  const phoneResult = await byPhone.order("ultima_interacao", { ascending: false }).limit(1).maybeSingle();
  return phoneResult.data ?? null;
}

async function fetchAndStoreMedia(
  conn: { instance_url: string; api_key: string; instance_name: string },
  message: any,
  tipo: string,
): Promise<{ url: string | null; mime: string | null }> {
  try {
    const base = normalizeBase(conn.instance_url);
    const r = await fetch(`${base}/chat/getBase64FromMediaMessage/${encodeURIComponent(conn.instance_name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: conn.api_key },
      body: JSON.stringify({ message: { key: message.key, message: message.message } , convertToMp4: false }),
    });
    if (!r.ok) return { url: null, mime: null };
    const j = await r.json();
    const b64 = j?.base64 ?? j?.data ?? j?.mediaBase64;
    const mime = j?.mimetype ?? j?.mediaType ?? null;
    if (!b64) return { url: null, mime };
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const ext = tipo === "image" ? "jpg" : tipo === "audio" ? "ogg" : tipo === "video" ? "mp4" : "bin";
    const path = `${conn.instance_name}/${Date.now()}_${crypto.randomUUID()}.${ext}`;
    const { error } = await admin.storage.from("whatsapp-media").upload(path, bin, {
      contentType: mime || `application/${ext}`,
      upsert: false,
    });
    if (error) { console.error("[wa media upload]", error); return { url: null, mime }; }
    const { data: signed } = await admin.storage.from("whatsapp-media").createSignedUrl(path, 60 * 60 * 24 * 365);
    return { url: signed?.signedUrl ?? null, mime };
  } catch (e) {
    console.error("[wa media fetch]", e);
    return { url: null, mime: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, name: "whatsapp-webhook" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { return new Response("ok", { headers: corsHeaders }); }

  try {
    const event = (body?.event ?? body?.type ?? "").toString().toLowerCase();
    const instanceName: string = body?.instance ?? body?.instanceName ?? body?.sender ?? "";
    const url = new URL(req.url);
    const tenantSlug = url.searchParams.get("tenant");
    const tenantIdParam = url.searchParams.get("tenant_id");

    let resolvedTenantId: string | null = tenantIdParam;
    if (!resolvedTenantId && tenantSlug) {
      const { data: tenant } = await admin.from("tenants").select("id").eq("slug", tenantSlug).maybeSingle();
      resolvedTenantId = tenant?.id ?? null;
    }

    let conn: any = null;
    let connResolvedBy: "instance_name" | "tenant" | null = null;
    if (instanceName) {
      const { data } = await admin.from("zapi_connections")
        .select("tenant_id, instance_url, api_key, instance_name")
        .eq("provider", "evolution")
        .eq("instance_name", instanceName)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) { conn = data; connResolvedBy = "instance_name"; }
    }
    if (!conn && resolvedTenantId) {
      // Fallback: the URL carries a valid tenant slug/id, so accept the payload
      // and auto-heal the stored instance_name (Evolution may have been
      // recreated with a slightly different name).
      const { data } = await admin.from("zapi_connections")
        .select("tenant_id, instance_url, api_key, instance_name")
        .eq("provider", "evolution")
        .eq("tenant_id", resolvedTenantId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) { conn = data; connResolvedBy = "tenant"; }
    }
    // Only refuse when BOTH the instance name and the URL tenant fail to
    // resolve any registered connection. Otherwise ingestion continues.
    if (!conn) {
      console.warn("[whatsapp-webhook] unknown_instance", {
        instanceName, tenantSlug, tenantIdParam,
      });
      return new Response(JSON.stringify({ ok: true, dropped: "unknown_instance" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (connResolvedBy === "tenant" && instanceName && conn.instance_name !== instanceName) {
      console.log("[whatsapp-webhook] instance_name_updated", {
        tenant_id: conn.tenant_id, from: conn.instance_name, to: instanceName,
      });
      await admin.from("zapi_connections")
        .update({ instance_name: instanceName, updated_at: new Date().toISOString() })
        .eq("provider", "evolution")
        .eq("tenant_id", conn.tenant_id);
      conn.instance_name = instanceName;
    }
    const tenantId = conn?.tenant_id ?? null;

    // Connection state
    if (event.includes("connection.update") || body?.data?.state) {
      const state = body?.data?.state ?? body?.state;
      const status = state === "open" ? "connected" : state === "connecting" ? "connecting" : "disconnected";
      if (instanceName) {
        let upd = admin.from("zapi_connections")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("provider", "evolution").eq("instance_name", instanceName);
        upd = tenantId ? upd.eq("tenant_id", tenantId) : upd.is("tenant_id", null);
        await upd;
      }
    }

    // Contacts update -> pushName + profile pic
    if (event.includes("contacts.")) {
      const contacts: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const c of contacts) {
        const contactCandidates = [c?.remoteJidAlt, c?.remoteJid_alt, c?.jidAlt, c?.idAlt, c?.remoteJid, c?.id];
        const jid = firstStandardJid(contactCandidates);
        await upsertJidAlias(tenantId, instanceName || null, firstLidJid(contactCandidates), jid);
        if (!jid) continue;
        const updates: any = {};
        if (c?.pushName || c?.name) updates.nome_contato = c.pushName || c.name;
        if (c?.profilePicUrl || c?.profilePictureUrl) updates.foto_url = c.profilePicUrl || c.profilePictureUrl;
        if (Object.keys(updates).length === 0) continue;
        let q = admin.from("conversations").update(updates).eq("remote_jid", jid);
        if (tenantId) q = q.eq("tenant_id", tenantId); else q = q.is("tenant_id", null);
        await q;
      }
    }

    // Message status updates (sent/delivered/read)
    if (event.includes("messages.update")) {
      const arr: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const u of arr) {
        const wamid = u?.key?.id ?? u?.id;
        const st = (u?.status ?? u?.update?.status ?? "").toString().toLowerCase();
        if (!wamid || !st) continue;
        const map: Record<string,string> = { read: "read", delivery_ack: "delivered", server_ack: "sent", played: "read" };
        const status = map[st] ?? st;
        await admin.from("messages").update({ status }).eq("wamid", wamid);
      }
    }

    // Message DELETE (revoked)
    if (event.includes("messages.delete") || event === "message.delete") {
      const arr: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const u of arr) {
        const wamid = u?.key?.id ?? u?.id;
        if (!wamid) continue;
        await admin.from("messages").update({
          deleted_at: new Date().toISOString(),
          conteudo: "🚫 Mensagem apagada",
        }).eq("wamid", wamid);
      }
    }

    // Message EDITED
    if (event.includes("messages.edited") || event === "message.edited") {
      const arr: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const u of arr) {
        const wamid = u?.key?.id ?? u?.id;
        const newText = u?.message?.editedMessage?.message?.conversation
          ?? u?.message?.editedMessage?.message?.extendedTextMessage?.text
          ?? u?.text;
        if (!wamid || !newText) continue;
        await admin.from("messages").update({
          conteudo: newText,
          edited_at: new Date().toISOString(),
        }).eq("wamid", wamid);
      }
    }

    // REACTIONS
    if (event.includes("messages.reaction") || event === "message.reaction") {
      const arr: any[] = Array.isArray(body?.data) ? body.data : [body?.data].filter(Boolean);
      for (const r of arr) {
        const targetWamid = r?.reaction?.key?.id ?? r?.message?.reactionMessage?.key?.id ?? r?.key?.id;
        const emoji = r?.reaction?.text ?? r?.message?.reactionMessage?.text ?? r?.text;
        const actor = r?.key?.participant ?? r?.key?.remoteJid ?? r?.reaction?.key?.participant ?? "unknown";
        const fromMe = Boolean(r?.key?.fromMe);
        if (!targetWamid) continue;
        // Find conversation via target message
        const { data: targetMsg } = await admin.from("messages")
          .select("conversation_id, tenant_id").eq("wamid", targetWamid).maybeSingle();
        if (!targetMsg) continue;
        if (!emoji || emoji === "") {
          // reaction removed
          await admin.from("message_reactions").delete()
            .eq("message_wamid", targetWamid).eq("actor_jid", actor);
        } else {
          await admin.from("message_reactions").upsert({
            message_wamid: targetWamid,
            conversation_id: targetMsg.conversation_id,
            tenant_id: targetMsg.tenant_id,
            actor_jid: actor,
            from_me: fromMe,
            emoji,
          }, { onConflict: "message_wamid,actor_jid" });
        }
      }
    }

    // Messages upsert (includes SEND_MESSAGE for outbound echoes from other devices)
    if (
      event.includes("messages.upsert") ||
      event.includes("send.message") ||
      event === "send_message" ||
      (!event && body?.data)
    ) {
      const messagesArr: any[] = Array.isArray(body?.data) ? body.data
        : Array.isArray(body?.data?.messages) ? body.data.messages
        : body?.data ? [body.data] : [];

      for (const m of messagesArr) {
        const key = m?.key ?? m?.message?.key ?? {};
        const wamid: string | null = key?.id ?? m?.id ?? null;
        const resolved = await resolveRemoteJid(m, key, tenantId, instanceName || null);
        const rawRemoteJid = resolved.rawRemoteJid;
        if (rawRemoteJid?.endsWith("@g.us") || rawRemoteJid?.endsWith("@broadcast")) continue;
        const fromMe: boolean = Boolean(key?.fromMe ?? m?.fromMe);
        // Never drop by unresolved @lid: if the alias is not yet known, keep the
        // raw @lid as a provisional remote_jid and flag the message. When the
        // alias arrives later (contacts.* event) mergeProvisionalLidConversations
        // migrates the conversation/messages to the canonical phone JID.
        const effectiveJid = resolved.remoteJid ?? rawRemoteJid;
        if (!effectiveJid) {
          console.warn("[whatsapp-webhook] no_jid_dropped", { wamid, fromMe });
          continue;
        }
        const remoteJid = effectiveJid;
        const isPendingLid = resolved.unresolvedLid || remoteJid.includes("@lid");
        if (isPendingLid) {
          console.log("[whatsapp-webhook] pending_lid_stored", { wamid, rawRemoteJid, fromMe });
        }
        const pushName: string = m?.pushName ?? m?.notifyName ?? "";
        const msgObj = m?.message ?? m;

        // Detect message type (broad coverage)
        const stickerMsg = msgObj?.stickerMessage;
        const locationMsg = msgObj?.locationMessage ?? msgObj?.liveLocationMessage;
        const contactMsg = msgObj?.contactMessage ?? msgObj?.contactsArrayMessage;
        const reactionMsg = msgObj?.reactionMessage;

        // Reactions arriving inside upsert flow -> reroute
        if (reactionMsg) {
          const targetWamid = reactionMsg?.key?.id;
          if (targetWamid) {
            const { data: targetMsg } = await admin.from("messages")
              .select("conversation_id, tenant_id").eq("wamid", targetWamid).maybeSingle();
            if (targetMsg) {
              const emoji = reactionMsg?.text ?? "";
              const actor = key?.participant ?? key?.remoteJid ?? "unknown";
              if (!emoji) {
                await admin.from("message_reactions").delete()
                  .eq("message_wamid", targetWamid).eq("actor_jid", actor);
              } else {
                await admin.from("message_reactions").upsert({
                  message_wamid: targetWamid,
                  conversation_id: targetMsg.conversation_id,
                  tenant_id: targetMsg.tenant_id,
                  actor_jid: actor, from_me: fromMe, emoji,
                }, { onConflict: "message_wamid,actor_jid" });
              }
            }
          }
          continue;
        }

        const text: string = msgObj?.conversation
          ?? msgObj?.extendedTextMessage?.text
          ?? msgObj?.imageMessage?.caption
          ?? msgObj?.videoMessage?.caption
          ?? msgObj?.documentMessage?.caption
          ?? m?.text
          ?? "";

        const tipo = msgObj?.imageMessage ? "image"
          : msgObj?.audioMessage ? "audio"
          : msgObj?.videoMessage ? "video"
          : msgObj?.documentMessage ? "document"
          : stickerMsg ? "sticker"
          : locationMsg ? "location"
          : contactMsg ? "contact"
          : "text";

        if (!text && tipo === "text") continue;

        // Quoted / reply context
        const ctx = msgObj?.extendedTextMessage?.contextInfo
          ?? msgObj?.imageMessage?.contextInfo
          ?? msgObj?.videoMessage?.contextInfo
          ?? msgObj?.audioMessage?.contextInfo
          ?? msgObj?.documentMessage?.contextInfo
          ?? msgObj?.stickerMessage?.contextInfo
          ?? null;
        const replyToWamid: string | null = ctx?.stanzaId ?? null;
        let replyPreview: string | null = null;
        if (ctx?.quotedMessage) {
          const qm = ctx.quotedMessage;
          replyPreview = qm?.conversation
            ?? qm?.extendedTextMessage?.text
            ?? (qm?.imageMessage ? "📷 Imagem" : null)
            ?? (qm?.videoMessage ? "🎬 Vídeo" : null)
            ?? (qm?.audioMessage ? "🎤 Áudio" : null)
            ?? (qm?.documentMessage ? "📄 Documento" : null)
            ?? null;
        }

        // Location / contact payloads
        let locationJson: any = null;
        if (locationMsg) {
          locationJson = {
            lat: locationMsg?.degreesLatitude,
            lng: locationMsg?.degreesLongitude,
            name: locationMsg?.name || null,
            address: locationMsg?.address || null,
          };
        }
        let contactJson: any = null;
        if (contactMsg) {
          contactJson = {
            name: contactMsg?.displayName || null,
            vcard: contactMsg?.vcard || null,
            contacts: contactMsg?.contacts || null,
          };
        }

        const phone = onlyDigits(remoteJid.split("@")[0]);
        if (!phone) continue;

        let conv = await findConversation(tenantId, remoteJid, phone);

        const preview = text
          || (tipo === "audio" ? "🎤 Áudio"
            : tipo === "image" ? "📷 Imagem"
            : tipo === "video" ? "🎬 Vídeo"
            : tipo === "document" ? "📄 Documento"
            : tipo === "sticker" ? "😊 Figurinha"
            : tipo === "location" ? "📍 Localização"
            : tipo === "contact" ? "👤 Contato"
            : `[${tipo}]`);

        if (!conv) {
          const ins = await admin.from("conversations").insert({
            tenant_id: tenantId,
            telefone: phone,
            remote_jid: remoteJid,
            nome_contato: pushName || phone,
            provider: "evolution",
            ultima_mensagem: preview,
            ultima_interacao: new Date().toISOString(),
            nao_lidas: fromMe ? 0 : 1,
          }).select("id, nao_lidas, remote_jid, telefone").maybeSingle();
          conv = ins.data;
          if (!conv && ins.error) {
            conv = await findConversation(tenantId, remoteJid, phone);
          }

          // Auto-create lead (tenant scope, inbound only, skip while pending @lid
          // because the "phone" is a lid id, not a real MSISDN).
          if (!fromMe && tenantId && !isPendingLid) {
            try {
              const { data: existingLead } = await admin
                .from("leads")
                .select("id").eq("tenant_id", tenantId).eq("whatsapp", phone)
                .limit(1).maybeSingle();
              if (!existingLead) {
                await admin.from("leads").insert({
                  tenant_id: tenantId,
                  nome_completo: pushName || phone,
                  whatsapp: phone, origem: "whatsapp",
                  status: "lead", is_organic: true,
                  observacoes: "Lead criado automaticamente via WhatsApp",
                });
              }
            } catch (e) { console.error("[wa auto-lead]", e); }
          }
        } else {
          await admin.from("conversations").update({
            ultima_mensagem: preview,
            ultima_interacao: new Date().toISOString(),
            nao_lidas: fromMe ? conv.nao_lidas : (conv.nao_lidas ?? 0) + 1,
            telefone: phone,
            remote_jid: remoteJid,
            nome_contato: pushName || undefined,
          }).eq("id", conv.id);
        }

        if (!conv?.id) continue;

        // Dedup: by wamid first, then by (conversation + sender + content + 10s window)
        if (wamid) {
          const dup = await admin.from("messages").select("id").eq("wamid", wamid).maybeSingle();
          if (dup.data) continue;
        }
        if (fromMe && text) {
          const since = new Date(Date.now() - 15000).toISOString();
          const dup2 = await admin.from("messages")
            .select("id")
            .eq("conversation_id", conv.id)
            .eq("sender", "usuario")
            .eq("conteudo", text)
            .gte("created_at", since)
            .limit(1).maybeSingle();
          if (dup2.data) {
            // Attach the wamid to the existing outbound row so future ACKs match.
            if (wamid) {
              await admin.from("messages").update({ wamid, status: "delivered" }).eq("id", dup2.data.id);
            }
            continue;
          }
        }

        let media_url: string | null = null;
        let media_mime: string | null = null;
        const isMedia = ["image","audio","video","document","sticker"].includes(tipo);
        if (isMedia && conn) {
          const r = await fetchAndStoreMedia(conn as any, m, tipo);
          media_url = r.url; media_mime = r.mime;
        }

        await admin.from("messages").insert({
          conversation_id: conv.id,
          sender: fromMe ? "usuario" : "cliente",
          conteudo: text || preview,
          tipo: tipo === "sticker" || tipo === "location" || tipo === "contact" ? "text" : tipo,
          media_type: isMedia ? tipo : null,
          media_url, media_mime,
          direction: fromMe ? "outbound" : "inbound",
          status: fromMe ? "sent" : "delivered",
          wamid,
          reply_to_wamid: replyToWamid,
          reply_preview: replyPreview,
          location: locationJson,
          contact_card: contactJson,
          tenant_id: tenantId,
          metadata: isPendingLid
            ? { pending_lid_resolution: true, raw_lid: rawRemoteJid }
            : {},
        });
      }
    }


    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[whatsapp-webhook]", e);
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
