import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, requireAuth, resolveTenantId } from "../helpers";

export default defineTool({
  name: "create_task",
  title: "Criar tarefa para um lead",
  description: "Cria uma tarefa vinculada a um lead do tenant informado.",
  inputSchema: {
    tenant_slug: z.string().describe("Slug do tenant"),
    lead_id: z.string().describe("UUID do lead"),
    title: z.string().describe("Título da tarefa"),
    due_date: z.string().optional().describe("Vencimento em ISO, ex: 2026-08-15T14:00:00Z"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ tenant_slug, lead_id, title, due_date }, ctx) => {
    try {
      const supabase = requireAuth(ctx);
      const tenantId = await resolveTenantId(supabase, tenant_slug);
      const { data, error } = await supabase
        .from("lead_tasks")
        .insert({
          tenant_id: tenantId,
          lead_id,
          title,
          due_date: due_date ?? null,
          created_by: ctx.getUserId(),
        })
        .select("id, title, done, due_date, lead_id")
        .maybeSingle();
      if (error) return fail(error.message);
      return json(data, { task: data });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
});
