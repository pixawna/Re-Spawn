"use client";
import { useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  MarkerType,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
const facts: Record<string, string> = {
  broken:
    "Project USES node-sass@4. Runtime ABI is incompatible with the selected Node.js version.",
  runtime:
    "Rejected: upgrading Node.js alone does not satisfy the legacy native binding requirement.",
  sass: "Migration FROM node-sass TO sass removes the native binding prerequisite.",
  node: "Migration REQUIRES Sass replacement before changing the runtime to Node.js 22.",
  verified:
    "Demo verification: dependency install, production build, 8 tests, and browser smoke check passed.",
};
const nodes: Node[] = [
  {
    id: "broken",
    position: { x: 0, y: 100 },
    data: { label: "☠  Broken build\nnode-sass@4" },
    className: "graph-broken",
  },
  {
    id: "runtime",
    position: { x: 250, y: 0 },
    data: { label: "×  Runtime-only upgrade\nRejected · ABI conflict" },
    className: "graph-rejected",
  },
  {
    id: "sass",
    position: { x: 250, y: 180 },
    data: { label: "✦  Replace node-sass\nsass@1 · prerequisite" },
    className: "graph-success",
  },
  {
    id: "node",
    position: { x: 510, y: 180 },
    data: { label: "↗  Upgrade runtime\nNode.js 22" },
    className: "graph-success",
  },
  {
    id: "verified",
    position: { x: 770, y: 180 },
    data: { label: "✓  Verification\nBuild + tests + browser" },
    className: "graph-success",
  },
];
const edges: Edge[] = [
  {
    id: "a",
    source: "broken",
    target: "runtime",
    label: "CONFLICTS_WITH",
    style: { stroke: "#e38a9e" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#e38a9e" },
  },
  ...[
    ["broken", "sass"],
    ["sass", "node"],
    ["node", "verified"],
  ].map(([source, target], i) => ({
    id: `e${i}`,
    source,
    target,
    label: i === 1 ? "REQUIRES" : "RECOVERY_PATH",
    animated: true,
    style: { stroke: "#b8f49c" },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#b8f49c" },
  })),
];
export default function RecoveryGraph() {
  const [selected, setSelected] = useState("sass");
  return (
    <div>
      <div className="graph-canvas">
        <ReactFlow
          nodes={nodes.map((node) => ({
            ...node,
            sourcePosition: Position.Right,
            targetPosition: Position.Left,
          }))}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.35}
          maxZoom={1.6}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, node) => setSelected(node.id)}
          colorMode="dark"
          aria-label="Demo recovery routes"
        >
          <Background color="#443b56" gap={22} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="graph-fact">
        <span className="eyebrow">SELECTED GRAPH EVIDENCE · DEMO</span>
        <p>{facts[selected]}</p>
      </div>
    </div>
  );
}
