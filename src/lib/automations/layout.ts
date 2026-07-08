import dagre from "@dagrejs/dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_W = 240;
const NODE_H = 120;

export function layoutLR(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes;
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 120, marginx: 40, marginy: 40 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return p ? { ...n, position: { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 } } : n;
  });
}

// Heurística: layouts antigos (TB) têm a maioria das arestas com dy > dx.
export function looksVertical(nodes: Node[], edges: Edge[]): boolean {
  if (nodes.length < 2) return false;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let vertical = 0, horizontal = 0;
  for (const e of edges) {
    const a = byId.get(e.source); const b = byId.get(e.target);
    if (!a || !b) continue;
    const dx = Math.abs((b.position?.x ?? 0) - (a.position?.x ?? 0));
    const dy = Math.abs((b.position?.y ?? 0) - (a.position?.y ?? 0));
    if (dy > dx) vertical++; else horizontal++;
  }
  if (vertical + horizontal === 0) {
    // sem arestas: bounding box mais alto que largo?
    const xs = nodes.map((n) => n.position?.x ?? 0);
    const ys = nodes.map((n) => n.position?.y ?? 0);
    return (Math.max(...ys) - Math.min(...ys)) > (Math.max(...xs) - Math.min(...xs));
  }
  return vertical > horizontal;
}
