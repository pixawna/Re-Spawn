/* Replay engine for the hosted demo.
 *
 * Serves recordings of real Re:Spawn runs (captured from the live backend with
 * scripts/record-runs.py) through the same API surface the UI uses, so the real
 * UI runs unchanged. Each project has its own recorded run and its own clock,
 * which means you can leave a run, read another page and come back mid-run.
 */
type Json = Record<string, unknown>;
type Ev = Json & { seq: number; t: number; type: string };
type ProjectRec = {
  map_before: Json;
  maps: { seq: number; map: Json }[];
  events: Ev[];
  run_id: string;
  projects_after: Json[];
  get: Record<string, unknown>;
};
export type Recordings = {
  health: Json;
  rules: Json;
  projects_initial: Json[];
  projects: Record<string, ProjectRec>;
};

const LEAD_MS = 400;

export function installReplay(data: Recordings) {
  let rules = { ...data.rules };
  // Per project: when its recorded run started (ms), or null when it hasn't been run.
  const started = new Map<string, number | null>();
  const blobs = new Map<string, string>();

  const recFor = (pid: string) => data.projects[pid];
  const pidForRun = (rid: string) => Object.keys(data.projects).find((k) => data.projects[k].run_id === rid);
  const elapsed = (pid: string) => {
    const s = started.get(pid);
    return s == null ? -1 : (Date.now() - s - LEAD_MS) / 1000;
  };
  const phase = (pid: string): "before" | "running" | "after" => {
    const s = started.get(pid);
    if (s == null) return "before";
    const evs = recFor(pid).events;
    return elapsed(pid) >= evs[evs.length - 1].t ? "after" : "running";
  };
  const seen = (pid: string) => {
    const e = elapsed(pid);
    return recFor(pid).events.filter((ev) => ev.t <= e);
  };

  const projects = () =>
    data.projects_initial.map((p) => {
      const pid = String(p.id);
      const rec = recFor(pid);
      if (!rec) return p;
      const ph = phase(pid);
      if (ph === "after") return rec.projects_after.find((x) => x.id === pid) ?? p;
      if (ph === "running") {
        const evs = seen(pid);
        const last = [...evs].reverse().find((e) => e.type === "phase");
        return { ...p, status: "diagnosing", run: { id: rec.run_id, status: "running", phase: last?.phase ?? "diagnose", certificate: null } };
      }
      return p;
    });

  const currentMap = (pid: string) => {
    const rec = recFor(pid);
    const ph = phase(pid);
    if (ph === "before") return rec.map_before;
    const seq = ph === "after" ? Infinity : Math.max(-1, ...seen(pid).map((e) => e.seq));
    const maps = rec.maps.filter((m) => m.seq <= seq);
    return maps.length ? maps[maps.length - 1].map : rec.map_before;
  };

  const notHere = (what: string) =>
    new Error(`${what} needs the live backend. This hosted demo replays recorded runs; run Re:Spawn locally to try it.`);

  async function fetchRoute(path: string, init?: RequestInit): Promise<unknown> {
    const method = (init?.method || "GET").toUpperCase();
    await new Promise((r) => setTimeout(r, 60));
    if (path === "/api/health") return { ...data.health, graph: { mode: "replay", detail: "recorded runs" } };
    if (path === "/api/projects" && method === "GET") return projects();
    if (path === "/api/projects" && method === "POST") throw notHere("Importing your own repository");
    if (path === "/api/rules" && method === "GET") return rules;
    if (path === "/api/rules" && method === "POST") {
      rules = { ...rules, ...JSON.parse(String(init?.body || "{}")) };
      return rules;
    }
    const m = path.match(/^\/api\/projects\/([^/]+)\/([a-z-]+)$/);
    if (m && recFor(m[1])) {
      const [, pid, op] = m;
      const rec = recFor(pid);
      if (op === "map") return currentMap(pid);
      if (op === "reset") {
        started.set(pid, null);
        return { ok: true };
      }
      if (op === "resurrect") {
        started.set(pid, Date.now());
        return { id: rec.run_id, project: pid, status: "running", phase: "diagnose", active_plan: [], active_step: null, certificate: null };
      }
      if (op === "what-if") return rec.get["what-if"];
      if (op === "ask") throw notHere("Asking Mori a free-form question");
      if (op === "reports") return phase(pid) === "after" ? rec.get[path] ?? [] : [];
      if (path in rec.get) return rec.get[path];
    }
    const r = path.match(/^\/api\/runs\/([^/?]+)(\/[a-z-]+)?/);
    if (r) {
      const pid = pidForRun(r[1]);
      if (!pid) throw new Error("Unknown run");
      const rec = recFor(pid);
      if (!r[2]) return { id: r[1], events_list: phase(pid) === "after" ? rec.events : seen(pid) };
      if (r[2] === "/pull-request") throw notHere("Opening a draft pull request");
      if (r[2] === "/approval") return { ok: true };
      if (path in rec.get && rec.get[path] != null) return rec.get[path];
      throw new Error("Not ready yet");
    }
    throw new Error(`Not available in the hosted demo: ${path}`);
  }

  class ReplayEventSource {
    static CLOSED = 2;
    readyState = 1;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    private timers: ReturnType<typeof setTimeout>[] = [];
    constructor(url: string) {
      const rid = url.match(/runs\/([^/]+)\/events/)?.[1] ?? "";
      const pid = pidForRun(rid);
      if (!pid) return;
      if (started.get(pid) == null) started.set(pid, Date.now());
      const t0 = started.get(pid)! + LEAD_MS;
      recFor(pid).events.forEach((ev) => {
        const wait = Math.max(0, t0 + ev.t * 1000 - Date.now());
        this.timers.push(
          setTimeout(() => {
            if (this.readyState === 2) return;
            this.onmessage?.({ data: JSON.stringify(ev) });
          }, wait),
        );
      });
    }
    close() {
      this.readyState = 2;
      this.timers.forEach(clearTimeout);
    }
  }

  const text = (path: string) => {
    const rid = path.match(/runs\/([^/?]+)|preview\/([^/]+)/);
    const pid = rid && pidForRun(rid[1] || rid[2]);
    const v = pid ? recFor(pid).get[path] : undefined;
    return typeof v === "string" ? v : JSON.stringify(v ?? "", null, 2);
  };

  const asset = (path: string) => {
    if (!blobs.has(path)) {
      const type = path.includes("format=html") || path.startsWith("/preview") ? "text/html" : path.includes("format=markdown") ? "text/markdown" : path.endsWith("/patch") ? "text/plain" : "application/json";
      blobs.set(path, URL.createObjectURL(new Blob([text(path)], { type })));
    }
    return blobs.get(path)!;
  };

  (window as unknown as { __RESPAWN_REPLAY__: unknown }).__RESPAWN_REPLAY__ = {
    fetch: fetchRoute,
    EventSource: ReplayEventSource,
    asset,
    text,
  };
}
