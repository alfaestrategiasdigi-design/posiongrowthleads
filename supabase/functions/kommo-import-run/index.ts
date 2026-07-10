// Import completo do Kommo → Posion (leads + custom fields + conversas + mensagens + tarefas + notas).
// POST body: { tenant_id }
// Roda em background via EdgeRuntime.waitUntil; UI faz polling em kommo-import-status.
import { createClient } from "npm:@supabase/supabase-js@2";
import { adminClient, kommoFetch, loadConnection, normalizePhone, updateStats, type KommoConnection } from "../_shared/kommo-api.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

interface FieldDef { id: number; name: string; type: string; enums?: Record<string,string>; }

function buildFieldsCatalog(fields: any[]): Record<string, FieldDef> {
  const out: Record<string, FieldDef> = {};
  for (const f of fields ?? []) {
    const enums: Record<string,string> = {};
    for (const e of f.enums ?? []) enums[String(e.id)] = String(e.value);
    out[String(f.id)] = { id: f.id, name: f.name, type: f.type, enums };
  }
  return out;
}

function extractCustomFields(values: any[], catalog: Record<string, FieldDef>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const cf of values ?? []) {
    const def = catalog[String(cf.field_id)];
    const label = def?.name ?? cf.field_name ?? String(cf.field_id);
    const raw = (cf.values ?? []).map((v: any) => {
      if (v.enum_id && def?.enums?.[String(v.enum_id)]) return def.enums[String(v.enum_id)];
      return v.value ?? v.enum ?? v;
    });
    out[label] = raw.length === 1 ? raw[0] : raw;
  }
  return out;
}

function mapStatus(name: string | null | undefined): string {
  const n = (name ?? "").toLowerCase();
  if (n.includes("ganho") || n.includes("won") || n.includes("fechado") || n.includes("vendido")) return "ganho";
  if (n.includes("perdido") || n.includes("lost") || n.includes("cancelad")) return "perdido";
  if (n.includes("qualific")) return "qualificado";
  if (n.includes("proposta")) return "proposta";
  if (n.includes("negocia")) return "negociacao";
  if (n.includes("reuni") && n.includes("agend")) return "reuniao_agendada";
  if (n.includes("reuni")) return "reuniao_agendada";
  return "lead";
}

