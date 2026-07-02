import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Index from "./pages/Index";
import Obrigado from "./pages/Obrigado";
import NotFound from "./pages/NotFound";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import AdminLayout from "./components/admin/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import WhatsAppChat from "./pages/admin/WhatsAppChat";
import LeadsPage from "./pages/admin/LeadsPage";

import ConexaoWhatsappPage from "./pages/admin/ConexaoWhatsappPage";
import WhatsAppStatusPage from "./pages/admin/WhatsAppStatusPage";
import CreateUserPage from "./pages/admin/CreateUserPage";
import QualificacaoPage from "./pages/admin/QualificacaoPage";
import FacebookConfigPage from "./pages/admin/FacebookConfigPage";
import CapiConfigPage from "./pages/admin/CapiConfigPage";
import CampanhasPage from "./pages/admin/CampanhasPage";


import SubscriptionsPage from "./pages/admin/SubscriptionsPage";

import AppointmentsPage from "./pages/admin/AppointmentsPage";
import TenantsPage from "./pages/admin/TenantsPage";
import ContractsPage from "./pages/admin/ContractsPage";
import AgencyPipelinePage from "./pages/admin/AgencyPipelinePage";
import AgencyContractsPage from "./pages/admin/AgencyContractsPage";
import AppLayout from "./components/app/AppLayout";
import TenantDashboard from "./pages/app/TenantDashboard";
import TenantSales from "./pages/app/TenantSales";
import TenantPatients from "./pages/app/TenantPatients";
import TenantKanban from "./pages/app/TenantKanban";
import TenantWhatsApp from "./pages/app/TenantWhatsApp";
import TenantAgenda from "./pages/app/TenantAgenda";
import TenantConfig from "./pages/app/TenantConfig";
import TenantRecall from "./pages/app/TenantRecall";
import TenantPlans from "./pages/app/TenantPlans";
import TenantProductsConfig from "./pages/app/TenantProductsConfig";
import TenantLeads from "./pages/app/TenantLeads";
import TenantCampaigns from "./pages/app/TenantCampaigns";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/obrigado" element={<Obrigado />} />
          <Route path="/convite/:token" element={<AcceptInvitePage />} />


          {/* Tenant SaaS area */}
          <Route path="/app" element={<AppLayout><div /></AppLayout>} />
          <Route path="/app/:tenantSlug/dashboard" element={<AppLayout><TenantDashboard /></AppLayout>} />
          <Route path="/app/:tenantSlug/whatsapp" element={<AppLayout><TenantWhatsApp /></AppLayout>} />
          <Route path="/app/:tenantSlug/kanban" element={<AppLayout><TenantKanban /></AppLayout>} />
          {/* Tenant SaaS area */}
          <Route path="/app" element={<AppLayout><div /></AppLayout>} />
          <Route path="/app/:tenantSlug/dashboard" element={<AppLayout><TenantDashboard /></AppLayout>} />
          <Route path="/app/:tenantSlug/whatsapp" element={<AppLayout><TenantWhatsApp /></AppLayout>} />
          <Route path="/app/:tenantSlug/kanban" element={<AppLayout><TenantKanban /></AppLayout>} />
          <Route path="/app/:tenantSlug/leads" element={<AppLayout><TenantLeads /></AppLayout>} />
          <Route path="/app/:tenantSlug/campanhas" element={<AppLayout><TenantCampaigns /></AppLayout>} />
          <Route path="/app/:tenantSlug/pacientes" element={<AppLayout><TenantPatients /></AppLayout>} />
          <Route path="/app/:tenantSlug/financeiro" element={<AppLayout><TenantSales /></AppLayout>} />
          <Route path="/app/:tenantSlug/vendas" element={<Navigate to="../financeiro" replace />} />
          <Route path="/app/:tenantSlug/agenda" element={<AppLayout><TenantAgenda /></AppLayout>} />
          <Route path="/app/:tenantSlug/config" element={<AppLayout><TenantConfig /></AppLayout>} />
          <Route path="/app/:tenantSlug/produtos" element={<AppLayout><TenantProductsConfig /></AppLayout>} />
          <Route path="/app/:tenantSlug/prontuario" element={<Navigate to="../pacientes" replace />} />
          <Route path="/app/:tenantSlug/automacoes" element={<AppLayout><TenantRecall /></AppLayout>} />
          <Route path="/app/:tenantSlug/recall" element={<Navigate to="../automacoes" replace />} />
          <Route path="/app/:tenantSlug/planos" element={<AppLayout><TenantPlans /></AppLayout>} />

          {/* Posion master admin */}
          <Route path="/admin" element={<AdminLayout><Dashboard /></AdminLayout>} />
          <Route path="/admin/pipeline" element={<AdminLayout><AgencyPipelinePage /></AdminLayout>} />
          <Route path="/admin/contratos-agencia" element={<AdminLayout><AgencyContractsPage /></AdminLayout>} />
          <Route path="/admin/tenants" element={<AdminLayout><TenantsPage /></AdminLayout>} />
          <Route path="/admin/contratos" element={<AdminLayout><ContractsPage /></AdminLayout>} />
          <Route path="/admin/agendamentos" element={<AdminLayout><AppointmentsPage /></AdminLayout>} />
          <Route path="/admin/whatsapp" element={<AdminLayout><WhatsAppChat masterMode /></AdminLayout>} />
          <Route path="/admin/kanban" element={<Navigate to="/admin/pipeline" replace />} />
          <Route path="/admin/leads" element={<AdminLayout><LeadsPage /></AdminLayout>} />

          <Route path="/admin/conexao-whatsapp" element={<AdminLayout><ConexaoWhatsappPage /></AdminLayout>} />
          <Route path="/admin/whatsapp-status" element={<AdminLayout><WhatsAppStatusPage /></AdminLayout>} />
          <Route path="/admin/usuarios" element={<AdminLayout><CreateUserPage /></AdminLayout>} />
          <Route path="/admin/qualificacao" element={<AdminLayout><QualificacaoPage /></AdminLayout>} />
          <Route path="/admin/facebook" element={<AdminLayout><FacebookConfigPage /></AdminLayout>} />
          <Route path="/admin/capi" element={<AdminLayout><CapiConfigPage /></AdminLayout>} />
          <Route path="/admin/campanhas" element={<AdminLayout><CampanhasPage /></AdminLayout>} />

          <Route path="/admin/meta-ads" element={<Navigate to="/admin/campanhas" replace />} />
          <Route path="/admin/planos" element={<AdminLayout><SubscriptionsPage /></AdminLayout>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
