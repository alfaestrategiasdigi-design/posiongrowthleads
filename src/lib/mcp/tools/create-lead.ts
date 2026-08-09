import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, requireAuth, resolveTenantId } from "../helpers";

export default defineTool({
  name: "create_lead",
  title: "Criar lead",
  description: "Cria um novo lead no tenant informado.",
  inputSchema: {
    tenant_slug: z.string().describe("Slug do tenant, ex: donna-face"),
    nome_completo: z.string().describe("Nome completo do lead"),
    whatsapp: z.string().optional().describe("WhatsApp com DDD"),
    email: z.string().optional(),
    nome_empresa: z.string().optional(),
    origem: z.string().optional().describe("Origem do lead, ex: indicacao, instagram"),
    status: z.string().optional().describe("Etapa inicial no funil"),
    observacoes: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    try {
      const supabase = requireAuth(ctx);
      const tenantId = await resolveTenantId(supabase, input.tenant_slug);
      const { tenant_slug: _slug, ...fields } = input;
      const { data, error } = await supabase
        .from("leads")
        .insert({ ...fields, tenant_id: tenantId })
        .select("id, nome_completo, whatsapp, status, created_at")
        .maybeSingle();
      if (error) return fail(error.message);
      return json(data, { lead: data });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
});
