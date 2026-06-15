import { NavLink, useLocation } from "react-router-dom";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";
import { LayoutDashboard, MessageCircle, Kanban, Users, DollarSign, Calendar, Settings, Building2, FileText, Bell, Sparkles } from "lucide-react";
import type { Tenant } from "@/hooks/useTenant";
import posionLogo from "@/assets/posion/logo-posion.png.asset.json";

interface Props { tenant: Tenant; isSuperAdmin: boolean }

export default function TenantSidebar({ tenant, isSuperAdmin }: Props) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const { pathname } = useLocation();
  const base = `/app/${tenant.slug}`;

  const items = [
    { title: "Dashboard", url: `${base}/dashboard`, icon: LayoutDashboard },
    { title: "WhatsApp", url: `${base}/whatsapp`, icon: MessageCircle },
    { title: "Kanban", url: `${base}/kanban`, icon: Kanban },
    { title: "Pacientes", url: `${base}/pacientes`, icon: Users },
    { title: "Prontuário", url: `${base}/prontuario`, icon: FileText },
    { title: "Recall", url: `${base}/recall`, icon: Bell },
    { title: "Fechamentos", url: `${base}/vendas`, icon: DollarSign },
    { title: "Agenda", url: `${base}/agenda`, icon: Calendar },
    { title: "Planos", url: `${base}/planos`, icon: Sparkles },
    { title: "Configurações", url: `${base}/config`, icon: Settings },
  ];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="px-3 py-4 border-b border-sidebar-border">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/30 flex items-center justify-center shrink-0 shadow-[inset_0_1px_0_hsl(42_55%_62%/0.2)]">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="font-display text-base leading-tight truncate">{tenant.name}</div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">{tenant.plan}</div>
              </div>
            )}
          </div>
        </div>
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
