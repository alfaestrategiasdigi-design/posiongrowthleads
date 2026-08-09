import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { fail, json, requireAuth, resolveTenantId } from "../helpers";

export default defineTool({
  name: "list_leads",
  title: "Listar leads",
  description:
    "Lista leads de um tenant, com filtro opcional por status/etapa e busca por nome, e-mail ou WhatsApp.",
  inputSchema: {
    tenant_slug: z.string().describe("Slug do tenant, ex: donna-face"),
    status: z.string().optional().describe("Filtrar por status/etapa do lead"),
    search: z.string().optional().describe("Busca por nome, e-mail ou WhatsApp"),
    limit: z.number().int().optional().describe("Máximo de registros (padrão 25, máx 100)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ tenant_slug, status, search, limit }, ctx) => {
    try {
      const supabase = requireAuth(ctx);
      const tenantId = await resolveTenantId(supabase, tenant_slug);
      const take = Math.min(Math.max(limit ?? 25, 1), 100);
      let query = supabase
        .from("leads")
        .select(
          "id, nome_completo, whatsapp, email, nome_empresa, status, origem, valor_proposta, created_at",
        )
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .limit(take);
      if (status) query = query.eq("status", status);
      if (search) {
        const term = `%${search}%`;
        query = query.or(
          `nome_completo.ilike.${term},email.ilike.${term},whatsapp.ilike.${term},nome_empresa.ilike.${term}`,
        );
      }
      const { data, error } = await query;
      if (error) return fail(error.message);
      return json(data ?? [], { leads: data ?? [] });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  },
});
