import { useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, MessageCircle, Users, LogOut, UserPlus, Zap,
  Facebook, Building2, FileText, Megaphone, Plug, Activity, Target, CreditCard, GitBranch,
  PanelLeftClose, PanelLeftOpen, BarChart3,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  SidebarSeparator, useSidebar,
} from "@/components/ui/sidebar";
import logoAsset from "@/assets/posion/logo-posion.png.asset.json";
import UserAvatarBlock from "@/components/shared/UserAvatarBlock";

import { useUserRole } from "@/hooks/useUserRole";

type NavItem = { title: string; url: string; icon: any; live?: boolean; agency?: boolean };
type NavGroup = { label: string; agency?: boolean; items: NavItem[] };

// Itens marcados `agency: true` são visíveis para `comercial_admin_master` e `user` (visão Agência POSION).
const navGroups: NavGroup[] = [
  {
    label: "Agência POSION",
    agency: true,
    items: [
      { title: "Dashboard", url: "/admin", icon: LayoutDashboard, agency: true },
      { title: "Pipeline Agência", url: "/admin/pipeline", icon: GitBranch, agency: true },
      { title: "Leads (formulário)", url: "/admin/leads", icon: Users, agency: true },
      { title: "Automações", url: "/admin/automacoes", icon: Zap, agency: true },
      { title: "Agenda de Reunião", url: "/admin/agendamentos", icon: Activity, agency: true },
      { title: "WhatsApp Master", url: "/admin/whatsapp", icon: MessageCircle, live: true, agency: true },
      { title: "Relatórios", url: "/admin/relatorios", icon: BarChart3, agency: true },
      { title: "Contratos", url: "/admin/contratos-agencia", icon: FileText, agency: true },
    ],
  },
  {
    label: "Marketing",
    items: [
      { title: "Campanhas Meta", url: "/admin/campanhas", icon: Megaphone },
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
      { title: "Auditoria WhatsApp", url: "/admin/whatsapp-audit", icon: Activity },
      { title: "Usuários & Convites", url: "/admin/usuarios", icon: UserPlus },
    ],
  },
];


const AppSidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const { isMaster, isComercialMaster, globalRoles, loading } = useUserRole();

  // Visão "Agência POSION" restrita: comercial_admin_master OU usuários sem papel master (role `user`)
  const isAgencyOnly =
    !isMaster && (isComercialMaster || globalRoles.length === 0 || globalRoles.every((r) => r === "user"));

  const visibleGroups = loading
    ? []
    : navGroups
        .map((g) => {
          if (isMaster) return g;
          if (isAgencyOnly && g.agency) {
            return { ...g, items: g.items.filter((i) => i.agency) };
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
        <div className={collapsed ? "flex flex-col items-center gap-3" : "flex items-center justify-between gap-2"}>
          <div className="relative min-w-0 flex justify-center">
            <img src={logoAsset.url} alt="Posion" className={collapsed ? "h-7 w-auto" : "h-9 w-auto"} />
            {!collapsed && (
              <span className="absolute -bottom-2 right-0 text-[8px] font-mono uppercase tracking-[0.2em] text-amber-300/80">
                v2 · OS
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </Button>
        </div>
      </SidebarHeader>

      <SidebarSeparator className="bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />

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
                        className="gap-3 relative font-medium text-sm transition-all hover:bg-amber-500/5 hover:text-amber-200"
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

      <SidebarFooter className="p-2 border-t border-sidebar-border gap-1">
        {!collapsed && (
          <div className="px-3 py-2 mb-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground/60">
            <Activity className="w-3 h-3 text-amber-400" />
            <span>Status</span>
            <span className="ml-auto tech-dot" />
            <span className="text-emerald-400">online</span>
          </div>
        )}
        <div className="px-1">
          <UserAvatarBlock to="/admin/perfil" collapsed={collapsed} subtitle="Meu perfil" />
        </div>
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
