import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, requireAuth, resolveTenantId } from "../helpers";

export default defineTool({
  name: "list_pipeline_stages",
  title: "Listar etapas do funil",
  description: "Lista as etapas configuradas do Kanban de um tenant (stage_key, título, ordem).",
  inputSchema: { tenant_slug: z.string().describe("Slug do tenant") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ tenant_slug }, ctx) => {
    try {
      const supabase = requireAuth(ctx);
      const tenantId = await resolveTenantId(supabase, tenant_slug);
      const { data, error } = await supabase
        .from("pipeline_stages")
        .select("stage_key, title, short, hex, position, is_system")
        .eq("tenant_id", tenantId)
        .order("position");
      if (error) return fail(error.message);
      return json(data ?? [], { stages: data ?? [] });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
});
