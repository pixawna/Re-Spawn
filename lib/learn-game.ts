import type { GraphMap } from "./api";
export type Position = [number, number];
export const WALLS = new Set([
  "1,1",
  "3,1",
  "5,1",
  "1,3",
  "3,3",
  "5,3",
  "1,5",
  "3,5",
  "5,5",
]);
export const STATIONS: Position[] = [
  [0, 0],
  [6, 0],
  [2, 2],
  [4, 4],
  [6, 6],
];
export function stationAt([x, y]: Position) {
  return STATIONS.findIndex(([a, b]) => a === x && b === y);
}
export function moveExplorer(
  position: Position,
  dx: number,
  dy: number,
): Position {
  if (Math.abs(dx) + Math.abs(dy) !== 1) return position;
  const [x, y] = [position[0] + dx, position[1] + dy];
  return x < 0 || x > 6 || y < 0 || y > 6 || WALLS.has(`${x},${y}`)
    ? position
    : [x, y];
}
export function buildLessons(graph: GraphMap) {
  const cause = graph.nodes.find((n) => n.blocked && n.reason);
  const migration =
    graph.nodes.find((n) => n.kind === "migration" && n.state === "valid") ??
    graph.nodes.find((n) => n.kind === "migration");
  const prerequisites = graph.edges.filter((e) => e.kind === "REQUIRES");
  const label = (id: string) =>
    graph.nodes.find((n) => n.id === id)?.label ?? id;
  const learned = graph.edges.filter((e) => e.learned);
  const proof = graph.nodes.find((n) => n.kind === "verification");
  return [
    {
      title: "Cause",
      fact: cause
        ? `${cause.label}: ${cause.reason}`
        : "No explicit incompatibility reason is present in this map snapshot. A real diagnosis log is needed to establish the cause.",
      source: cause?.id ?? "Project graph snapshot · no cause fact",
      question: "What establishes that a project is broken?",
      options: [
        "Its age alone",
        "A real failed command and its error evidence",
      ],
      correct: 1,
      retry:
        "An old project can still work. Look for the observed command failure.",
    },
    {
      title: "Route",
      fact: migration
        ? `${migration.label}. Cost ${migration.cost ?? "not recorded"}; risk ${migration.risk ?? "not recorded"}. ${migration.why ?? ""}`
        : "No migration node is present. The planner needs compatible migration facts before it can choose a repair.",
      source: migration?.id ?? "Project graph snapshot · no migration",
      question: "How does Re:Spawn select a recovery route?",
      options: [
        "FalkorDB compares feasible weighted paths",
        "Pick the newest package every time",
      ],
      correct: 0,
      retry:
        "The newest version can introduce another conflict. Feasibility, prerequisites, cost and risk matter.",
    },
    {
      title: "Order",
      fact: prerequisites.length
        ? prerequisites
            .map((e) => `${label(e.source)} requires ${label(e.target)} first.`)
            .join(" ")
        : "No explicit REQUIRES edge is visible in this snapshot. Prerequisites can also be derived from conflicts during planning.",
      source: prerequisites.length
        ? "Migration -[:REQUIRES]-> Migration"
        : "Project graph snapshot · no explicit prerequisite",
      question: "What should happen to a prerequisite migration?",
      options: [
        "Skip it if the main change looks simple",
        "Apply it before the migration that needs it",
      ],
      correct: 1,
      retry:
        "A missing prerequisite can make an otherwise valid upgrade fail. Follow the graph order.",
    },
    {
      title: "Memory",
      fact: learned.length
        ? `${learned.length} learned relationship(s) visible: ${learned.map((e) => `${label(e.source)} → ${label(e.target)}: ${e.reason ?? e.kind}`).join("; ")}`
        : "No learned relationship is visible on this map. Re:Spawn can learn supported conflicts from real failed attempts and reuse them across projects.",
      source: learned.length
        ? "CONFLICTS_WITH {learned:true}"
        : "Project graph snapshot · no learned edge",
      question: "When should a new conflict become a learned fact?",
      options: [
        "When an actual failure supports the relationship",
        "Whenever an agent guesses a conflict",
      ],
      correct: 0,
      retry:
        "Guesses are not evidence. Learned conflict facts need an observed failure.",
    },
    {
      title: "Proof",
      fact: proof
        ? `${proof.label}: ${proof.sub ?? proof.status ?? "See the run report for verification details."}`
        : "No verification node is present in this snapshot. This project has not earned proof from this view.",
      source: proof?.id ?? "Project graph snapshot · no verification",
      question: "What is needed for the alive status?",
      options: [
        "A working screenshot alone",
        "Successful build, passing tests and HTTP smoke checks",
      ],
      correct: 1,
      retry:
        "A screenshot cannot establish build and test results. Check all three verification signals.",
    },
  ];
}
