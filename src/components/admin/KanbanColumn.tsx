import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

interface KanbanColumnProps {
  title: string;
  count: number;
  icon: LucideIcon;
  /** legado — ignorado no visual claro */
  color?: string;
  /** legado — ignorado no visual claro */
  bgColor?: string;
  subtitle?: string;
  children: ReactNode;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/**
 * Coluna do Kanban — visual claro (Kommo-like).
 * Fundo branco, borda cinza sutil, filete dourado no topo,
 * título escuro, contador em badge neutra.
 */
const KanbanColumn = ({
  title, count, icon: Icon, subtitle, children, onDragOver, onDrop,
}: KanbanColumnProps) => {
  return (
    <div
      data-no-float
      className="kanban-column flex flex-col bg-card rounded-lg border border-border shadow-sm flex-shrink-0 transition-colors overflow-hidden min-w-[260px]"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Filete dourado */}
      <div className="h-[3px] bg-gradient-to-r from-primary/70 via-primary/50 to-primary/20" />

      <div className="px-3 pt-2.5 pb-2 border-b border-border/70">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
            <h3
              className="text-[11.5px] font-semibold uppercase tracking-[0.14em] text-foreground/85 truncate"
              title={title}
            >
              {title}
            </h3>
          </div>
          <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full bg-muted text-[10.5px] font-semibold tabular-nums text-foreground/70">
            {count}
          </span>
        </div>
        {subtitle && (
          <p className="text-[10.5px] text-muted-foreground mt-1 font-mono tabular-nums">{subtitle}</p>
        )}
      </div>

      <div className="kanban-column-body flex-1 p-2 space-y-1.5 overflow-y-auto max-h-[calc(100vh-280px)]">
        {children}
      </div>
    </div>
  );
};

export default KanbanColumn;
