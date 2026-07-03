import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { X, Plus, Trash2 } from "lucide-react";
import { AVAILABLE_VARIABLES, type FlowNode } from "@/lib/automations/types";
import { toast } from "sonner";

interface Props {
  node: FlowNode;
  onChange: (patch: Partial<FlowNode>) => void;
  onClose: () => void;
  onDelete: () => void;
}

export default function NodeEditorPanel({ node, onChange, onClose, onDelete }: Props) {
  const [text, setText] = useState<string>(node.data.text || "");
  const type = node.type;

  const patchData = (p: Record<string, any>) => onChange({ data: { ...node.data, ...p } });

  const insertVar = (v: string) => {
    const el = document.getElementById("msg-text") as HTMLTextAreaElement | null;
    if (!el) { setText((t) => t + " " + v); patchData({ text: text + " " + v }); return; }
    const start = el.selectionStart ?? text.length;
    const next = text.slice(0, start) + v + text.slice(start);
    setText(next); patchData({ text: next });
  };

  return (
    <aside className="w-[380px] shrink-0 border-l border-border bg-card/40 backdrop-blur h-full flex flex-col">
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <div className="text-xs uppercase text-muted-foreground">Editar nó</div>
          <div className="font-semibold">{node.data.label || type}</div>
        </div>
        <Button size="icon" variant="ghost" onClick={onClose}><X className="w-4 h-4" /></Button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div>
          <Label>Rótulo</Label>
          <Input
            value={node.data.label || ""}
            onChange={(e) => patchData({ label: e.target.value })}
            placeholder={type}
          />
        </div>

        {(type === "message" || type === "buttons" || type === "list") && (
          <>
            <div>
              <Label>Texto da mensagem</Label>
              <Textarea
                id="msg-text"
                rows={5}
                value={text}
                onChange={(e) => { setText(e.target.value); patchData({ text: e.target.value }); }}
                placeholder="Olá {{lead.nome}}, ..."
              />
            </div>
            <div>
              <Label className="text-xs">Variáveis disponíveis (clique para inserir)</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {AVAILABLE_VARIABLES.map((v) => (
                  <button
                    key={v.token}
                    type="button"
                    onClick={() => insertVar(v.token)}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-muted hover:bg-muted/70 font-mono"
                    title={v.description}
                  >
                    {v.token}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {type === "buttons" && (
          <ButtonsEditor
            buttons={node.data.buttons || []}
            onChange={(buttons) => patchData({ buttons })}
          />
        )}

        {type === "wait" && (
          <WaitEditor data={node.data} onChange={patchData} />
        )}

        {type === "condition" && (
          <div>
            <Label>Expressão</Label>
            <Input
              value={node.data.expression || ""}
              onChange={(e) => patchData({ expression: e.target.value })}
              placeholder="lead.status = 'ganho'"
            />
          </div>
        )}

        {(type === "kanban_move" || type === "kanban_update" || type === "kanban_tag") && (
          <div className="space-y-2">
            <div>
              <Label>{type === "kanban_move" ? "Coluna destino" : type === "kanban_tag" ? "Tag" : "Campo"}</Label>
              <Input
                value={node.data.value || ""}
                onChange={(e) => patchData({ value: e.target.value })}
              />
            </div>
            {type === "kanban_update" && (
              <div>
                <Label>Novo valor</Label>
                <Input
                  value={node.data.newValue || ""}
                  onChange={(e) => patchData({ newValue: e.target.value })}
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="p-4 border-t border-border flex justify-between">
        <Button variant="ghost" size="sm" className="text-destructive gap-2" onClick={onDelete}>
          <Trash2 className="w-3.5 h-3.5" /> Excluir nó
        </Button>
        <Button size="sm" onClick={() => { toast.success("Alterações salvas"); onClose(); }}>
          Concluir
        </Button>
      </div>
    </aside>
  );
}

function ButtonsEditor({
  buttons, onChange,
}: { buttons: { id: string; label: string }[]; onChange: (b: { id: string; label: string }[]) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label>Botões (máx 3)</Label>
        <Button
          size="sm"
          variant="outline"
          disabled={buttons.length >= 3}
          onClick={() => onChange([...buttons, { id: crypto.randomUUID().slice(0, 6), label: "Botão" }])}
        >
          <Plus className="w-3 h-3 mr-1" /> Adicionar
        </Button>
      </div>
      <div className="space-y-2">
        {buttons.map((b, i) => (
          <div key={b.id} className="flex gap-2">
            <Input
              value={b.label}
              onChange={(e) => {
                const c = [...buttons]; c[i] = { ...b, label: e.target.value }; onChange(c);
              }}
            />
            <Button size="icon" variant="ghost" onClick={() => onChange(buttons.filter((x) => x.id !== b.id))}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        ))}
        {buttons.length === 0 && (
          <p className="text-xs text-muted-foreground">Adicione até 3 botões de resposta rápida.</p>
        )}
      </div>
    </div>
  );
}

function WaitEditor({ data, onChange }: { data: any; onChange: (p: any) => void }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label className="text-xs">Minutos</Label>
          <Input type="number" value={data.minutes ?? ""} onChange={(e) => onChange({ minutes: Number(e.target.value) || undefined })} />
        </div>
        <div>
          <Label className="text-xs">Horas</Label>
          <Input type="number" value={data.hours ?? ""} onChange={(e) => onChange({ hours: Number(e.target.value) || undefined })} />
        </div>
        <div>
          <Label className="text-xs">Dias</Label>
          <Input type="number" value={data.days ?? ""} onChange={(e) => onChange({ days: Number(e.target.value) || undefined })} />
        </div>
      </div>
      <div>
        <Label className="text-xs">Ou X horas antes de um agendamento</Label>
        <Input
          type="number"
          value={data.beforeAppointmentHours ?? ""}
          onChange={(e) => onChange({ beforeAppointmentHours: Number(e.target.value) || undefined })}
        />
      </div>
    </div>
  );
}
