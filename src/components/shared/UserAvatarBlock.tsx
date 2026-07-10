import { Link } from "react-router-dom";
import { useUserProfile, initialsFrom } from "@/hooks/useUserProfile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface Props {
  to: string;
  collapsed?: boolean;
  subtitle?: string;
}

export default function UserAvatarBlock({ to, collapsed, subtitle }: Props) {
  const { user, profile } = useUserProfile();
  const name = profile?.full_name || user?.email?.split("@")[0] || "Meu perfil";
  const initials = initialsFrom(profile?.full_name, user?.email);

  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-amber-500/5 border border-transparent hover:border-amber-500/20 transition-colors"
      title="Ver meu perfil"
    >
      <Avatar className="h-9 w-9 border border-amber-500/40 shrink-0">
        {profile?.avatar_url ? <AvatarImage src={profile.avatar_url} alt={name} /> : null}
        <AvatarFallback className="bg-amber-500/15 text-amber-200 text-xs font-mono uppercase">
          {initials}
        </AvatarFallback>
      </Avatar>
      {!collapsed && (
        <div className="min-w-0 leading-tight">
          <div className="text-sm font-medium text-foreground truncate group-hover:text-amber-200 transition-colors">
            {name}
          </div>
          <div className="text-[10px] font-mono uppercase tracking-[0.16em] text-muted-foreground/70 truncate">
            {subtitle || "Meu perfil"}
          </div>
        </div>
      )}
    </Link>
  );
}
