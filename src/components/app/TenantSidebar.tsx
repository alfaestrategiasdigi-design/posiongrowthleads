import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard, MessageCircle, Kanban, Users, DollarSign, Calendar, Settings,
  Building2, Zap, Sparkles, Package, UserSearch, Megaphone, PanelLeftClose, PanelLeftOpen, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Tenant } from "@/hooks/useTenant";
import posionLogo from "@/assets/posion/logo-posion.png.asset.json";
import UserAvatarBlock from "@/components/shared/UserAvatarBlock";

interface Props { tenant: Tenant; isSuperAdmin: boolean; tenantRole?: string | null }

const COMERCIAL_ROLES = new Set(["comercial_tenant", "vendedor", "recepcao", "viewer"]);

export default function TenantSidebar({ tenant, isSuperAdmin, tenantRole }: Props) {
  const { state, toggleSidebar } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const base = `/app/${tenant.slug}`;
  const isComercial = !isSuperAdmin && !!tenantRole && COMERCIAL_ROLES.has(tenantRole);

  // itens `comercial: true` são visíveis para todos; os demais só para admin/owner/master
  const allItems: Array<{ title: string; url: string; icon: any; comercial?: boolean }> = [
    { title: "Dashboard", url: `${base}/dashboard`, icon: LayoutDashboard, comercial: true },
    { title: "WhatsApp", url: `${base}/whatsapp`, icon: MessageCircle, comercial: true },
    { title: "Leads", url: `${base}/leads`, icon: UserSearch, comercial: true },
    { title: "Campanhas Meta", url: `${base}/campanhas`, icon: Megaphone },
    { title: "Kanban", url: `${base}/kanban`, icon: Kanban, comercial: true },
    { title: "Pacientes Ativos", url: `${base}/pacientes`, icon: Users },
    { title: "Agenda", url: `${base}/agenda`, icon: Calendar, comercial: true },
    { title: "Financeiro", url: `${base}/financeiro`, icon: DollarSign },
    { title: "Relatórios", url: `${base}/relatorios`, icon: BarChart3, comercial: true },
    { title: "Automações", url: `${base}/automacoes`, icon: Zap },
    { title: "Produtos & Serviços", url: `${base}/produtos`, icon: Package, comercial: true },
    { title: "Planos", url: `${base}/planos`, icon: Sparkles },
    { title: "Configurações", url: `${base}/config`, icon: Settings },
  ];
  const items = isComercial ? allItems.filter(i => i.comercial) : allItems;

  return (
    <Sidebar collapsible="icon" className="tech-sidebar border-r border-sidebar-border bg-sidebar/95 backdrop-blur-xl">
      <SidebarContent>
        {/* Cabeçalho simétrico: usuário logado + botão de recolher */}
        <div className="tech-topbar-band h-14 px-3 flex items-center border-b">
          <div className="flex items-center gap-2 w-full min-w-0">
            <div className="min-w-0 flex-1">
              <UserAvatarBlock
                to={`/app/${tenant.slug}/perfil`}
                collapsed={collapsed}
                subtitle="Meu perfil"
              />
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
        </div>

        {/* Identificação discreta da clínica */}
        {!collapsed && (
          <div className="px-3 pt-2 pb-1">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
              <Building2 className="h-3 w-3 opacity-70" />
              <span className="truncate">{tenant.name}</span>
              <span className="ml-auto text-muted-foreground/50">{tenant.plan}</span>
            </div>
          </div>
        )}

        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">Operação</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild isActive={pathname === item.url}>
                    <NavLink to={item.url} className="flex items-center gap-2">
                      <item.icon className="h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isSuperAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground/70">Posion (Master)</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname.startsWith("/admin/tenants")}>
                    <NavLink to="/admin/tenants" className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" />
                      {!collapsed && <span>Clínicas Clientes</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={pathname === "/admin"}>
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
      <SidebarFooter className="border-t border-sidebar-border">
        <div className={collapsed ? "py-3 flex justify-center" : "px-3 py-3 flex items-center gap-2"}>
          <img src={posionLogo.url} alt="Posion" className={collapsed ? "h-6 opacity-80" : "h-5 opacity-80"} />
          {!collapsed && (
            <div className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground/70 leading-tight">Powered by<br/><span className="text-primary/80">Posion Growth</span></div>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
