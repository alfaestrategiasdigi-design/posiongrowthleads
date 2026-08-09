import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, requireAuth, resolveTenantId } from "../helpers";

export default defineTool({
  name: "list_appointments",
  title: "Listar agendamentos",
  description: "Lista agendamentos de um tenant em um intervalo de datas.",
  inputSchema: {
    tenant_slug: z.string().describe("Slug do tenant"),
    from: z.string().optional().describe("Data inicial ISO, ex: 2026-08-01"),
    to: z.string().optional().describe("Data final ISO, ex: 2026-08-31"),
    status: z.string().optional().describe("Filtrar por status do agendamento"),
    limit: z.number().int().optional().describe("Máximo de registros (padrão 50, máx 200)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ tenant_slug, from, to, status, limit }, ctx) => {
    try {
      const supabase = requireAuth(ctx);
      const tenantId = await resolveTenantId(supabase, tenant_slug);
      const take = Math.min(Math.max(limit ?? 50, 1), 200);
      let query = supabase
        .from("appointments")
        .select(
          "id, lead_id, client_name, client_phone, date_time, status, appointment_type, procedure, channel",
        )
        .eq("tenant_id", tenantId)
        .order("date_time", { ascending: true })
        .limit(take);
      if (from) query = query.gte("date_time", from);
      if (to) query = query.lte("date_time", to);
      if (status) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) return fail(error.message);
      return json(data ?? [], { appointments: data ?? [] });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
});
