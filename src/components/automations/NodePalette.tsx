import { NODE_PALETTE, type NodeKind } from "@/lib/automations/types";

interface Props {
  onAdd: (kind: NodeKind, label: string) => void;
}

export default function NodePalette({ onAdd }: Props) {
  return (
    <aside className="w-64 shrink-0 border-r border-border bg-card/30 h-full overflow-auto">
      <div className="p-3 border-b border-border">
        <div className="text-xs uppercase text-muted-foreground">Adicionar nó</div>
        <div className="text-sm font-semibold">Paleta</div>
      </div>
      <div className="p-3 space-y-4">
        {NODE_PALETTE.map((group) => (
          <div key={group.group}>
            <div
              className="text-[11px] uppercase font-semibold mb-2"
              style={{ color: group.color }}
            >
              {group.group}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  key={item.kind}
                  onClick={() => onAdd(item.kind, item.label)}
                  className="w-full text-left text-xs px-2 py-1.5 rounded-md border border-border/60 bg-background/40 hover:bg-muted/60 transition-colors flex items-center gap-2"
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
