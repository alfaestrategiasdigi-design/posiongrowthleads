import { useEffect } from "react";
import Header from "@/components/ui/Header";
import HeroSection from "@/components/ui/HeroSection";
import CasesSection from "@/components/ui/CasesSection";
import BenefitsSection from "@/components/ui/BenefitsSection";
import ServicesSection from "@/components/ui/ServicesSection";
import StepsSection from "@/components/ui/StepsSection";
import SocialProof from "@/components/ui/SocialProof";
import Footer from "@/components/ui/Footer";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  useEffect(() => {
    // Tracking de pageview com UTMs
    const params = new URLSearchParams(window.location.search);
    const utm_source = params.get("utm_source");
    const utm_medium = params.get("utm_medium");
    const utm_campaign = params.get("utm_campaign");

    // persistir UTMs por 30d para captura no form
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
        <ServicesSection />
        <StepsSection />
        <SocialProof />
      </main>
      <Footer />
    </div>
  );
};

export default Index;
