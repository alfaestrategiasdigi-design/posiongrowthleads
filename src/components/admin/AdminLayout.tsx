import { useState, useEffect, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import AppSidebar from "./AppSidebar";
import AdminErrorBoundary from "./AdminErrorBoundary";
import ReconnectFacebookDialog from "@/components/facebook/ReconnectFacebookDialog";
import { Loader2, Lock, AlertCircle, LogOut, Mail, KeyRound, Sparkles, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

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
      // Tenant user que caiu no /admin → redireciona ao seu painel
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("E-mail ou senha incorretos");
    setIsLoggingIn(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 relative overflow-hidden">
        {/* Decorative background */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(var(--primary)/0.12),transparent_60%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom,hsl(var(--primary)/0.08),transparent_55%)]" />
          <div className="absolute inset-0 opacity-[0.04] bg-[linear-gradient(hsl(var(--primary))_1px,transparent_1px),linear-gradient(90deg,hsl(var(--primary))_1px,transparent_1px)] bg-[size:48px_48px]" />
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
        </div>

        <div className="relative w-full max-w-md animate-scale-in">
          <div className="flex flex-col items-center mb-6">
            <img src={logoAsset.url} alt="Posion" className="h-12 w-auto mb-4 drop-shadow-[0_0_20px_hsl(var(--primary)/0.5)]" />
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.25em] text-primary/80">
              <Sparkles className="w-3 h-3" /> Posion OS · v2.0
            </span>
          </div>

          <div className="relative rounded-2xl border border-primary/20 bg-card/60 backdrop-blur-xl p-8 md:p-10 shadow-[0_30px_80px_-20px_hsl(var(--primary)/0.35)]">
            <div className="absolute inset-0 rounded-2xl pointer-events-none ring-1 ring-inset ring-primary/10" />
            <div className="relative">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/30 to-primary/5 border border-primary/30 flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_hsl(var(--primary)/0.4)]">
                <Lock className="w-6 h-6 text-primary" />
              </div>
              <h1 className="gold-gradient-text text-center text-3xl font-bold tracking-tight mb-1" style={{ fontFamily: "'Fraunces', Georgia, serif" }}>
                Área Administrativa
              </h1>
              <p className="text-muted-foreground text-center text-sm mb-7">
                Acesso restrito · Posion Growth System
              </p>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/80 mb-1.5 block">E-mail</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/60" />
                    <Input type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} className="pl-10 bg-background/40 border-primary/20 focus-visible:ring-primary/40 focus-visible:border-primary/40 h-11" required />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary/80 mb-1.5 block">Senha</label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary/60" />
                    <Input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className="pl-10 bg-background/40 border-primary/20 focus-visible:ring-primary/40 focus-visible:border-primary/40 h-11" required />
                  </div>
                </div>
                {error && (
                  <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 border border-destructive/30 p-3 rounded-lg">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                  </div>
                )}
                <Button
                  type="submit"
                  disabled={isLoggingIn}
                  className="w-full h-11 bg-gradient-to-r from-[hsl(var(--gold-deep))] via-[hsl(var(--gold))] to-[hsl(var(--gold-bright))] text-primary-foreground font-semibold tracking-wide hover:opacity-95 hover:shadow-[0_0_30px_hsl(var(--primary)/0.5)] transition-all"
                >
                  {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                  {isLoggingIn ? "Autenticando..." : "Acessar painel"}
                </Button>
              </form>

              <p className="mt-6 text-center text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground/60">
                Sessão criptografada · TLS 1.3
              </p>
            </div>
          </div>
        </div>
      </div>
    );
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
