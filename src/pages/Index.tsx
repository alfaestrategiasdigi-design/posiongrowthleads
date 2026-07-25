import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowRight,
  Loader2,
  KanbanSquare,
  Users,
  MessageCircle,
  BarChart3,
  FileSignature,
  Workflow,
} from "lucide-react";
import { getPostLoginRedirect } from "@/lib/auth/post-login-redirect";
import { trackView, getFbCookies } from "@/lib/tracking/capi";
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

const MODULES = [
  {
    icon: KanbanSquare,
    title: "Pipeline Agência",
    desc: "Kanban comercial da POSION com estágios de qualificação, proposta, negociação, ganho e perdido.",
  },
  {
    icon: Users,
    title: "Leads",
    desc: "Captura, roteamento e qualificação de leads por formulário, Meta Ads e importações.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp Master",
    desc: "Conversas unificadas por clínica, com IA, automações e múltiplos números conectados.",
  },
  {
    icon: BarChart3,
    title: "Relatórios",
    desc: "Dashboards de desempenho por clínica, funil de conversão, ROI de campanhas e receita.",
  },
  {
    icon: FileSignature,
    title: "Contratos",
    desc: "Ciclo de vida de contratos e assinaturas SaaS, do fechamento à renovação.",
  },
  {
    icon: Workflow,
    title: "Automações",
    desc: "Fluxos automáticos de mensagens, tarefas e follow-up sincronizados com o pipeline.",
  },
];

export default function Index() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    getFbCookies();
    trackView({ tenantSlug: "public", contentName: "POSION Tools" });

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
      <div className="min-h-screen flex items-center justify-center" style={{ background: PALETTE.bg }}>
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: PALETTE.gold }} />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen"
      style={{ background: PALETTE.bg, color: PALETTE.text, fontFamily: FONT_SANS }}
    >
      {/* Header escuro */}
      <header
        className="w-full"
        style={{ background: PALETTE.header, borderBottom: `1px solid ${PALETTE.gold}33` }}
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logoAsset.url} alt="POSION" className="h-7 w-auto" />
            <span
              className="hidden sm:inline text-[10px] uppercase"
              style={{ fontFamily: FONT_MONO, letterSpacing: "0.24em", color: "#F0CD6EAA" }}
            >
              POSION Tools
            </span>
          </div>
          <button
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-full text-sm font-semibold transition-all hover:-translate-y-0.5 hover:shadow-lg"
            style={{
              background: PALETTE.goldLight,
              color: PALETTE.header,
              boxShadow: "0 2px 0 rgba(0,0,0,0.05)",
            }}
          >
            Acessar plataforma <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-6 pt-20 pb-16">
        <span
          className="inline-block mb-6 text-[11px] uppercase"
          style={{
            fontFamily: FONT_MONO,
            letterSpacing: "0.28em",
            color: PALETTE.gold,
          }}
        >
          Plataforma Operacional POSION
        </span>
        <h1
          className="max-w-3xl font-semibold tracking-tight leading-[1.05] text-[44px] sm:text-[56px] md:text-[64px]"
          style={{ color: PALETTE.text }}
        >
          O sistema que operacionaliza toda a rotina comercial da POSION.
        </h1>
        <p
          className="mt-6 max-w-2xl text-lg leading-relaxed"
          style={{ color: PALETTE.muted }}
        >
          POSION Tools é a plataforma interna onde equipe, clínicas parceiras e gestores
          acompanham pipeline de vendas, leads, WhatsApp com IA, contratos, automações e
          relatórios — em um só lugar, com um dashboard dedicado por clínica.
        </p>

        <div className="mt-10 flex flex-wrap items-center gap-4">
          <button
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-2 h-12 px-7 rounded-full text-[15px] font-semibold transition-all hover:-translate-y-0.5"
            style={{
              background: PALETTE.goldLight,
              color: PALETTE.header,
              boxShadow: "0 8px 24px -12px rgba(201,162,39,0.55), 0 2px 0 rgba(0,0,0,0.04)",
            }}
          >
            Entrar na plataforma <ArrowRight className="w-4 h-4" />
          </button>
          <span
            className="text-[11px] uppercase"
            style={{
              fontFamily: FONT_MONO,
              letterSpacing: "0.24em",
              color: PALETTE.muted,
            }}
          >
            Acesso restrito · equipe e clínicas parceiras
          </span>
        </div>
      </section>

      {/* Divisor */}
      <div className="max-w-6xl mx-auto px-6">
        <div className="h-px w-full" style={{ background: PALETTE.border }} />
      </div>

      {/* Módulos */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="mb-12">
          <span
            className="text-[11px] uppercase"
            style={{
              fontFamily: FONT_MONO,
              letterSpacing: "0.28em",
              color: PALETTE.gold,
            }}
          >
            Módulos
          </span>
          <h2
            className="mt-3 text-3xl sm:text-4xl font-semibold tracking-tight"
            style={{ color: PALETTE.text }}
          >
            Tudo que a operação POSION precisa, integrado.
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {MODULES.map(({ icon: Icon, title, desc }) => (
            <article
              key={title}
              className="rounded-2xl p-6 transition-all hover:-translate-y-0.5"
              style={{
                background: PALETTE.card,
                border: `1px solid ${PALETTE.border}`,
                boxShadow:
                  "0 1px 0 rgba(20,18,13,0.02), 0 12px 28px -22px rgba(20,18,13,0.18)",
              }}
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center mb-5"
                style={{
                  background: PALETTE.soft,
                  color: PALETTE.gold,
                  border: `1px solid ${PALETTE.border}`,
                }}
              >
                <Icon className="w-5 h-5" />
              </div>
              <h3
                className="text-lg font-semibold mb-2"
                style={{ color: PALETTE.text }}
              >
                {title}
              </h3>
              <p className="text-sm leading-relaxed" style={{ color: PALETTE.muted }}>
                {desc}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* CTA final */}
      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div
          className="rounded-3xl p-10 sm:p-14 flex flex-col sm:flex-row items-start sm:items-center gap-8 justify-between"
          style={{
            background: PALETTE.header,
            border: `1px solid ${PALETTE.gold}33`,
          }}
        >
          <div>
            <span
              className="text-[11px] uppercase"
              style={{
                fontFamily: FONT_MONO,
                letterSpacing: "0.28em",
                color: PALETTE.goldLight,
              }}
            >
              Acesso à plataforma
            </span>
            <h3
              className="mt-3 text-2xl sm:text-3xl font-semibold tracking-tight"
              style={{ color: "#F6F3EA" }}
            >
              Pronto para entrar no POSION Tools?
            </h3>
            <p className="mt-3 text-sm max-w-xl" style={{ color: "#F6F3EAAA" }}>
              O acesso é restrito à equipe POSION e às clínicas parceiras.
              Use suas credenciais para entrar.
            </p>
          </div>
          <button
            onClick={() => navigate("/login")}
            className="inline-flex items-center gap-2 h-12 px-7 rounded-full text-[15px] font-semibold transition-all hover:-translate-y-0.5"
            style={{
              background: PALETTE.goldLight,
              color: PALETTE.header,
              boxShadow: "0 8px 24px -12px rgba(240,205,110,0.55)",
            }}
          >
            Entrar <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>

      <footer
        className="max-w-6xl mx-auto px-6 py-10 flex items-center justify-between text-[11px] uppercase"
        style={{ fontFamily: FONT_MONO, letterSpacing: "0.24em", color: PALETTE.muted }}
      >
        <span>© POSION Growth · POSION Tools</span>
        <span>Sessão criptografada · TLS 1.3</span>
      </footer>
    </div>
  );
}
