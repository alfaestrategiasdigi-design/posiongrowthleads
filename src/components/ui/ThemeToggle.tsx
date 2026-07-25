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
        "relative h-8 w-16 inline-flex items-center rounded-full p-1 " +
        "border transition-colors duration-300 " +
        (isDark
          ? "bg-black border-white/20"
          : "bg-white border-black/20") +
        " " + className
      }
    >
      {/* Track icons */}
      <Sun className={"w-3.5 h-3.5 absolute left-1.5 " + (isDark ? "text-white/40" : "text-black")} />
      <Moon className={"w-3.5 h-3.5 absolute right-1.5 " + (isDark ? "text-white" : "text-black/40")} />
      {/* Thumb */}
      <span
        className={
          "inline-block h-6 w-6 rounded-full shadow-md transform transition-transform duration-300 " +
          (isDark ? "translate-x-8 bg-white" : "translate-x-0 bg-black")
        }
      />
    </button>
  );
}
