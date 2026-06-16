import { useLocation, useNavigate } from "react-router-dom";
import { LayoutDashboard, MessageCircle, Kanban, Users, Settings, LogOut, UserPlus, ListChecks, Facebook, Calendar, Building2, TrendingUp, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";

const navItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Clínicas Clientes", url: "/admin/tenants", icon: Building2 },
  { title: "Contratos", url: "/admin/contratos", icon: FileText },
  { title: "Agendamentos", url: "/admin/agendamentos", icon: Calendar },
  { title: "Kanban", url: "/admin/kanban", icon: Kanban },
  { title: "Leads", url: "/admin/leads", icon: Users },
  { title: "WhatsApp", url: "/admin/whatsapp", icon: MessageCircle },
  { title: "Facebook Ads", url: "/admin/facebook", icon: Facebook },
  { title: "Campanhas", url: "/admin/campanhas", icon: TrendingUp },
  { title: "Qualificação", url: "/admin/qualificacao", icon: ListChecks },
  { title: "Conexão", url: "/admin/conexao", icon: Settings },
  { title: "Usuários", url: "/admin/usuarios", icon: UserPlus },
];

const AppSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const isActive = (url: string) => {
    if (url === "/admin") return location.pathname === "/admin";
    return location.pathname.startsWith(url);
  };

  return (
    <Sidebar className="border-r border-sidebar-border">
      <SidebarHeader className="p-4">
        <img src={logoAsset.url} alt="Posion Growth" className="h-9 mx-auto w-auto" />
      </SidebarHeader>

      <SidebarSeparator />

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={isActive(item.url)}
                    onClick={() => navigate(item.url)}
                    tooltip={item.title}
                    className="gap-3"
                  >
                    <item.icon className="w-5 h-5" />
                    <span className="font-medium">{item.title}</span>
                    {item.title === "WhatsApp" && (
                      <span className="ml-auto w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={handleLogout} tooltip="Sair" className="gap-3 text-destructive hover:text-destructive">
              <LogOut className="w-5 h-5" />
              <span className="font-medium">Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AppSidebar;
