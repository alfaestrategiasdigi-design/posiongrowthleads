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
          <>
            <div>
              <Label>Título (opcional)</Label>
              <Input value={node.data.title || ""} onChange={(e) => patchData({ title: e.target.value })} placeholder="Ex.: Podemos te ajudar?" />
            </div>
            <div>
              <Label>Rodapé (opcional)</Label>
              <Input value={node.data.footer || ""} onChange={(e) => patchData({ footer: e.target.value })} placeholder="Ex.: Clínica XYZ" />
            </div>
            <ButtonsEditor
              buttons={node.data.buttons || []}
              onChange={(buttons) => patchData({ buttons })}
            />
            <p className="text-[10px] text-muted-foreground">O fluxo pausa aqui e retoma quando o contato clicar em um botão. Ligue arestas partindo deste nó — a ordem das arestas segue a ordem dos botões. Se o WhatsApp do lead não renderizar os botões nativos, o fluxo envia automaticamente como lista numerada (1, 2, 3) e roteia pela resposta.</p>
          </>
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

        {(type === "audio" || type === "media") && (
          <div className="space-y-2">
            <div>
              <Label>URL do arquivo</Label>
              <Input value={node.data.url || ""} onChange={(e) => patchData({ url: e.target.value })} placeholder="https://…" />
              <p className="text-[10px] text-muted-foreground mt-1">Cole uma URL pública (bucket `whatsapp-media` também funciona).</p>
            </div>
            {type === "media" && (
              <>
                <div>
                  <Label>Tipo</Label>
                  <select
                    className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={node.data.media_type || "image"}
                    onChange={(e) => patchData({ media_type: e.target.value })}
                  >
                    <option value="image">Imagem</option>
                    <option value="video">Vídeo</option>
                    <option value="document">Documento</option>
                  </select>
                </div>
                <div>
                  <Label>Legenda</Label>
                  <Textarea rows={2} value={node.data.caption || ""} onChange={(e) => patchData({ caption: e.target.value })} />
                </div>
              </>
            )}
          </div>
        )}

        {type === "list" && (
          <div className="space-y-2">
            <div>
              <Label>Título</Label>
              <Input value={node.data.title || ""} onChange={(e) => patchData({ title: e.target.value })} />
            </div>
            <div>
              <Label>Descrição / cabeçalho</Label>
              <Textarea rows={2} value={node.data.text || ""} onChange={(e) => patchData({ text: e.target.value })} />
            </div>
            <div>
              <Label>Texto do botão</Label>
              <Input value={node.data.buttonText || "Ver opções"} onChange={(e) => patchData({ buttonText: e.target.value })} />
            </div>
            <ListItemsEditor items={node.data.items || []} onChange={(items) => patchData({ items })} />
          </div>
        )}

        {type === "notify_team" && (
          <div className="space-y-2">
            <div>
              <Label>Mensagem para equipe</Label>
              <Textarea rows={3} value={node.data.text || ""} onChange={(e) => patchData({ text: e.target.value })} placeholder="Novo lead {{lead.nome}} — {{lead.whatsapp}}" />
            </div>
            <div>
              <Label>Telefones (separados por vírgula)</Label>
              <Input value={node.data.phones || ""} onChange={(e) => patchData({ phones: e.target.value })} placeholder="5511999999999, 5511988888888" />
            </div>
          </div>
        )}

        {type === "kanban_create" && (
          <div className="space-y-2">
            <div><Label>Nome</Label><Input value={node.data.nome || ""} onChange={(e) => patchData({ nome: e.target.value })} placeholder="{{lead.nome}}" /></div>
            <div><Label>WhatsApp</Label><Input value={node.data.whatsapp || ""} onChange={(e) => patchData({ whatsapp: e.target.value })} placeholder="{{lead.whatsapp}}" /></div>
            <div><Label>E-mail</Label><Input value={node.data.email || ""} onChange={(e) => patchData({ email: e.target.value })} /></div>
            <div><Label>Etapa inicial</Label><Input value={node.data.status || "lead"} onChange={(e) => patchData({ status: e.target.value })} /></div>
          </div>
        )}

        {type === "appointment_create" && (
          <div className="space-y-2">
            <div><Label>Tipo</Label><Input value={node.data.appointment_type || ""} onChange={(e) => patchData({ appointment_type: e.target.value })} placeholder="Avaliação" /></div>
            <div><Label>Responsável</Label><Input value={node.data.procedure || ""} onChange={(e) => patchData({ procedure: e.target.value })} /></div>
            <div><Label>Duração (min)</Label><Input type="number" value={node.data.duration || 60} onChange={(e) => patchData({ duration: Number(e.target.value) })} /></div>
            <p className="text-[10px] text-muted-foreground">A data/hora usa {"{{agendamento.data}}"} do contexto ou 24h a partir de agora.</p>
          </div>
        )}

        {type === "appointment_link" && (
          <div className="space-y-2">
            <div><Label>URL do agendamento</Label><Input value={node.data.url || ""} onChange={(e) => patchData({ url: e.target.value })} placeholder="https://…" /></div>
            <div><Label>Texto que acompanha</Label><Textarea rows={2} value={node.data.text || "Agende sua consulta:"} onChange={(e) => patchData({ text: e.target.value })} /></div>
          </div>
        )}

        {type === "wait_response" && (
          <p className="text-xs text-muted-foreground">O fluxo pausa aqui até o contato responder no WhatsApp. A próxima mensagem retoma o fluxo automaticamente.</p>
        )}

        {type === "split" && (
          <p className="text-xs text-muted-foreground">Divide o fluxo A/B 50/50 aleatório. Ligue dois nós posteriores.</p>
        )}

        {type === "end" && (
          <p className="text-xs text-muted-foreground">Encerra a execução do fluxo neste ponto.</p>
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

function ListItemsEditor({
  items, onChange,
}: { items: { id: string; label: string; description?: string }[]; onChange: (i: any[]) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <Label>Opções da lista</Label>
        <Button size="sm" variant="outline" onClick={() => onChange([...items, { id: crypto.randomUUID().slice(0, 6), label: "Opção", description: "" }])}>
          <Plus className="w-3 h-3 mr-1" /> Adicionar
        </Button>
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={it.id} className="rounded border border-border p-2 space-y-1">
            <div className="flex gap-2">
              <Input value={it.label} placeholder="Título" onChange={(e) => { const c = [...items]; c[i] = { ...it, label: e.target.value }; onChange(c); }} />
              <Button size="icon" variant="ghost" onClick={() => onChange(items.filter((x) => x.id !== it.id))}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
            <Input value={it.description || ""} placeholder="Descrição (opcional)" onChange={(e) => { const c = [...items]; c[i] = { ...it, description: e.target.value }; onChange(c); }} />
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-muted-foreground">Adicione as opções que o usuário poderá selecionar.</p>}
      </div>
    </div>
  );
}

