import { ReactNode, useEffect, useState } from "react";
import { Navigate, useNavigate, Link } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, AlertCircle, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import { useUserProfile, initialsFrom } from "@/hooks/useUserProfile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import TenantSidebar from "./TenantSidebar";
import posionLogo from "@/assets/posion/logo-posion.png.asset.json";

export default function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { loading, user, tenant, role, error } = useTenant();
  const { profile } = useUserProfile();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  useEffect(() => {
    if (!user) { setIsSuperAdmin(false); return; }
    supabase.from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => setIsSuperAdmin(!!data));
  }, [user]);

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/login"); };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (error || !tenant) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="bg-card rounded-2xl shadow-2xl p-8 max-w-md w-full text-center border border-border/50">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">{error || "Clínica não encontrada"}</h1>
          <p className="text-muted-foreground mb-6">Você não tem acesso a esta área.</p>
          <Button onClick={handleLogout} variant="outline" className="gap-2">
            <LogOut className="w-4 h-4" /> Sair
          </Button>
        </div>
      </div>
    );
  }

  if (!role && !isSuperAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="bg-card rounded-2xl shadow-2xl p-8 max-w-md w-full text-center border border-border/50">
          <Lock className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Acesso Restrito</h1>
          <p className="text-muted-foreground mb-6">Você não é membro de {tenant.name}.</p>
          <Button onClick={handleLogout} variant="outline" className="gap-2">
            <LogOut className="w-4 h-4" /> Sair
          </Button>
        </div>
      </div>
    );
  }

  const displayName = profile?.full_name || user.email?.split("@")[0] || "Meu perfil";
  const initials = initialsFrom(profile?.full_name, user.email);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full tech-shell">
        <TenantSidebar tenant={tenant} isSuperAdmin={isSuperAdmin} tenantRole={role} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <header className="h-14 tech-header flex items-center px-4 shrink-0 gap-4">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="hidden md:flex items-center gap-3">
              <img src={posionLogo.url} alt="Posion" className="h-6 opacity-90" />
              <span className="tech-pill">
                <span className="tech-dot" /> Sistema operacional
              </span>
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                v2.0 · Posion OS
              </span>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <span className="hidden sm:inline text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground/70">
                {new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase()}
              </span>
              <Link
                to={`/app/${tenant.slug}/perfil`}
                title="Meu perfil"
                className="flex items-center gap-2 rounded-full pl-1 pr-3 py-1 border border-amber-500/25 hover:border-amber-400/60 hover:bg-amber-500/5 transition-colors max-w-[220px]"
              >
                <Avatar className="h-6 w-6 border border-amber-500/40">
                  {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt={displayName} /> : null}
                  <AvatarFallback className="bg-amber-500/15 text-amber-200 text-[10px] font-mono uppercase">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-amber-300/80 truncate">
                  {displayName}
                </span>
              </Link>
              <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-2 text-muted-foreground hover:text-foreground">
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline">Sair</span>
              </Button>
            </div>
          </header>

          <div className="flex-1 overflow-auto">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
