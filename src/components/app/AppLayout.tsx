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
import ThemeToggle from "@/components/ui/ThemeToggle";
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
          <div className="flex-1 overflow-auto">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
