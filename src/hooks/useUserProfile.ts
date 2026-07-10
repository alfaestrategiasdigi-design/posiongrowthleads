import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";

export interface UserProfile {
  user_id: string;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
}

export function useUserProfile() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (u: User | null) => {
    setUser(u);
    if (!u) { setProfile(null); setLoading(false); return; }
    const { data } = await supabase
      .from("user_profiles")
      .select("user_id,full_name,phone,avatar_url")
      .eq("user_id", u.id)
      .maybeSingle();
    setProfile((data as UserProfile) ?? { user_id: u.id, full_name: null, phone: null, avatar_url: null });
    setLoading(false);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => load(session?.user ?? null));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => load(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, [load]);

  const refresh = useCallback(() => {
    if (user) load(user);
  }, [user, load]);

  return { user, profile, loading, refresh };
}

export function initialsFrom(name?: string | null, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
