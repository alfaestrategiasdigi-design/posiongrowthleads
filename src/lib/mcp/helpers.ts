import type { ToolContext } from "@lovable.dev/mcp-js";
import { supabaseForUser } from "./supabase";

export function requireAuth(ctx: ToolContext) {
  if (!ctx.isAuthenticated()) {
    throw new Error("Não autenticado. Conecte-se com sua conta POSION Tools.");
  }
  return supabaseForUser(ctx);
}

export function json(data: unknown, structured?: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

export function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Resolves a tenant slug (e.g. "donna-face") to its id, honoring RLS. */
export async function resolveTenantId(
  supabase: ReturnType<typeof supabaseForUser>,
  tenantSlug: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("slug", tenantSlug.trim().toLowerCase())
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Tenant "${tenantSlug}" não encontrado ou sem acesso.`);
  return data.id as string;
}
