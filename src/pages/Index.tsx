import { useEffect } from "react";
import Header from "@/components/ui/Header";
import HeroSection from "@/components/ui/HeroSection";
import CasesSection from "@/components/ui/CasesSection";
import BenefitsSection from "@/components/ui/BenefitsSection";
import FinalCTASection from "@/components/ui/FinalCTASection";
import FloatingCTAs from "@/components/ui/FloatingCTAs";
import Footer from "@/components/ui/Footer";
import { supabase } from "@/integrations/supabase/client";
import { useScrollReveal } from "@/hooks/useScrollReveal";

const Index = () => {
  useScrollReveal();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const utm_source = params.get("utm_source");
    const utm_medium = params.get("utm_medium");
    const utm_campaign = params.get("utm_campaign");

    if (utm_source) {
      try {
        localStorage.setItem("posion_utms", JSON.stringify({
          utm_source, utm_medium, utm_campaign, savedAt: Date.now(),
        }));
      } catch {}
    }

    supabase.from("page_views").insert({
      path: window.location.pathname,
      referrer: document.referrer || null,
      utm_source, utm_medium, utm_campaign,
      user_agent: navigator.userAgent.slice(0, 280),
    } as any).then(() => {});
  }, []);

  return (
    <div className="min-h-screen flex flex-col tech-bg geo-pattern">
      <Header />
      <main className="flex-1">
        <HeroSection />
        <CasesSection />
        <BenefitsSection />
        <FinalCTASection />
      </main>
      <Footer />
      <FloatingCTAs />
    </div>
  );
};

export default Index;
