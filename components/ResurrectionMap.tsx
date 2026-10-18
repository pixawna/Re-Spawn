"use client";
import { memo, useMemo } from "react";
import {
  ReactFlow,
  Handle,
  Position,
  MarkerType,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Pixel from "./Pixel";
import {
  heart,
  reaper,
  skull,
  tombstone,
  tombstoneCracked,
  crt,
  type Mood,
} from "@/lib/sprites";
import type { GraphMap, MapEdge, MapNode } from "@/lib/api";

type Data = MapNode & { mori?: Mood | null; selected?: boolean };

const ROW: Record<MapNode["kind"], number> = {
  project: 0,
  package: 150,
  runtime: 150,
  migration: 320,
  target: 490,
  "runtime-target": 490,
  attempt: 640,
  verification: 790,
};

const COLOR = {
  valid: "#7dff8a",
  active: "#7dff8a",
  searching: "#ffb648",
  failed: "#ff6b6b",
  pruned: "#5b5478",
  candidate: "#a898e0",
  unexplored: "#4b3a7d",
};

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Top} id="t" />
      <Handle type="source" position={Position.Bottom} id="b" />
      <Handle type="source" position={Position.Right} id="r" />
      <Handle type="target" position={Position.Left} id="l" />
      <Handle type="source" position={Position.Left} id="ls" />
      <Handle type="target" position={Position.Right} id="rt" />
    </>
  );
}

function MoriBadge({ mood }: { mood: Mood }) {
  return (
    <span className="mori-on-node" aria-label="Mori is here">
      <Pixel sprite={reaper(mood)} scale={2} />
    </span>
  );
}

const RelicNode = memo(function RelicNode({ data }: NodeProps<Node<Data>>) {
  const d = data;
  const riskLabel =
    d.risk === "high" ? "risky" : d.risk === "medium" ? "some risk" : "safe";
  if (d.kind === "project") {
    const alive = d.status === "alive" || d.status === "build-passing";
    return (
      <div className={`relic relic-project ${d.selected ? "is-selected" : ""}`}>
        <Handles />
        {d.mori && <MoriBadge mood={d.mori} />}
        <Pixel
          sprite={
            alive ? crt : d.status === "dead" ? tombstoneCracked : tombstone
          }
          scale={2}
        />
        <div>
          <strong>{d.label}</strong>
          <small>
            {d.status === "alive"
              ? "alive"
              : d.status === "build-passing"
                ? "build passing · verification incomplete"
                : d.status === "dead"
                  ? "build fails"
                  : d.status || "unverified"}
          </small>
        </div>
      </div>
    );
  }
  if (d.kind === "verification") {
    return (
      <div className={`relic relic-heart ${d.selected ? "is-selected" : ""}`}>
        <Handles />
        {d.mori && <MoriBadge mood={d.mori} />}
        <Pixel sprite={heart} scale={4} className="beating" />
        <div>
          <strong>Heartbeat</strong>
          <small>{d.sub}</small>
        </div>
      </div>
    );
  }
  if (d.kind === "attempt") {
    const ok = d.outcome === "success";
    return (
      <div
        className={`relic relic-attempt ${ok ? "ok" : "bad"} ${d.selected ? "is-selected" : ""}`}
      >
        <Handles />
        <Pixel sprite={ok ? heart : skull} scale={2} />
        <div>
          <strong>{d.label}</strong>
          <small>
            {ok
              ? "verified"
              : d.outcome === "build-passing"
                ? "build passing · verification incomplete"
                : d.error_class?.replace(/_/g, " ") || "failed"}
          </small>
        </div>
      </div>
    );
  }
  if (d.kind === "migration") {
    return (
      <div
        className={`relic relic-migration state-${d.state} kind-${d.mkind} ${d.selected ? "is-selected" : ""}`}
      >
        <Handles />
        {d.mori && <MoriBadge mood={d.mori} />}
        <span className="rune" aria-hidden>
          {d.mkind === "runtime"
            ? "⏚"
            : d.mkind === "workaround"
              ? "⚠"
              : d.mkind === "replace"
                ? "⇄"
                : "⇡"}
        </span>
        <div>
          <strong>{d.label}</strong>
          <small>
            cost {d.cost} · {riskLabel}
            {d.state === "pruned"
              ? " · ruled out"
              : d.state === "failed"
                ? " · failed"
                : ""}
          </small>
        </div>
      </div>
    );
  }
  const isRuntime = d.kind === "runtime" || d.kind === "runtime-target";
  return (
    <div
      className={`relic relic-pkg ${isRuntime ? "is-runtime" : ""} ${d.kind.includes("target") ? "is-target" : ""} ${
        d.blocked ? "is-blocked" : ""
      } ${d.retired ? "is-retired" : ""} ${d.selected ? "is-selected" : ""}`}
    >
      <Handles />
      {d.mori && <MoriBadge mood={d.mori} />}
      <div>
        <strong>{d.label}</strong>
        <small>{d.sub}</small>
      </div>
      {d.blocked && <span className="crack" aria-label="incompatible" />}
    </div>
  );
});

