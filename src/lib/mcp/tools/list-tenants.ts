import { defineTool } from "@lovable.dev/mcp-js";
import { fail, json, requireAuth } from "../helpers";

export default defineTool({
  name: "list_tenants",
  title: "Listar clientes (tenants)",
  description: "Lista os tenants/clientes que o usuário conectado pode acessar, com slug, nome, plano e status.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    try {
      const supabase = requireAuth(ctx);
      const { data, error } = await supabase
        .from("tenants")
        .select("id, slug, name, plan, status, segment, business_type")
        .order("name");
      if (error) return fail(error.message);
      return json(data ?? [], { tenants: data ?? [] });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
});
