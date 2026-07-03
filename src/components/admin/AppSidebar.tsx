import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, MessageCircle, Users, LogOut, UserPlus, Zap,
  Facebook, Building2, FileText, Megaphone, Plug, Activity, Target, CreditCard, GitBranch,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  SidebarSeparator, useSidebar,
} from "@/components/ui/sidebar";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";

import { useUserRole } from "@/hooks/useUserRole";

type NavItem = { title: string; url: string; icon: any; live?: boolean; comercial?: boolean };
type NavGroup = { label: string; comercial?: boolean; items: NavItem[] };

// itens marcados `comercial: true` também aparecem para `comercial_admin_master`
const navGroups: NavGroup[] = [
  {
    label: "Agência POSION",
    comercial: true,
    items: [
      { title: "Dashboard", url: "/admin", icon: LayoutDashboard, comercial: true },
      { title: "Pipeline Agência", url: "/admin/pipeline", icon: GitBranch, comercial: true },
      { title: "Leads (formulário)", url: "/admin/leads", icon: Users, comercial: true },
      { title: "Automações", url: "/admin/automacoes", icon: Zap, comercial: true },
      { title: "Agenda de Reunião", url: "/admin/agendamentos", icon: Activity, comercial: true },
      { title: "WhatsApp Master", url: "/admin/whatsapp", icon: MessageCircle, live: true, comercial: true },
      { title: "Contratos", url: "/admin/contratos-agencia", icon: FileText },
    ],
  },
  {
    label: "Marketing",
    comercial: true,
    items: [
      { title: "Campanhas Meta", url: "/admin/campanhas", icon: Megaphone, comercial: true },
      { title: "Conexão Facebook", url: "/admin/facebook", icon: Facebook },
      { title: "Conversions API", url: "/admin/capi", icon: Target },
    ],
  },
  {
    label: "Clínicas Clientes",
    items: [
      { title: "Clínicas", url: "/admin/tenants", icon: Building2 },
      { title: "Planos & Cobranças", url: "/admin/planos", icon: CreditCard },
      { title: "Contratos SaaS", url: "/admin/contratos", icon: FileText },
    ],
  },
  {
    label: "Operação Master",
    items: [
      { title: "Conexão WhatsApp", url: "/admin/conexao-whatsapp", icon: Plug },
      { title: "Status WhatsApp", url: "/admin/whatsapp-status", icon: Activity },
      { title: "Usuários & Convites", url: "/admin/usuarios", icon: UserPlus },
    ],
  },
];


const AppSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { isMaster, isComercialMaster } = useUserRole();

  // Comercial Admin Master só vê grupos/itens marcados como `comercial`
  const visibleGroups = navGroups
    .map((g) => {
      if (isMaster) return g;
      if (isComercialMaster && g.comercial) {
        return { ...g, items: g.items.filter((i) => i.comercial) };
      }
      return null;
    })
    .filter((g): g is NavGroup => !!g && g.items.length > 0);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  const isActive = (url: string) => {
    if (url === "/admin") return location.pathname === "/admin";
    return location.pathname.startsWith(url);
  };

  return (
    <Sidebar collapsible="icon" className="tech-sidebar border-r border-sidebar-border bg-sidebar/95 backdrop-blur-xl">
      <SidebarHeader className="p-4">
        <div className="flex items-center justify-center relative">
          <img src={logoAsset.url} alt="Posion" className="h-9 w-auto" />
          {!collapsed && (
            <span className="absolute -bottom-2 right-0 text-[8px] font-mono uppercase tracking-[0.2em] text-cyan-300/70">
              v2 · OS
            </span>
          )}
        </div>
      </SidebarHeader>

      <SidebarSeparator className="bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

      <SidebarContent className="px-1">
        {visibleGroups.map((group) => (
          <SidebarGroup key={group.label}>
            {!collapsed && (
              <SidebarGroupLabel className="text-[9px] font-mono uppercase tracking-[0.22em] text-muted-foreground/50 px-3 mt-2 mb-1 flex items-center gap-2">
                <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item.url);
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        isActive={active}
                        onClick={() => navigate(item.url)}
                        tooltip={item.title}
                        className="gap-3 relative font-medium text-sm transition-all hover:bg-cyan-500/5 hover:text-cyan-200"
                      >
                        <item.icon className="w-4 h-4 shrink-0" strokeWidth={1.8} />
                        <span className="truncate">{item.title}</span>
                        {"live" in item && item.live && !collapsed && (
                          <span className="ml-auto tech-dot" />
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="p-2 border-t border-sidebar-border">
        {!collapsed && (
          <div className="px-3 py-2 mb-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground/60">
            <Activity className="w-3 h-3 text-cyan-400" />
            <span>Status</span>
            <span className="ml-auto tech-dot" />
            <span className="text-emerald-400">online</span>
          </div>
        )}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              tooltip="Sair"
              className="gap-3 text-rose-400/90 hover:text-rose-300 hover:bg-rose-500/10"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.8} />
              <span className="font-medium text-sm">Sair</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
};

export default AppSidebar;
