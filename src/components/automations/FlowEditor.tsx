import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow, ReactFlowProvider, Background, Controls, MiniMap,
  applyNodeChanges, applyEdgeChanges, addEdge,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { ArrowLeft, Save, Play, Pause, FlaskConical, LayoutGrid } from "lucide-react";
import { nodeTypes } from "@/components/automations/FlowNodes";
import NodePalette from "@/components/automations/NodePalette";
import NodeEditorPanel from "@/components/automations/NodeEditorPanel";
import { TRIGGERS, type AutomationFlow, type FlowNode, type NodeKind, type TriggerKind } from "@/lib/automations/types";
import { sanitizeButtonLabel } from "@/lib/automations/buttonLabels";
import { layoutLR, looksVertical } from "@/lib/automations/layout";

interface Props {
  flowId: string;
  onBack: () => void;
}

export default function FlowEditor({ flowId, onBack }: Props) {
  const [flow, setFlow] = useState<AutomationFlow | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("automation_flows").select("*").eq("id", flowId).maybeSingle();
      if (error || !data) { toast.error("Fluxo não encontrado"); return; }
      const f = data as any as AutomationFlow;
      setFlow(f);
      const rawNodes: Node[] = (f.nodes || []).map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data }));
      const rawEdges: Edge[] = (f.edges || []).map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }));
      // Migração automática: fluxos antigos em orientação vertical viram LR sem perder as arestas.
      const migrated = looksVertical(rawNodes, rawEdges) ? layoutLR(rawNodes, rawEdges) : rawNodes;
      setNodes(migrated);
      setEdges(rawEdges);
    })();
  }, [flowId]);

  const selectedNode: FlowNode | null = useMemo(() => {
    if (!selectedId) return null;
    const n = nodes.find((x) => x.id === selectedId);
    if (!n) return null;
    return { id: n.id, type: n.type as NodeKind, position: n.position, data: n.data as any };
  }, [selectedId, nodes]);

  const addNode = (kind: NodeKind, label: string) => {
    const id = crypto.randomUUID().slice(0, 8);
    // Coloca o novo nó à direita do último (fluxo horizontal).
    const last = nodes[nodes.length - 1];
    const pos = last
      ? { x: (last.position?.x ?? 0) + 300, y: (last.position?.y ?? 0) }
      : { x: 80, y: 120 };
    const newNode: Node = { id, type: kind, position: pos, data: { label } };
    setNodes((n) => [...n, newNode]);
    setSelectedId(id);
  };

  const autoLayout = () => {
    setNodes((ns) => layoutLR(ns, edges));
    toast.success("Fluxo organizado horizontalmente");
  };

  const onNodesChange = useCallback((c: NodeChange[]) => setNodes((n) => applyNodeChanges(c, n)), []);
  const onEdgesChange = useCallback((c: EdgeChange[]) => setEdges((e) => applyEdgeChanges(c, e)), []);
  const onConnect = useCallback((c: Connection) => setEdges((e) => addEdge({ ...c, id: crypto.randomUUID().slice(0, 8) }, e)), []);

  const updateNode = (patch: Partial<FlowNode>) => {
    if (!selectedId) return;
    setNodes((ns) => ns.map((n) => n.id === selectedId ? { ...n, ...patch, data: { ...n.data, ...(patch.data || {}) } } : n));
  };
  const deleteNode = () => {
    if (!selectedId) return;
    setNodes((ns) => ns.filter((n) => n.id !== selectedId));
    setEdges((es) => es.filter((e) => e.source !== selectedId && e.target !== selectedId));
    setSelectedId(null);
  };

  const save = async () => {
    if (!flow) return;
    setSaving(true);
    const normalizedNodes = nodes.map((n) => {
      if (n.type !== "buttons") return n;
      const buttons = Array.isArray((n.data as any)?.buttons)
        ? (n.data as any).buttons.slice(0, 3).map((b: any, i: number) => ({
          ...b,
          label: sanitizeButtonLabel(b?.label, `Opção ${i + 1}`),
        }))
        : [];
      return { ...n, data: { ...n.data, buttons } };
    });
    setNodes(normalizedNodes);
    const payload = {
      name: flow.name,
      description: flow.description,
      trigger_type: flow.trigger_type,
      trigger_config: flow.trigger_config,
      status: flow.status,
      nodes: normalizedNodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })) as any,
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: typeof e.label === "string" ? e.label : undefined })) as any,
    };
    const { error } = await supabase.from("automation_flows").update(payload as any).eq("id", flow.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Fluxo salvo");
  };

  const toggleStatus = async () => {
    if (!flow) return;
    const next = flow.status === "active" ? "paused" : "active";
    const { error } = await supabase.from("automation_flows").update({ status: next }).eq("id", flow.id);
    if (error) return toast.error(error.message);
    setFlow({ ...flow, status: next });
    toast.success(next === "active" ? "Fluxo ativado" : "Fluxo pausado");
  };

  const [testLog, setTestLog] = useState<Array<{ node_id: string; node_type: string; ok: boolean; detail?: string }> | null>(null);
  const [testing, setTesting] = useState(false);
  const testFlow = async () => {
    if (!flow) return;
    // Save first so dispatcher sees latest nodes/edges
    await save();
    setTesting(true);
    setTestLog([]);
    const testPhone = window.prompt("Telefone de teste (opcional — só para simular envios):", "5511900000000") || "";
    const testText = flow.trigger_type === "message_received"
      ? (window.prompt("Texto simulado da mensagem recebida:", "teste") || "teste")
      : "";
    try {
      const { data, error } = await supabase.functions.invoke("automation-dispatch", {
        body: {
          trigger: flow.trigger_type,
          tenant_id: flow.tenant_id,
          flow_id: flow.id,
          dry_run: true,
          context: { phone: testPhone, name: "Teste", text: testText, form_name: "teste" },
        },
      });
      if (error) throw error;
      const run = (data as any)?.runs?.[0];
      setTestLog(run?.steps || []);
      toast.success(`Simulação concluída (${run?.steps?.length || 0} passos)`);
    } catch (e: any) {
      toast.error(`Falha no teste: ${e.message || e}`);
    } finally {
      setTesting(false);
    }
  };


  if (!flow) {
    return <div className="h-full flex items-center justify-center text-muted-foreground">Carregando…</div>;
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex flex-col">
      {/* Toolbar */}
      <div className="border-b border-border p-3 flex items-center gap-3 bg-background/50 backdrop-blur">
        <Button size="sm" variant="ghost" onClick={onBack} className="gap-1"><ArrowLeft className="w-4 h-4" /> Voltar</Button>
        <Input
          className="max-w-sm"
          value={flow.name}
          onChange={(e) => setFlow({ ...flow, name: e.target.value })}
          placeholder="Nome do fluxo"
        />
        <Select value={flow.trigger_type} onValueChange={(v) => setFlow({ ...flow, trigger_type: v as TriggerKind })}>
          <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TRIGGERS.map((t) => <SelectItem key={t.kind} value={t.kind}>{t.icon} {t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge variant={flow.status === "active" ? "default" : flow.status === "paused" ? "secondary" : "outline"}>
          {flow.status}
        </Badge>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={autoLayout} className="gap-1"><LayoutGrid className="w-4 h-4" /> Organizar</Button>
          <Button size="sm" variant="outline" onClick={testFlow} disabled={testing} className="gap-1"><FlaskConical className="w-4 h-4" /> {testing ? "Testando…" : "Testar"}</Button>
          <Button size="sm" variant="outline" onClick={toggleStatus} className="gap-1">
            {flow.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {flow.status === "active" ? "Pausar" : "Ativar"}
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1"><Save className="w-4 h-4" /> Salvar</Button>
        </div>
      </div>

      {/* Trigger configuration */}
      <TriggerConfig
        trigger={flow.trigger_type}
        config={flow.trigger_config || {}}
        tenantId={flow.tenant_id ?? null}
        onChange={(cfg) => setFlow({ ...flow, trigger_config: cfg })}
      />

      {/* Body: palette + canvas + editor */}
      <div className="flex-1 flex overflow-hidden">

        <NodePalette onAdd={addNode} />
        <div className="flex-1 relative" style={{ background: "#0d0d14" }}>
          <ReactFlowProvider>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={(_, n) => setSelectedId(n.id)}
              onPaneClick={() => setSelectedId(null)}
              fitView
              panOnScroll
              panOnScrollMode={"horizontal" as any}
              defaultEdgeOptions={{ style: { stroke: "hsl(220 20% 50%)", strokeWidth: 2 } }}
            >
              <Background gap={20} size={1} color="hsl(220 15% 20%)" />
              <Controls />
              <MiniMap
                pannable zoomable
                nodeColor={() => "hsl(220 30% 40%)"}
                style={{ background: "#111118", border: "1px solid hsl(220 15% 20%)" }}
              />
            </ReactFlow>
          </ReactFlowProvider>
        </div>
        {selectedNode && (
          <NodeEditorPanel
            node={selectedNode}
            onChange={updateNode}
            onClose={() => setSelectedId(null)}
            onDelete={deleteNode}
          />
        )}
        {testLog && (

          <aside className="w-[340px] shrink-0 border-l border-border bg-card/40 h-full flex flex-col">
            <div className="p-3 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-xs uppercase text-muted-foreground">Simulação</div>
                <div className="text-sm font-semibold">{testLog.length} passo(s)</div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setTestLog(null)}>Fechar</Button>
            </div>
            <div className="flex-1 overflow-auto p-3 space-y-2 text-xs">
              {testLog.length === 0 && <div className="text-muted-foreground">Nenhum passo executado.</div>}
              {testLog.map((s, i) => (
                <div key={i} className={`rounded border p-2 ${s.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
                  <div className="font-mono text-[11px] opacity-70">#{i + 1} · {s.node_type}</div>
                  <div className="text-[11px]">{s.detail || "(sem detalhe)"}</div>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>

    </div>
  );
}

function TriggerConfig({
  trigger,
  config,
  tenantId,
  onChange,
}: {
  trigger: TriggerKind;
  config: Record<string, any>;
  tenantId: string | null;
  onChange: (cfg: Record<string, any>) => void;
}) {
  const patch = (p: Record<string, any>) => onChange({ ...config, ...p });
  const [availableForms, setAvailableForms] = useState<Array<{ name: string; id: string | null; count: number }>>([]);

  useEffect(() => {
    if (trigger !== "form_submitted" && trigger !== "lead_entered") return;
    (async () => {
      let q = supabase
        .from("leads")
        .select("facebook_form_name, facebook_form_id")
        .not("facebook_form_name", "is", null)
        .limit(500);
      if (tenantId) q = q.eq("tenant_id", tenantId);
      else q = q.is("tenant_id", null);
      const { data } = await q;
      const map = new Map<string, { name: string; id: string | null; count: number }>();
      for (const row of (data as any[]) || []) {
        const name = String(row.facebook_form_name || "").trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const prev = map.get(key);
        if (prev) prev.count += 1;
        else map.set(key, { name, id: row.facebook_form_id || null, count: 1 });
      }
      setAvailableForms(Array.from(map.values()).sort((a, b) => b.count - a.count));
    })();
  }, [trigger, tenantId]);

  const renderBody = () => {
    if (trigger === "message_received") {
      return (
        <div className="grid grid-cols-1 md:grid-cols-[1fr_180px] gap-3">
          <div>
            <Label className="text-xs">Palavras / mensagem de ativação</Label>
            <Textarea
              rows={2}
              value={(config.keywords as string) || ""}
              onChange={(e) => patch({ keywords: e.target.value })}
              placeholder="Ex.: oi, olá, quero saber, informações"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Separe por vírgula. O fluxo dispara quando a mensagem recebida contiver qualquer uma dessas palavras. Deixe vazio para disparar em qualquer mensagem.
            </p>
          </div>
          <div>
            <Label className="text-xs">Correspondência</Label>
            <Select
              value={(config.match as string) || "contains"}
              onValueChange={(v) => patch({ match: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contains">Contém</SelectItem>
                <SelectItem value="exact">Igual exato</SelectItem>
                <SelectItem value="starts_with">Começa com</SelectItem>
                <SelectItem value="regex">Expressão regular</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      );
    }
    if (trigger === "form_submitted" || trigger === "lead_entered") {
      const currentName = (config.form_name as string) || "";
      const currentId = (config.form_id as string) || "";
      const selectValue = currentId ? `id:${currentId}` : currentName ? `name:${currentName}` : "";
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Formulário (obrigatório)</Label>
            <Select
              value={selectValue}
              onValueChange={(v) => {
                if (!v) return;
                if (v.startsWith("id:")) {
                  const id = v.slice(3);
                  const f = availableForms.find((x) => x.id === id);
                  patch({ form_id: id, form_name: f?.name || "" });
                } else if (v.startsWith("name:")) {
                  patch({ form_name: v.slice(5), form_id: "" });
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={availableForms.length ? "Selecione um formulário…" : "Nenhum formulário detectado ainda"} />
              </SelectTrigger>
              <SelectContent>
                {availableForms.map((f) => (
                  <SelectItem key={(f.id || f.name)} value={f.id ? `id:${f.id}` : `name:${f.name}`}>
                    {f.name} {f.id ? `(#${f.id.slice(-6)})` : ""} · {f.count}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Escolha o formulário específico. Fluxos sem formulário selecionado <b>não disparam</b> (evita spam em massa).
            </p>
          </div>
          <div>
            <Label className="text-xs">Ou digite o nome manualmente</Label>
            <Input
              value={currentName}
              onChange={(e) => patch({ form_name: e.target.value, form_id: "" })}
              placeholder="Ex.: Formulário Botox — Instagram"
            />
            {currentId && (
              <p className="text-[11px] text-muted-foreground mt-1">
                form_id vinculado: <code>{currentId}</code>
              </p>
            )}
          </div>
        </div>
      );
    }
    if (trigger === "kanban_moved") {
      return (
        <div>
          <Label className="text-xs">Ao mover para a coluna</Label>
          <Input
            value={(config.column as string) || ""}
            onChange={(e) => patch({ column: e.target.value })}
            placeholder="Ex.: Qualificado"
          />
        </div>
      );
    }
    if (trigger === "time_delay") {
      return (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">Após (horas)</Label>
            <Input
              type="number"
              value={config.hours ?? ""}
              onChange={(e) => patch({ hours: Number(e.target.value) || undefined })}
            />
          </div>
          <div>
            <Label className="text-xs">Do evento</Label>
            <Input
              value={(config.event as string) || ""}
              onChange={(e) => patch({ event: e.target.value })}
              placeholder="lead_created, appointment_created…"
            />
          </div>
        </div>
      );
    }
    return (
      <p className="text-xs text-muted-foreground">
        Este gatilho não possui configurações adicionais.
      </p>
    );
  };

  return (
    <div className="border-b border-border bg-card/20 px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">
        Configuração do gatilho
      </div>
      {renderBody()}
    </div>
  );
}

