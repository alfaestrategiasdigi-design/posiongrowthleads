import { MapPin, User as UserIcon } from "lucide-react";
import type { KanbanDensity } from "./types";

const BRL = (n: number | null | undefined) =>
  n && n > 0
    ? new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }).format(n)
    : "";

function initials(name?: string | null) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

export interface KanbanCardData {
  id: string;
  title: string;
  owner?: string | null;
  value?: number | null;
  origem?: string | null;
  city?: string | null;
  updatedAt?: string | null;
  badge?: string | null;
}

interface Props {
  data: KanbanCardData;
  density: KanbanDensity;
  onClick?: () => void;
  onDragStart?: () => void;
  right?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Cartão Kommo-style em tema claro.
 * - compact: 1 linha (nome + valor)
 * - comfortable: nome, responsável, valor
 * - spacious: adiciona cidade/origem e timestamp
 */
export default function KanbanCard({
  data,
  density,
  onClick,
  onDragStart,
  right,
  footer,
  className = "",
}: Props) {
  const val = BRL(data.value);

  const base =
    "group cursor-grab active:cursor-grabbing rounded-md border border-border bg-card " +
    "hover:border-primary/40 hover:shadow-sm transition-all";

  if (density === "compact") {
    return (
      <div
        draggable
        onDragStart={onDragStart}
        onClick={onClick}
        className={`${base} px-2.5 py-1.5 flex items-center gap-2 ${className}`}
      >
        <span className="w-1.5 h-1.5 rounded-full bg-primary/70 shrink-0" aria-hidden />
        <span className="text-[12.5px] font-medium text-foreground truncate flex-1">
          {data.title}
        </span>
        {val && <span className="text-[11px] font-semibold tabular-nums text-primary">{val}</span>}
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`${base} p-2.5 ${className}`}
    >
      <div className="flex items-start gap-2">
        <div
          className="w-6 h-6 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center border border-primary/20"
          aria-hidden
          title={data.owner || undefined}
        >
          {data.owner ? initials(data.owner) : <UserIcon className="w-3 h-3" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1.5">
            <div className="text-[13px] font-medium text-foreground truncate flex-1 leading-tight">
              {data.title}
            </div>
            {data.badge && (
              <span className="text-[9px] uppercase tracking-wide border border-border rounded px-1 py-[1px] text-muted-foreground bg-muted/40 shrink-0">
                {data.badge}
              </span>
            )}
            {right}
          </div>
          {data.owner && (
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">{data.owner}</div>
          )}

          {density === "spacious" && (
            <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
              {data.city && (
                <span className="inline-flex items-center gap-0.5">
                  <MapPin className="w-3 h-3" />
                  {data.city}
                </span>
              )}
              {data.origem && (
                <span className="inline-flex items-center gap-0.5 truncate">{data.origem}</span>
              )}
              {data.updatedAt && (
                <span className="ml-auto tabular-nums text-[10px]">
                  {new Date(data.updatedAt).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </span>
              )}
            </div>
          )}

          {(val || footer) && (
            <div className="mt-1.5 flex items-center gap-2">
              {val && (
                <span className="text-[12px] font-semibold tabular-nums text-primary">{val}</span>
              )}
              {footer && <div className="ml-auto">{footer}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
