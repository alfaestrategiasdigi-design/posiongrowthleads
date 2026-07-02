// Aceita convite: cria (ou atualiza) usuário, define senha, aplica role global e tenant_role.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { token, password, name } = await req.json();
    if (!token || !password || String(password).length < 8) {
      return json({ error: "token e senha (>=8) obrigatórios" }, 400);
    }
    const admin = createClient(URL_, SERVICE);

    const { data: inv, error: iErr } = await admin
      .from("invites").select("*").eq("token", token).maybeSingle();
    if (iErr) return json({ error: iErr.message }, 400);
    if (!inv) return json({ error: "convite inválido" }, 404);
    if (inv.used_at) return json({ error: "convite já utilizado" }, 400);
    if (new Date(inv.expires_at).getTime() < Date.now()) return json({ error: "convite expirado" }, 400);

    // Cria ou reutiliza usuário
    let userId: string | null = null;
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email: inv.email, password, email_confirm: true,
      user_metadata: { name: name || null },
    });
    if (created?.user) {
      userId = created.user.id;
    } else {
      // pode já existir
      const { data: list } = await admin.auth.admin.listUsers();
      const existing = list?.users.find(u => (u.email || "").toLowerCase() === inv.email.toLowerCase());
      if (!existing) return json({ error: cErr?.message || "não foi possível criar usuário" }, 400);
      userId = existing.id;
      await admin.auth.admin.updateUserById(userId, { password });
    }

    // Aplica role global
    if (inv.role) {
      await admin.from("user_roles").upsert(
        { user_id: userId, role: inv.role },
        { onConflict: "user_id,role" }
      );
    }
    // Aplica tenant_role se convite for de clínica
    if (inv.tenant_id && inv.tenant_role) {
      await admin.from("tenant_users").upsert(
        { tenant_id: inv.tenant_id, user_id: userId, role: inv.tenant_role },
        { onConflict: "tenant_id,user_id" }
      );
    }

    await admin.from("invites").update({ used_at: new Date().toISOString(), used_by: userId }).eq("id", inv.id);

    return json({ ok: true, user_id: userId, email: inv.email });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
