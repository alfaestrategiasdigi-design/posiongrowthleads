import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, requireAuth, resolveTenantId } from "../helpers";

export default defineTool({
  name: "list_tasks",
  title: "Listar tarefas",
  description: "Lista tarefas de leads de um tenant, com filtro de pendentes/concluídas.",
  inputSchema: {
    tenant_slug: z.string().describe("Slug do tenant"),
    done: z.boolean().optional().describe("true = concluídas, false = pendentes"),
    limit: z.number().int().optional().describe("Máximo de registros (padrão 50, máx 200)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ tenant_slug, done, limit }, ctx) => {
    try {
      const supabase = requireAuth(ctx);
      const tenantId = await resolveTenantId(supabase, tenant_slug);
      const take = Math.min(Math.max(limit ?? 50, 1), 200);
      let query = supabase
        .from("lead_tasks")
        .select("id, lead_id, title, done, due_date, task_type, scheduled_date, scheduled_time, phone")
        .eq("tenant_id", tenantId)
        .order("due_date", { ascending: true, nullsFirst: false })
        .limit(take);
      if (typeof done === "boolean") query = query.eq("done", done);
      const { data, error } = await query;
      if (error) return fail(error.message);
      return json(data ?? [], { tasks: data ?? [] });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
});