async function paginate(conn: KommoConnection, path: string, onPage: (items: any[]) => Promise<void>, limit = 250) {
  let page = 1;
  while (true) {
    const sep = path.includes("?") ? "&" : "?";
    const j = await kommoFetch(conn, `${path}${sep}limit=${limit}&page=${page}`);
    const items = j?._embedded?.leads ?? j?._embedded?.contacts ?? j?._embedded?.tasks ?? j?._embedded?.notes ?? j?._embedded?.chats ?? j?._embedded?.messages ?? [];
    if (!items.length) return;
    await onPage(items);
    if (!j?._links?.next) return;
    page++;
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function runImport(tenantId: string) {
  const admin = adminClient();
  const conn = await loadConnection(tenantId);
  if (!conn) return;

  await admin.from("kommo_connections").update({
    status: "importing",
    last_import_stats: { phase: "starting", started_at: new Date().toISOString() },
  }).eq("id", conn.id);

  const stats: Record<string, any> = { started_at: new Date().toISOString() };

  try {
    // Fase A — Pipelines/Statuses
    stats.phase = "pipelines";
    await updateStats(conn.id, stats);
    const pipelines = await kommoFetch(conn, "/api/v4/leads/pipelines");
    const statusMap: Record<string, { name: string; pipeline: string }> = {};
    for (const p of pipelines?._embedded?.pipelines ?? []) {
      for (const s of p?._embedded?.statuses ?? []) {
        statusMap[String(s.id)] = { name: s.name, pipeline: p.name };
      }
    }
    stats.pipelines = Object.keys(statusMap).length;

    // Fase B — Custom fields
    stats.phase = "custom_fields";
    await updateStats(conn.id, stats);
    const leadFields = await kommoFetch(conn, "/api/v4/leads/custom_fields?limit=250").catch(() => ({}));
    const contactFields = await kommoFetch(conn, "/api/v4/contacts/custom_fields?limit=250").catch(() => ({}));
    const leadCatalog = buildFieldsCatalog(leadFields?._embedded?.custom_fields ?? []);
    const contactCatalog = buildFieldsCatalog(contactFields?._embedded?.custom_fields ?? []);
    stats.custom_fields = Object.keys(leadCatalog).length + Object.keys(contactCatalog).length;
    await updateStats(conn.id, stats);

    // Fase C — Contatos (para telefone/email) + Leads
    stats.phase = "contacts";
    stats.contacts_seen = 0;
    const contactById: Record<string, { name: string; phone: string | null; email: string | null; custom: Record<string, unknown> }> = {};
    await paginate(conn, "/api/v4/contacts?with=leads", async (items) => {
      for (const c of items) {
        const cf = extractCustomFields(c.custom_fields_values ?? [], contactCatalog);
        // Kommo phones/emails são campos "code=PHONE" / "code=EMAIL"
        let phone: string | null = null, email: string | null = null;
        for (const v of c.custom_fields_values ?? []) {
          if (v.field_code === "PHONE") phone = (v.values?.[0]?.value ?? null);
          if (v.field_code === "EMAIL") email = (v.values?.[0]?.value ?? null);
        }
        contactById[String(c.id)] = {
          name: c.name ?? [c.first_name, c.last_name].filter(Boolean).join(" ").trim() ?? null,
          phone: normalizePhone(phone),
          email,
          custom: cf,
        };
      }
      stats.contacts_seen = (stats.contacts_seen ?? 0) + items.length;
      await updateStats(conn.id, stats);
    });

    stats.phase = "leads";
    stats.leads_created = 0;
    stats.leads_skipped = 0;
    stats.leads_seen = 0;
    await updateStats(conn.id, stats);

    await paginate(conn, "/api/v4/leads?with=contacts", async (items) => {
      for (const l of items) {
        stats.leads_seen++;
        // pega primeiro contato vinculado
        const contactRef = l?._embedded?.contacts?.[0];
        const contact = contactRef ? contactById[String(contactRef.id)] : null;
        const phone = contact?.phone ?? null;
        if (!phone) { stats.leads_skipped++; continue; }

        // dedupe por telefone no tenant
        const { data: existing } = await admin.from("leads")
          .select("id")
          .eq("tenant_id", tenantId)
          .filter("whatsapp", "eq", phone)
          .limit(1).maybeSingle();

        let localId: string;
        if (existing?.id) {
          localId = existing.id;
          stats.leads_skipped++;
        } else {
          const st = statusMap[String(l.status_id)];
          const cf = extractCustomFields(l.custom_fields_values ?? [], leadCatalog);
          const extras = {
            kommo_id: l.id,
            kommo_pipeline: st?.pipeline ?? null,
            kommo_status: st?.name ?? null,
            kommo_custom_fields: { ...(contact?.custom ?? {}), ...cf },
            imported_at: new Date().toISOString(),
          };
          const { data: inserted, error } = await admin.from("leads").insert({
            tenant_id: tenantId,
            nome_completo: contact?.name || l.name || phone,
            whatsapp: phone,
            email: contact?.email ?? null,
            status: mapStatus(st?.name),
            origem: "kommo_import",
            valor_proposta: l.price ?? null,
            extras,
          }).select("id").single();
          if (error) { console.warn("insert lead failed", error); continue; }
          localId = inserted.id;
          stats.leads_created++;
        }
        await admin.from("kommo_import_map").upsert({
          tenant_id: tenantId,
          kommo_entity_type: "lead",
          kommo_id: String(l.id),
          local_id: localId,
        }, { onConflict: "tenant_id,kommo_entity_type,kommo_id" });
      }
      await updateStats(conn.id, stats);
    });

    // Fase D — Chats + mensagens (best-effort; nem toda conta tem endpoint /chats habilitado)
    stats.phase = "chats";
    stats.chats_created = 0;
    stats.messages_created = 0;
    await updateStats(conn.id, stats);
    try {
      await paginate(conn, "/api/v4/chats", async (items) => {
        for (const ch of items) {
          const contactId = ch?.contact_id ?? ch?._embedded?.contact?.id;
          const contact = contactId ? contactById[String(contactId)] : null;
          const phone = contact?.phone;
          if (!phone) continue;
          const { data: existingConv } = await admin.from("conversations")
            .select("id").eq("tenant_id", tenantId).eq("telefone", phone).limit(1).maybeSingle();
          let convId = existingConv?.id;
          if (!convId) {
            const { data: newConv } = await admin.from("conversations").insert({
              tenant_id: tenantId,
              telefone: phone,
              nome_contato: contact?.name ?? null,
              provider: "kommo_import",
              ultima_interacao: ch.updated_at ? new Date(ch.updated_at * 1000).toISOString() : new Date().toISOString(),
            }).select("id").single();
            convId = newConv?.id;
            stats.chats_created++;
          }
          if (!convId) continue;

          const msgs = await kommoFetch(conn, `/api/v4/chats/${ch.id}/messages?limit=250`).catch(() => null);
          for (const m of msgs?._embedded?.messages ?? []) {
            const dir = m.type === "outgoing" || m.direction === "out" ? "out" : "in";
            await admin.from("messages").insert({
              conversation_id: convId,
              tenant_id: tenantId,
              sender: dir === "out" ? "clinic" : "contact",
              direction: dir,
              conteudo: String(m.text ?? m.message ?? "").slice(0, 4000),
              tipo: "text",
              lida: true,
              created_at: m.created_at ? new Date(m.created_at * 1000).toISOString() : new Date().toISOString(),
              metadata: { kommo_message_id: m.id, source: "kommo_import" },
            });
            stats.messages_created++;
          }
          await updateStats(conn.id, stats);
        }
      });
    } catch (e) {
      stats.chats_error = String(e).slice(0, 300);
    }

    // Fase E — Tasks + notes
    stats.phase = "tasks";
    stats.tasks_created = 0;
    stats.notes_created = 0;
    await updateStats(conn.id, stats);

    // Mapa kommo_lead_id → local_id
    const { data: leadMap } = await admin.from("kommo_import_map")
      .select("kommo_id, local_id")
      .eq("tenant_id", tenantId)
      .eq("kommo_entity_type", "lead");
    const kommoLeadToLocal: Record<string, string> = {};
    for (const m of leadMap ?? []) kommoLeadToLocal[String(m.kommo_id)] = m.local_id;

    try {
      await paginate(conn, "/api/v4/tasks", async (items) => {
        for (const t of items) {
          if (t.entity_type !== "leads") continue;
          const localLeadId = kommoLeadToLocal[String(t.entity_id)];
          if (!localLeadId) continue;
          await admin.from("lead_tasks").insert({
            tenant_id: tenantId,
            lead_id: localLeadId,
            title: (t.text ?? "Tarefa Kommo").slice(0, 200),
            done: Boolean(t.is_completed),
            due_date: t.complete_till ? new Date(t.complete_till * 1000).toISOString() : null,
          });
          stats.tasks_created++;
        }
        await updateStats(conn.id, stats);
      });
    } catch (e) { stats.tasks_error = String(e).slice(0, 300); }

    // Notes: uma request por lead é caro; usa endpoint global /api/v4/leads/notes
    try {
      await paginate(conn, "/api/v4/leads/notes", async (items) => {
        for (const n of items) {
          const localLeadId = kommoLeadToLocal[String(n.entity_id)];
          if (!localLeadId) continue;
          const text = n.params?.text ?? n.text ?? JSON.stringify(n.params ?? {}).slice(0, 500);
          const cur = await admin.from("leads").select("observacoes").eq("id", localLeadId).maybeSingle();
          const prev = cur.data?.observacoes ?? "";
          const stamped = `[Kommo ${new Date((n.created_at ?? 0) * 1000).toISOString().slice(0,10)}] ${text}`;
          await admin.from("leads").update({ observacoes: (prev ? prev + "\n\n" : "") + stamped }).eq("id", localLeadId);
          stats.notes_created++;
        }
        await updateStats(conn.id, stats);
      });
    } catch (e) { stats.notes_error = String(e).slice(0, 300); }

    stats.phase = "done";
    stats.finished_at = new Date().toISOString();
    await admin.from("kommo_connections").update({
      status: "connected",
      last_import_at: new Date().toISOString(),
      last_import_stats: stats,
    }).eq("id", conn.id);
  } catch (e) {
    stats.phase = "error";
    stats.error = String(e).slice(0, 500);
    await admin.from("kommo_connections").update({
      status: "error",
      last_import_stats: stats,
    }).eq("id", conn.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userRes } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
  const userId = userRes?.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenant_id ?? "");
  if (!tenantId) return json({ error: "tenant_id obrigatório" }, 400);

  const admin = adminClient();
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: userId, _role: "admin" });
  const { data: isTenantAdmin } = await admin.rpc("is_tenant_admin", { _user_id: userId, _tenant_id: tenantId });
  if (!isAdmin && !isTenantAdmin) return json({ error: "Sem permissão" }, 403);

  // @ts-ignore Deno global
  EdgeRuntime.waitUntil(runImport(tenantId));
  return json({ ok: true, started: true });
});
