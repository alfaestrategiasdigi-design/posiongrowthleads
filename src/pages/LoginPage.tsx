import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { AlertCircle, KeyRound, Loader2, Mail, ArrowRight } from "lucide-react";
import { getPostLoginRedirect } from "@/lib/auth/post-login-redirect";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";

const PALETTE = {
  bg: "#FAF8F3",
  header: "#14120D",
  text: "#16140D",
  gold: "#C9A227",
  goldLight: "#F0CD6E",
  card: "#FFFFFF",
  soft: "#F4F1E8",
  border: "#E7E1D1",
  muted: "#6B6455",
};
const FONT_SANS = "'DM Sans', system-ui, -apple-system, sans-serif";
const FONT_MONO = "'Space Mono', ui-monospace, monospace";

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);

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
      <div className="min-h-screen flex items-center justify-center" style={{ background: PALETTE.bg }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: PALETTE.gold }} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: PALETTE.bg, color: PALETTE.text, fontFamily: FONT_SANS }}
    >
      <header
        className="w-full"
        style={{ background: "transparent" }}
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-3 opacity-90 hover:opacity-100 transition"
          >
            <img src={logoAsset.url} alt="POSION" className="h-7 w-auto" />
            <span
              className="hidden sm:inline text-[10px] uppercase"
              style={{ fontFamily: FONT_MONO, letterSpacing: "0.24em", color: PALETTE.muted }}
            >
              POSION Tools
            </span>
          </button>
          <span
            className="text-[10px] uppercase hidden sm:inline"
            style={{ fontFamily: FONT_MONO, letterSpacing: "0.24em", color: PALETTE.muted }}
          >
            Área restrita
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="flex flex-col items-center mb-6">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
              style={{
                background: PALETTE.card,
                border: `1px solid ${PALETTE.border}`,
                boxShadow: "0 12px 28px -20px rgba(20,18,13,0.25)",
              }}
            >
              <img src={logoAsset.url} alt="POSION" className="h-6 w-auto" />
            </div>
            <span
              className="text-[10px] uppercase"
              style={{ fontFamily: FONT_MONO, letterSpacing: "0.26em", color: PALETTE.gold }}
            >
              POSION Tools · Acesso
            </span>
          </div>

          <div
            className="rounded-3xl p-8"
            style={{
              background: PALETTE.card,
              border: `1px solid ${PALETTE.border}`,
              boxShadow:
                "0 1px 0 rgba(20,18,13,0.02), 0 24px 60px -28px rgba(20,18,13,0.22)",
            }}
          >
            <h1
              className="text-center text-[26px] font-semibold tracking-tight mb-1"
              style={{ color: PALETTE.text }}
            >
              Entrar
            </h1>
            <p className="text-center text-sm mb-7" style={{ color: PALETTE.muted }}>
              Não compartilhe seu login com ninguém.
            </p>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label
                  className="text-[10px] uppercase mb-1.5 block"
                  style={{ fontFamily: FONT_MONO, letterSpacing: "0.22em", color: PALETTE.muted }}
                >
                  E-mail
                </label>
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: PALETTE.muted }}
                  />
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="seu@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="pl-10 h-11 rounded-xl"
                    style={{
                      background: PALETTE.soft,
                      border: `1px solid ${PALETTE.border}`,
                      color: PALETTE.text,
                      fontFamily: FONT_SANS,
                    }}
                  />
                </div>
              </div>

              <div>
                <label
                  className="text-[10px] uppercase mb-1.5 block"
                  style={{ fontFamily: FONT_MONO, letterSpacing: "0.22em", color: PALETTE.muted }}
                >
                  Senha
                </label>
                <div className="relative">
                  <KeyRound
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: PALETTE.muted }}
                  />
                  <Input
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pl-10 h-11 rounded-xl"
                    style={{
                      background: PALETTE.soft,
                      border: `1px solid ${PALETTE.border}`,
                      color: PALETTE.text,
                      fontFamily: FONT_SANS,
                    }}
                  />
                </div>
              </div>

              {error && (
                <div
                  className="flex items-center gap-2 text-sm p-3 rounded-xl"
                  style={{
                    background: "#FBE9E7",
                    border: "1px solid #F1BAB0",
                    color: "#8A2A1A",
                  }}
                >
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-12 rounded-full inline-flex items-center justify-center gap-2 text-[15px] font-semibold transition-all hover:-translate-y-0.5 disabled:opacity-70 disabled:cursor-not-allowed"
                style={{
                  background: PALETTE.goldLight,
                  color: PALETTE.header,
                  boxShadow: "0 8px 24px -12px rgba(201,162,39,0.55)",
                }}
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {submitting ? "Autenticando..." : "Entrar"}
              </button>
            </form>
          </div>

          <p
            className="mt-6 text-center text-[10px] uppercase"
            style={{ fontFamily: FONT_MONO, letterSpacing: "0.26em", color: PALETTE.muted }}
          >
            Sessão criptografada · TLS 1.3
          </p>
        </div>
      </main>
    </div>
  );
}
