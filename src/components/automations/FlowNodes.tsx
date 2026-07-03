import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { nodeColor, type NodeKind } from "@/lib/automations/types";
import { cn } from "@/lib/utils";

interface Data {
  label?: string;
  kind?: string;
  text?: string;
  minutes?: number;
  hours?: number;
  days?: number;
  buttons?: { id: string; label: string }[];
  [k: string]: any;
}

function Base({
  type,
  data,
  selected,
  hasSource = true,
  hasTarget = true,
  children,
}: {
  type: NodeKind;
  data: Data;
  selected?: boolean;
  hasSource?: boolean;
  hasTarget?: boolean;
  children: React.ReactNode;
}) {
  const color = nodeColor(type);
  return (
    <div
      className={cn(
        "rounded-lg border-2 bg-card shadow-lg min-w-[220px] max-w-[260px] transition-all",
        selected ? "ring-2 ring-primary" : "",
      )}
      style={{ borderColor: color }}
    >
      {hasTarget && <Handle type="target" position={Position.Top} style={{ background: color }} />}
      <div className="px-3 py-2 rounded-t-md text-xs font-semibold text-white" style={{ background: color }}>
        {data.label || type}
      </div>
      <div className="p-3 text-xs text-foreground/90">{children}</div>
      {hasSource && <Handle type="source" position={Position.Bottom} style={{ background: color }} />}
    </div>
  );
}

export const TriggerNode = memo(({ data, selected }: NodeProps) => (
  <Base type="trigger" data={data as Data} selected={selected} hasTarget={false}>
    <div className="font-medium">🟣 Gatilho</div>
    <div className="text-muted-foreground">{(data as Data).kind || "manual"}</div>
  </Base>
));
TriggerNode.displayName = "TriggerNode";

export const MessageNode = memo(({ data, selected }: NodeProps) => (
  <Base type="message" data={data as Data} selected={selected}>
    <div className="line-clamp-3">{(data as Data).text || "Enviar mensagem"}</div>
  </Base>
));
MessageNode.displayName = "MessageNode";

export const ButtonsNode = memo(({ data, selected }: NodeProps) => {
  const d = data as Data;
  return (
    <Base type="buttons" data={d} selected={selected}>
      <div className="line-clamp-2">{d.text || "Mensagem com botões"}</div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(d.buttons || []).map((b) => (
          <span key={b.id} className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 border border-primary/30">
            {b.label}
          </span>
        ))}
      </div>
    </Base>
  );
});
ButtonsNode.displayName = "ButtonsNode";

export const WaitNode = memo(({ data, selected }: NodeProps) => {
  const d = data as Data;
  const t =
    d.days ? `${d.days} dia(s)` :
    d.hours ? `${d.hours} hora(s)` :
    d.minutes ? `${d.minutes} min` :
    d.beforeAppointmentHours ? `${d.beforeAppointmentHours}h antes da consulta` :
    "Aguardar";
  return (
    <Base type="wait" data={d} selected={selected}>
      <div className="text-center">⏳ {t}</div>
    </Base>
  );
});
WaitNode.displayName = "WaitNode";

export const ConditionNode = memo(({ data, selected }: NodeProps) => (
  <Base type="condition" data={data as Data} selected={selected}>
    <div>Se: <span className="font-mono">{(data as Data).expression || "campo = valor"}</span></div>
  </Base>
));
ConditionNode.displayName = "ConditionNode";

export const KanbanNode = memo(({ data, selected, type }: NodeProps) => (
  <Base type={type as NodeKind} data={data as Data} selected={selected}>
    <div>{(data as Data).text || (data as Data).column || "Kanban"}</div>
  </Base>
));
KanbanNode.displayName = "KanbanNode";

export const GenericNode = memo(({ data, selected, type }: NodeProps) => (
  <Base type={type as NodeKind} data={data as Data} selected={selected}>
    <div className="text-muted-foreground">{type}</div>
  </Base>
));
GenericNode.displayName = "GenericNode";

export const nodeTypes = {
  trigger: TriggerNode,
  message: MessageNode,
  buttons: ButtonsNode,
  list: ButtonsNode,
  wait: WaitNode,
  wait_response: WaitNode,
  condition: ConditionNode,
  split: ConditionNode,
  kanban_move: KanbanNode,
  kanban_create: KanbanNode,
  kanban_update: KanbanNode,
  kanban_tag: KanbanNode,
  appointment_create: GenericNode,
  appointment_link: GenericNode,
  appointment_confirm: GenericNode,
  appointment_cancel: GenericNode,
  audio: MessageNode,
  media: MessageNode,
  end: GenericNode,
  notify_team: GenericNode,
};
