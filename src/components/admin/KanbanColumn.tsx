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
      className="flex flex-col bg-muted/30 rounded-xl border border-border/50 min-w-[260px] max-w-[280px] flex-shrink-0"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className={`p-3 rounded-t-xl ${bgColor}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
              <Icon className="w-3.5 h-3.5 text-white" />
            </div>
            <h3 className="font-semibold text-white text-xs truncate">{title}</h3>
          </div>
          <span className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
            {count}
          </span>
        </div>
        {subtitle && (
          <p className="text-[10px] text-white/80 mt-1.5 font-medium tabular-nums">{subtitle}</p>
        )}
      </div>

      <div className="flex-1 p-2.5 space-y-2.5 overflow-y-auto max-h-[calc(100vh-280px)] min-h-[180px]">
        {children}
      </div>
    </div>
  );
};

export default KanbanColumn;