const nodeTypes = { relic: RelicNode };

function layout(map: GraphMap): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  if (map.layout === "chain") {
    map.nodes.forEach((node, index) => {
      pos[node.id] = { x: index % 2 === 0 ? -110 : 110, y: index * 145 };
    });
    return pos;
  }
  const byKind = (k: MapNode["kind"][]) =>
    map.nodes.filter((n) => k.includes(n.kind));
  const place = (ids: string[], y: number, gap: number) => {
    ids.forEach(
      (id, i) => (pos[id] = { x: (i - (ids.length - 1) / 2) * gap, y }),
    );
  };
  const project = byKind(["project"]);
  place(
    project.map((n) => n.id),
    ROW.project,
    0,
  );

  // Packages a migration moved the project TO sit on the target row, so the map reads top-down:
  // old version -> migration -> new version -> heartbeat.
  const migrated = new Set(
    map.edges.filter((e) => e.kind === "TO").map((e) => e.target),
  );
  const pk = byKind(["package"]).filter(
    (n) => n.retired || !migrated.has(n.id),
  );
  const current = pk.filter((n) => !n.retired);
  const retired = pk.filter((n) => n.retired);
  // Runtime first, blocked packages beside it, so INCOMPATIBLE_WITH edges stay short.
  const blockedFirst = (a: MapNode, b: MapNode) =>
    Number(!!b.blocked) - Number(!!a.blocked);
  const row1 = [
    ...byKind(["runtime"]),
    ...retired.sort(blockedFirst),
    ...current.sort(blockedFirst),
  ].map((n) => n.id);
  place(row1, ROW.package, 250);

  const fromOf = (id: string) =>
    map.edges.find((e) => e.kind === "FROM" && e.target === id)?.source;
  const runtimeId = byKind(["runtime"])[0]?.id || "";
  const migs = byKind(["migration"]).sort((a, b) => {
    const ia = row1.indexOf(
      (a.mkind === "runtime" ? runtimeId : fromOf(a.id)) || "",
    );
    const ib = row1.indexOf(
      (b.mkind === "runtime" ? runtimeId : fromOf(b.id)) || "",
    );
    return ia - ib || (a.cost || 0) - (b.cost || 0);
  });
  place(
    migs.map((n) => n.id),
    ROW.migration,
    215,
  );

  const toOf = (id: string) =>
    map.edges.find((e) => e.kind === "TO" && e.target === id)?.source;
  const targets = map.nodes.filter(
    (n) => !pos[n.id] && (n.kind.includes("target") || migrated.has(n.id)),
  );
  targets.sort(
    (a, b) =>
      migs.findIndex((m) => m.id === toOf(a.id)) -
      migs.findIndex((m) => m.id === toOf(b.id)),
  );
  // Put each target under its migration where possible.
  targets.forEach((t) => {
    const m = toOf(t.id);
    if (m && pos[m]) pos[t.id] = { x: pos[m].x, y: ROW.target };
  });
  const unplaced = targets.filter((t) => !pos[t.id]);
  place(
    unplaced.map((n) => n.id),
    ROW.target,
    210,
  );

  place(
    byKind(["attempt"]).map((n) => n.id),
    ROW.attempt,
    240,
  );
  place(
    byKind(["verification"]).map((n) => n.id),
    ROW.verification,
    0,
  );
  return pos;
}

