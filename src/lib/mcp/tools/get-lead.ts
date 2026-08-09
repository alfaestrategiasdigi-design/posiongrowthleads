import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, requireAuth } from "../helpers";

export default defineTool({
  name: "get_lead",
  title: "Detalhar lead",
  description:
    "Retorna todos os dados de um lead pelo id, incluindo tarefas e agendamentos vinculados.",
  inputSchema: { lead_id: z.string().describe("UUID do lead") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ lead_id }, ctx) => {
    try {
      const supabase = requireAuth(ctx);
      const { data: lead, error } = await supabase
        .from("leads")
        .select("*")
        .eq("id", lead_id)
        .maybeSingle();
      if (error) return fail(error.message);
      if (!lead) return fail("Lead não encontrado ou sem acesso.");

      const [{ data: tasks }, { data: appointments }] = await Promise.all([
        supabase
          .from("lead_tasks")
          .select("id, title, done, due_date, task_type, scheduled_date, scheduled_time")
          .eq("lead_id", lead_id)
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("appointments")
          .select("id, date_time, status, appointment_type, procedure, notes")
          .eq("lead_id", lead_id)
          .order("date_time", { ascending: false })
          .limit(20),
      ]);

      const payload = { lead, tasks: tasks ?? [], appointments: appointments ?? [] };
      return json(payload, payload);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
});
