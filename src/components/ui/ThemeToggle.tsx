import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      aria-label={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      className={
        "h-8 w-8 inline-flex items-center justify-center rounded-full " +
        "text-muted-foreground hover:text-foreground border border-border/60 " +
        "hover:border-primary/40 bg-transparent hover:bg-primary/5 " +
        "transition-all duration-200 " + className
      }
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
