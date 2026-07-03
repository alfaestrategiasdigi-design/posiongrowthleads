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
import { toast } from "sonner";
import { ArrowLeft, Save, Play, Pause, FlaskConical } from "lucide-react";
import { nodeTypes } from "@/components/automations/FlowNodes";
import NodePalette from "@/components/automations/NodePalette";
import NodeEditorPanel from "@/components/automations/NodeEditorPanel";
import { TRIGGERS, type AutomationFlow, type FlowNode, type NodeKind, type TriggerKind } from "@/lib/automations/types";

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
      setNodes((f.nodes || []).map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })));
      setEdges((f.edges || []).map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label })));
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
    const newNode: Node = {
      id, type: kind,
      position: { x: 300 + Math.random() * 100, y: 200 + Math.random() * 100 },
      data: { label },
    };
    setNodes((n) => [...n, newNode]);
    setSelectedId(id);
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
    const payload = {
      name: flow.name,
      description: flow.description,
      trigger_type: flow.trigger_type,
      trigger_config: flow.trigger_config,
      status: flow.status,
      nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label })),
    };
    const { error } = await supabase.from("automation_flows").update(payload).eq("id", flow.id);
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

  const testFlow = () => {
    toast.info("Modo teste: enviaria mensagens para o número fictício +55 11 90000-0000");
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
          <Button size="sm" variant="outline" onClick={testFlow} className="gap-1"><FlaskConical className="w-4 h-4" /> Testar</Button>
          <Button size="sm" variant="outline" onClick={toggleStatus} className="gap-1">
            {flow.status === "active" ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {flow.status === "active" ? "Pausar" : "Ativar"}
          </Button>
          <Button size="sm" onClick={save} disabled={saving} className="gap-1"><Save className="w-4 h-4" /> Salvar</Button>
        </div>
      </div>

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
      </div>
    </div>
  );
}
