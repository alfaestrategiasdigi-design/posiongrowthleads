import { useState, useEffect, ReactNode } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import AdminErrorBoundary from "./AdminErrorBoundary";
import ReconnectFacebookDialog from "@/components/facebook/ReconnectFacebookDialog";
import { Loader2, AlertCircle, LogOut, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getPostLoginRedirect } from "@/lib/auth/post-login-redirect";
import type { User } from "@supabase/supabase-js";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";


interface AdminLayoutProps {
  children: ReactNode;
}

const AdminLayout = ({ children }: AdminLayoutProps) => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const MASTER_TENANT_ID = "00000000-0000-0000-0000-000000000001";
    const resolve = async (sessionUser: User | null) => {
      setUser(sessionUser);
      if (!sessionUser) { setIsAdmin(false); setIsLoading(false); return; }
      const [{ data: roles }, { data: link }] = await Promise.all([
        supabase.from("user_roles").select("role")
          .eq("user_id", sessionUser.id)
          .in("role", ["admin", "comercial_admin_master"]),
        supabase.from("tenant_users").select("tenant_id,active")
          .eq("user_id", sessionUser.id)
          .eq("tenant_id", MASTER_TENANT_ID)
          .eq("active", true)
          .maybeSingle(),
      ]);
      const admin = !!((roles && roles.length > 0) || link);

      setIsAdmin(admin);
      setIsLoading(false);
      if (!admin) {
        const target = await getPostLoginRedirect();
        if (target.startsWith("/app/")) navigate(target, { replace: true });
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      resolve(session?.user ?? null);
    });
    supabase.auth.getSession().then(({ data: { session } }) => resolve(session?.user ?? null));
    return () => subscription.unsubscribe();
  }, [navigate]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }


  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--destructive)/0.08),transparent_60%)] pointer-events-none" />
        <div className="relative bg-card/60 backdrop-blur-xl rounded-2xl shadow-2xl p-8 max-w-md w-full text-center border border-destructive/30">
          <div className="w-16 h-16 bg-destructive/10 border border-destructive/30 rounded-full flex items-center justify-center mx-auto mb-6">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>Acesso Restrito</h1>
          <p className="text-muted-foreground mb-6">Você não tem permissão para acessar esta área.</p>
          <Button onClick={handleLogout} variant="outline" className="gap-2 border-primary/30 hover:bg-primary/10">
            <LogOut className="w-4 h-4" /> Sair
          </Button>
        </div>
      </div>
    );
  }

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full tech-shell">
        <AppSidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          <header className="h-14 tech-header flex items-center px-4 shrink-0 gap-4">
            <SidebarTrigger className="text-muted-foreground hover:text-foreground" />
            <div className="hidden md:flex items-center gap-3">
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
              <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-cyan-300/70 truncate max-w-[180px]">
                {user.email}
              </span>
            </div>
          </header>
          <div className="flex-1 overflow-auto">
            <AdminErrorBoundary>{children}</AdminErrorBoundary>
          </div>
        </main>
        <ReconnectFacebookDialog />
      </div>
    </SidebarProvider>
  );
};

export default AdminLayout;
