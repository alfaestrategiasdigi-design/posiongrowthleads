import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarSeparator, useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard, MessageCircle, Kanban, Users, DollarSign, Calendar, Settings,
  Building2, Zap, Sparkles, Package, UserSearch, Megaphone, PanelLeftClose, PanelLeftOpen,
  BarChart3, Activity, LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { Tenant } from "@/hooks/useTenant";
import UserAvatarBlock from "@/components/shared/UserAvatarBlock";

interface Props { tenant: Tenant; isSuperAdmin: boolean; tenantRole?: string | null }

const COMERCIAL_ROLES = new Set(["comercial_tenant", "vendedor", "recepcao", "viewer"]);

type NavItem = { title: string; url: string; icon: any; comercial?: boolean };
type NavGroup = { label: string; items: NavItem[] };

export default function TenantSidebar({ tenant, isSuperAdmin, tenantRole }: Props) {
  const { state, toggleSidebar } = useSidebar();
  const navigate = useNavigate();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const base = `/app/${tenant.slug}`;
  const isComercial = !isSuperAdmin && !!tenantRole && COMERCIAL_ROLES.has(tenantRole);

  const groups: NavGroup[] = [
    {
      label: "Operação",
      items: [
        { title: "Dashboard", url: `${base}/dashboard`, icon: LayoutDashboard, comercial: true },
        { title: "WhatsApp", url: `${base}/whatsapp`, icon: MessageCircle, comercial: true },
        { title: "Leads", url: `${base}/leads`, icon: UserSearch, comercial: true },
        { title: "Campanhas Meta", url: `${base}/campanhas`, icon: Megaphone },
        { title: "Kanban", url: `${base}/kanban`, icon: Kanban, comercial: true },
      ],
    },
    {
      label: "Gestão",
      items: [
        { title: "Pacientes Ativos", url: `${base}/pacientes`, icon: Users },
        { title: "Agenda", url: `${base}/agenda`, icon: Calendar, comercial: true },
        { title: "Financeiro", url: `${base}/financeiro`, icon: DollarSign },
        { title: "Relatórios", url: `${base}/relatorios`, icon: BarChart3, comercial: true },
      ],
    },
    {
      label: "Configurações",
      items: [
        { title: "Automações", url: `${base}/automacoes`, icon: Zap },
        { title: "Produtos & Serviços", url: `${base}/produtos`, icon: Package, comercial: true },
        { title: "Planos", url: `${base}/planos`, icon: Sparkles },
        { title: "Configurações", url: `${base}/config`, icon: Settings },
      ],
    },
  ];

  const visibleGroups = groups
    .map((g) => ({
      ...g,
      items: isComercial ? g.items.filter((i) => i.comercial) : g.items,
    }))
    .filter((g) => g.items.length > 0);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <Sidebar collapsible="icon" className="tech-sidebar border-r border-sidebar-border bg-sidebar/95 backdrop-blur-xl">
      <SidebarHeader className="p-0">
        {/* Topo: perfil do usuário + toggle */}
        <div className={`tech-topbar-band h-14 px-2 border-b ${collapsed ? "flex flex-col items-center justify-center gap-2" : "flex items-center justify-between gap-1"}`}>
          <div className="min-w-0 flex-1">
            <UserAvatarBlock to={`/app/${tenant.slug}/perfil`} collapsed={collapsed} subtitle={tenant.name} />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expandir menu lateral" : "Recolher menu lateral"}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className="h-8 w-8 shrink-0 text-white/60 hover:text-white hover:bg-white/5"
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
              <SidebarGroupLabel className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/50 px-3 mt-2 mb-1 flex items-center gap-2">
                <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
                {group.label}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === item.url}
                      tooltip={item.title}
                      className="gap-3 relative font-medium text-sm transition-all hover:bg-amber-500/5 hover:text-amber-200"
                    >
                      <NavLink to={item.url} className="flex items-center gap-2">
                        <item.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                        {!collapsed && <span className="truncate">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {isSuperAdmin && (
          <SidebarGroup>
            {!collapsed && (
              <SidebarGroupLabel className="text-[9px] font-mono uppercase tracking-[0.22em] text-white/50 px-3 mt-2 mb-1 flex items-center gap-2">
                <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
                Posion (Master)
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname.startsWith("/admin/tenants")} tooltip="Clínicas Clientes">
                    <NavLink to="/admin/tenants" className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {!collapsed && <span>Clínicas Clientes</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/admin"} tooltip="Admin Posion">
                    <NavLink to="/admin" className="flex items-center gap-2">
                      <LayoutDashboard className="h-4 w-4" />
                      {!collapsed && <span>Admin Posion</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-2 border-t border-sidebar-border gap-1">
        {!collapsed && (
          <div className="px-3 py-2 mb-1 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.16em] text-white/55">
            <Activity className="w-3 h-3 text-amber-400" />
            <span>Status</span>
            <span className="ml-auto tech-dot" />
            <span className="text-emerald-400">online</span>
          </div>
        )}
        <div className="px-1">
          <UserAvatarBlock to={`/app/${tenant.slug}/perfil`} collapsed={collapsed} subtitle="Meu perfil" />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleLogout}
              tooltip="Sair"
              className="gap-3 text-rose-400/90 hover:text-rose-300 hover:bg-rose-500/10"
            >
              <LogOut className="w-4 h-4" strokeWidth={1.8} />
              {!collapsed && <span className="font-medium text-sm">Sair</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
