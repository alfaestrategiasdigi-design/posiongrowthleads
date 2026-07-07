import { ReactNode, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, AlertCircle, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import TenantSidebar from "./TenantSidebar";
import posionLogo from "@/assets/posion/logo-posion.png.asset.json";

export default function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { loading, user, tenant, role, error } = useTenant();
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

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full tech-shell">
        <TenantSidebar tenant={tenant} isSuperAdmin={isSuperAdmin} tenantRole={role} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <header className="h-16 tech-header flex items-center justify-between px-4 md:px-6 shrink-0">
            <div className="flex items-center gap-3 md:gap-4">
              <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
              <div className="hidden md:flex items-center gap-3">
                <img src={posionLogo.url} alt="Posion" className="h-7 opacity-90" />
                <div className="h-5 w-px bg-amber-500/25" />
                <div className="leading-tight">
                  <div className="text-sm font-medium tracking-tight text-white" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>{tenant.name}</div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-amber-400/70 font-mono">Central da Clínica</div>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-2 text-muted-foreground hover:text-foreground">
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sair</span>
            </Button>
          </header>

          <div className="flex-1 overflow-auto">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
