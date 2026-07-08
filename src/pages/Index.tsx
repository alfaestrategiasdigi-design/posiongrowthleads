import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { getPostLoginRedirect } from "@/lib/auth/post-login-redirect";
import { trackView, getFbCookies } from "@/lib/tracking/capi";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";

export default function Index() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Capture fbclid → _fbc and fire ViewContent (server-side CAPI + Pixel)
    getFbCookies();
    trackView({ tenantSlug: "public", contentName: "Central do Cliente" });

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
            Posion OS · Área Restrita
          </span>
        </div>

        <div className="rounded-2xl border border-white/10 bg-black p-8 shadow-2xl">
          <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-5">
            <Lock className="w-5 h-5 text-white/80" />
          </div>
          <h1 className="text-center text-2xl font-semibold text-white mb-2">
            Central do Cliente
          </h1>
          <p className="text-center text-sm text-white/50 mb-7 leading-relaxed">
            Acesso exclusivo para clínicas parceiras, equipe de suporte Posion.
          </p>

          <Button
            onClick={() => navigate("/login")}
            className="w-full h-11 bg-white text-black hover:bg-white/90 font-semibold"
          >
            <ShieldCheck className="w-4 h-4 mr-2" />
            Entrar na plataforma
          </Button>
        </div>

        <p className="mt-6 text-center text-[10px] font-mono uppercase tracking-[0.25em] text-white/30">
          Sessão criptografada · TLS 1.3
        </p>
      </div>
    </div>
  );
}
