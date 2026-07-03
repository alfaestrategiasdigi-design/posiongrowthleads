// Shared helpers for admin-only edge functions.
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export { corsHeaders };

export function serviceClient(): SupabaseClient {
  return createClient(URL_, SERVICE);
}

/** Validates caller is authenticated AND holds global 'admin' role. Returns { user, admin } or a Response to short-circuit. */
export async function requireAdmin(req: Request): Promise<
  { user: { id: string; email?: string }; admin: SupabaseClient } | Response
> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
  const token = auth.slice("Bearer ".length).trim();
  const userClient = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
  // Verify JWT locally via getClaims — avoids /user 403s when a stale session was invalidated
  const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
  const claims = claimsData?.claims as { sub?: string; email?: string } | undefined;
  if (claimsErr || !claims?.sub) return json({ error: "Sessão inválida" }, 401);
  const admin = serviceClient();
  const { data: isAdmin } = await admin.rpc("has_role", { _user_id: claims.sub, _role: "admin" });
  if (!isAdmin) return json({ error: "Apenas Admin Master" }, 403);
  return { user: { id: claims.sub, email: claims.email }, admin };
}

export function randomPassword(len = 12): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let p = "";
  for (let i = 0; i < len; i++) p += chars[arr[i] % chars.length];
  return p;
}
