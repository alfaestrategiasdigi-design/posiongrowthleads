import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { AlertCircle, CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { getPostLoginRedirect } from "@/lib/auth/post-login-redirect";
import { withAuthTimeout } from "@/lib/auth/session-guard";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";

const PALETTE = {
  bg: "#0A0908",
  bgSoft: "#14120D",
  card: "#17150F",
  cardSoft: "#1F1C15",
  text: "#F6F3EA",
  muted: "#8A8272",
  border: "#2A2620",
  gold: "#C9A227",
  goldLight: "#F0CD6E",
};
const FONT_SANS = "'DM Sans', system-ui, -apple-system, sans-serif";
const FONT_MONO = "'Space Mono', ui-monospace, monospace";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let alive = true;

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      if (session?.user) {
        setHasSession(true);
        setReady(true);
      }
    });

    (async () => {
      try {
        const { data } = await withAuthTimeout(supabase.auth.getSession());
        if (!alive) return;
        setHasSession(Boolean(data.session?.user));
      } catch {
        if (alive) setHasSession(false);
      } finally {
        if (alive) setReady(true);
      }
    })();

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: err } = await withAuthTimeout(supabase.auth.updateUser({ password }));
      if (err) {
        setError(err.message || "Não foi possível atualizar a senha.");
        setSubmitting(false);
        return;
      }
      // Sessão já está atualizada pelo Supabase após updateUser.
      setDone(true);
      const target = await getPostLoginRedirect();
      setTimeout(() => navigate(target, { replace: true }), 1200);
    } catch {
      setError("Não foi possível conectar ao servidor. Tente novamente em instantes.");
      setSubmitting(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-12"
      style={{ background: PALETTE.bg, color: PALETTE.text, fontFamily: FONT_SANS }}
    >
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <img src={logoAsset.url} alt="POSION" className="h-12 w-auto object-contain mb-4" />
          <span
            className="text-[10px] uppercase"
            style={{ fontFamily: FONT_MONO, letterSpacing: "0.32em", color: PALETTE.gold }}
          >
            Redefinir senha
          </span>
        </div>

        <div
          className="rounded-3xl p-8"
          style={{
            background: `linear-gradient(180deg, ${PALETTE.card} 0%, ${PALETTE.bgSoft} 100%)`,
            border: `1px solid ${PALETTE.border}`,
          }}
        >
          {!ready ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: PALETTE.gold }} />
            </div>
          ) : done ? (
            <div className="text-center space-y-3 py-4">
              <CheckCircle2 className="w-8 h-8 mx-auto" style={{ color: PALETTE.gold }} />
              <p className="text-sm" style={{ color: PALETTE.text }}>
                Senha atualizada! Redirecionando para o seu painel...
              </p>
            </div>
          ) : !hasSession ? (
            <div className="space-y-4 text-center">
              <p className="text-sm" style={{ color: PALETTE.muted }}>
                Este link expirou ou é inválido. Peça um novo e-mail de recuperação na tela de login.
              </p>
              <button
                onClick={() => navigate("/login", { replace: true })}
                className="w-full h-11 rounded-full font-semibold"
                style={{
                  background: `linear-gradient(180deg, ${PALETTE.goldLight} 0%, ${PALETTE.gold} 100%)`,
                  color: "#14120D",
                }}
              >
                Voltar ao login
              </button>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label
                  className="text-[10px] uppercase mb-1.5 block"
                  style={{ fontFamily: FONT_MONO, letterSpacing: "0.22em", color: PALETTE.muted }}
                >
                  Nova senha
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: PALETTE.muted }} />
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pl-10 h-11 rounded-xl focus-visible:ring-0 focus-visible:ring-offset-0"
                    style={{ background: PALETTE.cardSoft, border: `1px solid ${PALETTE.border}`, color: PALETTE.text }}
                  />
                </div>
              </div>

              <div>
                <label
                  className="text-[10px] uppercase mb-1.5 block"
                  style={{ fontFamily: FONT_MONO, letterSpacing: "0.22em", color: PALETTE.muted }}
                >
                  Confirmar senha
                </label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: PALETTE.muted }} />
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    required
                    className="pl-10 h-11 rounded-xl focus-visible:ring-0 focus-visible:ring-offset-0"
                    style={{ background: PALETTE.cardSoft, border: `1px solid ${PALETTE.border}`, color: PALETTE.text }}
                  />
                </div>
              </div>

              {error && (
                <div
                  className="flex items-center gap-2 text-sm p-3 rounded-xl"
                  style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.35)", color: "#FCA5A5" }}
                >
                  <AlertCircle className="w-4 h-4" /> {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full h-12 rounded-full inline-flex items-center justify-center gap-2 font-semibold disabled:opacity-70"
                style={{
                  background: `linear-gradient(180deg, ${PALETTE.goldLight} 0%, ${PALETTE.gold} 100%)`,
                  color: "#14120D",
                }}
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {submitting ? "Salvando..." : "Salvar nova senha"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
