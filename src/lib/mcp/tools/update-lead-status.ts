import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, requireAuth } from "../helpers";

export default defineTool({
  name: "update_lead_status",
  title: "Mover lead no funil",
  description:
    "Atualiza o status/etapa de um lead no Kanban. Use list_pipeline_stages para descobrir os status válidos.",
  inputSchema: {
    lead_id: z.string().describe("UUID do lead"),
    status: z.string().describe("Novo status/stage_key"),
    motivo_perda: z.string().optional().describe("Motivo da perda, quando mover para perdido"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ lead_id, status, motivo_perda }, ctx) => {
    try {
      const supabase = requireAuth(ctx);
      const { data, error } = await supabase
        .from("leads")
        .update({ status, ...(motivo_perda ? { motivo_perda } : {}) })
        .eq("id", lead_id)
        .select("id, nome_completo, status, motivo_perda")
        .maybeSingle();
      if (error) return fail(error.message);
      if (!data) return fail("Lead não encontrado ou sem permissão de escrita.");
      return json(data, { lead: data });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
});
