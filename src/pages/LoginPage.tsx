import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AlertCircle, KeyRound, Loader2, Lock, Mail, ShieldCheck } from "lucide-react";
import { getPostLoginRedirect } from "@/lib/auth/post-login-redirect";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

  // Se já estiver logado, redireciona
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!alive) return;
      if (session?.user) {
        const target = await getPostLoginRedirect();
        navigate(target, { replace: true });
        return;
      }
      setChecking(false);
    })();
    return () => { alive = false; };
  }, [navigate]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true); setError("");
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (err) {
      setError("E-mail ou senha incorretos");
      setSubmitting(false);
      return;
    }
    const target = await getPostLoginRedirect();
    setSubmitting(false);
    navigate(target, { replace: true });
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-white/60" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src={logoAsset.url} alt="Posion" className="h-12 w-auto mb-3" />
          <span className="text-[10px] font-mono uppercase tracking-[0.25em] text-white/50">
            Posion OS · Acesso unificado
          </span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black p-8 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
            <Lock className="w-5 h-5 text-white/80" />
          </div>
          <h1 className="text-center text-2xl font-semibold text-white mb-1">Entrar</h1>
          <p className="text-center text-sm text-white/50 mb-6">
            Válido para todas as contas: Admin Master, Agência e Clínicas.
          </p>

          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50 mb-1.5 block">
                E-mail
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 h-11 bg-black border-white/15 text-white placeholder:text-white/30 focus-visible:ring-white/30"
                  required
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/50 mb-1.5 block">
                Senha
              </label>
              <div className="relative">
                <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                <Input
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 h-11 bg-black border-white/15 text-white placeholder:text-white/30 focus-visible:ring-white/30"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/30 p-3 rounded-lg">
                <AlertCircle className="w-4 h-4" /> {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={submitting}
              className="w-full h-11 bg-white text-black hover:bg-white/90 font-semibold"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
              {submitting ? "Autenticando..." : "Entrar"}
            </Button>
          </form>
        </div>

        <p className="mt-6 text-center text-[10px] font-mono uppercase tracking-[0.25em] text-white/30">
          Sessão criptografada · TLS 1.3
        </p>
      </div>
    </div>
  );
}
