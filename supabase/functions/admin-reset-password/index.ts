import { json, requireAdmin, randomPassword, corsHeaders } from "../_shared/admin-auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;
    const { admin } = auth;

    const body = await req.json().catch(() => ({}));
    const userId = body.user_id ? String(body.user_id) : null;
    const password = String(body.password || "").trim() || randomPassword(12);
    if (!userId) return json({ error: "user_id obrigatório" }, 400);
    if (password.length < 8) return json({ error: "senha deve ter 8+ caracteres" }, 400);

    const { error } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true, user_id: userId, password });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