function edgeStyle(e: MapEdge): Partial<Edge> {
  const base = { strokeWidth: 2 };
  switch (e.kind) {
    case "USES":
    case "RUNS_ON":
      return { style: { ...base, stroke: "#6f5fa8" } };
    case "USED":
      return { style: { ...base, stroke: "#4b3a7d", strokeDasharray: "2 6" } };
    case "INCOMPATIBLE_WITH":
      return {
        style: {
          ...base,
          stroke: e.healed ? "#7a4b5c" : "#ff6b6b",
          strokeDasharray: "6 5",
        },
        label: e.healed ? "was incompatible" : "incompatible",
        className: "edge-broken",
      };
    case "CONFLICTS_WITH":
      return {
        style: { ...base, stroke: "#ff6b6b", strokeDasharray: "3 4" },
        label: e.learned ? "conflict · learned" : "conflict",
        className: e.learned ? "edge-learned" : "",
      };
    case "REQUIRES":
      return {
        style: {
          ...base,
          stroke:
            COLOR[(e.state as keyof typeof COLOR) || "candidate"] || "#a898e0",
        },
        label: "requires first",
      };
    default: {
      const st = (e.state || "unexplored") as keyof typeof COLOR;
      const stroke = COLOR[st] || "#4b3a7d";
      const live = st === "active" || st === "searching";
      return {
        style: {
          ...base,
          stroke,
          strokeWidth: st === "valid" || live ? 3 : 2,
          strokeDasharray:
            st === "unexplored" || st === "pruned" ? "4 6" : undefined,
          opacity: st === "pruned" ? 0.55 : 1,
        },
        animated: live,
        className: `edge-${st}`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: stroke,
          width: 14,
          height: 14,
        },
      };
    }
  }
}

export default function ResurrectionMap({
  map,
  moriAt,
  mood,
  selectedId,
  onSelect,
  traceIds,
  highlightIds = [],
}: {
  map: GraphMap;
  traceIds?: string[];
  highlightIds?: string[];
  moriAt: string | null;
  mood: Mood;
  selectedId: string | null;
  onSelect: (n: MapNode | null) => void;
}) {
  const { nodes, edges } = useMemo(() => {
    const pos = traceIds
      ? Object.fromEntries(traceIds.map((id, i) => [id, { x: 0, y: i * 140 }]))
      : layout(map);
    const nodes: Node<Data>[] = map.nodes.map((n) => ({
      id: n.id,
      type: "relic",
      position: { x: (pos[n.id]?.x ?? 0) - 85, y: pos[n.id]?.y ?? 0 },
      data: {
        ...n,
        mori: moriAt === n.id ? mood : null,
        selected: selectedId === n.id || highlightIds.includes(n.id),
      },
      draggable: false,
    }));
    const edges: Edge[] = map.edges
      .filter((e) => pos[e.source] && pos[e.target])
      .map((e) => {
        const a = pos[e.source],
          b = pos[e.target];
        const sameRow = Math.abs(a.y - b.y) < 20;
        const handles = sameRow
          ? a.x < b.x
            ? { sourceHandle: "r", targetHandle: "l" }
            : { sourceHandle: "ls", targetHandle: "rt" }
          : a.y < b.y
            ? { sourceHandle: "b", targetHandle: "t" }
            : { sourceHandle: "b", targetHandle: "t" };
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "smoothstep",
          ...handles,
          labelBgStyle: { fill: "#1b1433" },
          labelStyle: {
            fill: "#ece4ff",
            fontFamily: "var(--font-pixel)",
            fontSize: 11,
          },
          labelBgPadding: [4, 2] as [number, number],
          ...edgeStyle(
            highlightIds.includes(e.source) && highlightIds.includes(e.target)
              ? { ...e, state: "active" }
              : e,
          ),
        };
      });
    return { nodes, edges };
  }, [map, moriAt, mood, selectedId, traceIds, highlightIds]);

  return (
    <div className="map-canvas">
      <ReactFlow
        key={map.nodes.length}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 1.05 }}
        minZoom={0.3}
        maxZoom={1.6}
        nodesConnectable={false}
        nodesDraggable={false}
        elementsSelectable
        onNodeClick={(_, n) =>
          onSelect(map.nodes.find((x) => x.id === n.id) || null)
        }
        onPaneClick={() => onSelect(null)}
        aria-label="Resurrection map from FalkorDB"
      />
    </div>
  );
}
