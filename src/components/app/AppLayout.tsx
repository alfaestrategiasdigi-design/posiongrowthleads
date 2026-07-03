import { ReactNode, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Loader2, LogOut, AlertCircle, Lock, Mail, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/hooks/useTenant";
import TenantSidebar from "./TenantSidebar";
import { Input } from "@/components/ui/input";
import posionLogo from "@/assets/posion/logo-posion.png.asset.json";

export default function AppLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { loading, user, tenant, role, error } = useTenant();
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loginError, setLoginError] = useState("");

  useEffect(() => {
    if (!user) { setIsSuperAdmin(false); return; }
    supabase.from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => setIsSuperAdmin(!!data));
  }, [user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setLoginError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setLoginError("E-mail ou senha incorretos"); setSubmitting(false); return; }
    const { getPostLoginRedirect } = await import("@/lib/auth/post-login-redirect");
    const target = await getPostLoginRedirect();
    setSubmitting(false);
    navigate(target, { replace: true });
  };

  const handleLogout = async () => { await supabase.auth.signOut(); navigate("/"); };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 tech-bg">
        <div className="card-luxe p-8 md:p-10 max-w-md w-full relative z-10">
          <div className="flex flex-col items-center mb-6">
            <img src={posionLogo.url} alt="Posion" className="h-12 mb-5 opacity-95" />
            <div className="hairline w-24 mb-5" />
            <h1 className="font-display text-2xl text-foreground text-center">Central da Clínica</h1>
            <p className="text-muted-foreground text-center text-sm mt-1">Acesse com sua conta</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} className="pl-10 h-11" required />
            </div>
            <div className="relative">
              <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input type="password" placeholder="Senha" value={password} onChange={e => setPassword(e.target.value)} className="pl-10 h-11" required />
            </div>
            {loginError && <div className="flex items-center gap-2 text-destructive text-sm bg-destructive/10 p-3 rounded-lg">
              <AlertCircle className="w-4 h-4" />{loginError}</div>}
            <Button type="submit" className="w-full h-11" disabled={submitting}>
              {submitting && <Loader2 className="w-4 h-4 animate-spin mr-2" />}Entrar
            </Button>
          </form>
          <p className="text-center text-[10px] tracking-[0.2em] uppercase text-muted-foreground mt-8">Powered by Posion Growth</p>
        </div>
      </div>
    );
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
      <div className="min-h-screen flex w-full">
        <TenantSidebar tenant={tenant} isSuperAdmin={isSuperAdmin} tenantRole={role} />
        <main className="flex-1 flex flex-col overflow-hidden">
          <header className="h-16 border-b border-border/60 flex items-center justify-between px-4 md:px-6 bg-card/40 backdrop-blur-md shrink-0">
            <div className="flex items-center gap-3 md:gap-4">
              <SidebarTrigger />
              <div className="hidden md:flex items-center gap-3">
                <img src={posionLogo.url} alt="Posion" className="h-7 opacity-90" />
                <div className="h-5 w-px bg-border" />
                <div className="leading-tight">
                  <div className="text-sm font-medium tracking-tight">{tenant.name}</div>
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Central da Clínica</div>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleLogout} className="gap-2">
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
