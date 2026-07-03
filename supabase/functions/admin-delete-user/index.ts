import { json, requireAdmin, corsHeaders } from "../_shared/admin-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { admin, user: caller } = auth;

    const body = await req.json().catch(() => ({}));
    const userId = body.user_id ? String(body.user_id) : null;
    if (!userId) return json({ error: "user_id obrigatório" }, 400);
    if (userId === caller.id) return json({ error: "você não pode excluir a si mesmo" }, 400);

    await admin.from("tenant_users").delete().eq("user_id", userId);
    await admin.from("user_roles").delete().eq("user_id", userId);
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
