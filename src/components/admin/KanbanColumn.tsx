import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

interface KanbanColumnProps {
  title: string;
  count: number;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  subtitle?: string;
  children: ReactNode;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

const KanbanColumn = ({
  title, count, icon: Icon, bgColor, subtitle, children, onDragOver, onDrop,
}: KanbanColumnProps) => {
  return (
    <div
      className="kanban-column flex flex-col bg-muted/40 rounded-xl border border-border/60 flex-shrink-0 transition-colors duration-200"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className={`p-3 rounded-t-xl ${bgColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
              <Icon className="w-3.5 h-3.5 text-white" />
            </div>
            <h3 className="font-semibold text-white text-xs truncate" title={title}>{title}</h3>
          </div>
          <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
            {count}
          </span>
        </div>
        {subtitle && (
          <p className="text-[10px] text-white/85 mt-1.5 font-medium tabular-nums">{subtitle}</p>
        )}
      </div>

      <div className="kanban-column-body flex-1 space-y-2.5 overflow-y-auto max-h-[calc(100vh-280px)]">
        {children}
      </div>
    </div>
  );
};

export default KanbanColumn;
