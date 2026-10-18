export const API = (
  process.env.NEXT_PUBLIC_RESPAWN_API ||
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000")
).replace(/\/$/, "");

export type Status =
  "unverified" | "diagnosing" | "dead" | "alive" | "build-passing" | string;

export type Project = {
  id: string;
  name: string;
  owner: string;
  source: string;
  ecosystem?: string;
  status: Status;
  description: string;
  runtime: string | null;
  attempts: number;
  packages: { id: string; range: string; blocked: boolean }[];
  run: RunInfo | null;
};

export type RunInfo = {
  id: string;
  project: string;
  status: string;
  phase: string;
  active_plan: string[];
  active_step: string | null;
  certificate: Certificate | null;
};

export type Certificate = {
  project: string;
  owner: string;
  run: string;
  source: string;
  issued: string;
  ecosystem?: string;
  environment?: { id?: string; kind: string; version: string };
  before: Record<string, string>;
  after: Record<string, string>;
  steps: string[];
  attempts: {
    n: number;
    titles: string[];
    outcome: string;
    error?: string;
    stage?: string;
  }[];
  tests: { passed: number; failed: number };
  verification?: {
    build: boolean;
    tests_passed: number;
    tests_failed: number;
    smoke: boolean;
  };
  smoke: { url: string; status: number; bytes: number }[];
  status: string;
  graph: string;
  node: string;
  patch: string;
  duration: number;
  preview: string | null;
  decision_trace?: RunEvent[];
  verification_scope?: string;
};

export type MapNode = {
  id: string;
  kind:
    | "project"
    | "package"
    | "runtime"
    | "migration"
    | "target"
    | "runtime-target"
    | "attempt"
    | "verification";
  label: string;
  sub?: string;
  status?: string;
  blocked?: boolean;
  retired?: boolean;
  reason?: string | null;
  mkind?: string;
  cost?: number;
  risk?: string;
  why?: string;
  source?: string;
  state?: string;
  reasons?: string[];
  recipe?: Record<string, string>[];
  outcome?: string;
  error_class?: string;
};

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  state?: string;
  learned?: boolean;
  reason?: string;
  healed?: boolean;
};

export type Plan = {
  id: string;
  steps: string[];
  titles: string[];
  cost: number;
  feasible: boolean;
  reasons: string[];
  approval_required?: boolean;
  shared_learning?: Record<string, unknown>[];
  evidence?: {
    query: string;
    params: Record<string, unknown>;
    result: unknown[];
    row_count?: number;
    tag?: string;
  }[];
};

export type GraphMap = {
  layout?: "recovery" | "chain";
  nodes: MapNode[];
  edges: MapEdge[];
  plans: Plan[];
  attempts: { id: string; outcome: string; summary: string; steps: string[] }[];
  run: RunInfo | null;
};

export type Rules = {
  teach_conflict: boolean;
  conflict_learned: boolean;
  allow_workarounds: boolean;
  conflict: { a: string; b: string };
};

export type RunEvent = {
  seq: number;
  type: string;
  t: number;
  [k: string]: unknown;
};

// Hosted demo mode: a page can install window.__RESPAWN_REPLAY__ to serve recorded runs instead of a live backend.
type Replay = {
  fetch: (path: string, init?: RequestInit) => Promise<unknown>;
  EventSource: typeof EventSource;
  asset: (path: string) => string;
  text: (path: string) => string;
};

export function replay(): Replay | null {
  if (typeof window === "undefined") return null;
  return (
    (window as unknown as { __RESPAWN_REPLAY__?: Replay }).__RESPAWN_REPLAY__ ??
    null
  );
}

export function assetUrl(path: string) {
  const r = replay();
  return r ? r.asset(path) : API + path;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = replay();
  if (r) return (await r.fetch(path, init)) as T;
  const res = await fetch(API + path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      msg = body.detail || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export function environmentLabel(
  environment: { kind: string; version: string } | string | null,
) {
  if (!environment) return "Unknown environment";
  const [kind, version] =
    typeof environment === "string"
      ? environment.split("@")
      : [environment.kind, environment.version];
  const names: Record<string, string> = {
    node: "Node.js",
    python: "Python",
    jdk: "JDK",
  };
  return `${names[kind] ?? kind} ${version ?? ""}`.trim();
}
