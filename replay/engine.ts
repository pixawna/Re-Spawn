/* Replay engine for the hosted demo.
 *
 * Serves recordings of real Re:Spawn runs (captured from the live backend with
 * scripts/record-runs.py) through the same API surface the UI uses. Each graph
 * rule combination maps to the recording of a real run made with that rule set.
 */
type Json = Record<string, unknown>;
type Rec = {
  rules: Json;
  projects_before: Json[];
  projects_mid?: Json[];
  projects_after: Json[];
  map_before: Json;
  maps: { seq: number; map: Json }[];
  events: (Json & { seq: number; t: number; type: string })[];
  patch: string;
  preview_html: string;
  run_id: string;
};
export type Recordings = { health: Json; recordings: Record<"default" | "teach" | "workaround", Rec> };

export function installReplay(data: Recordings) {
  const state = {
    teach: false,
    learned: false,
    allow: false,
    phase: "before" as "before" | "running" | "after",
    key: "default" as keyof Recordings["recordings"],
    seq: -1,
  };
  const blobs = new Map<string, string>();
  const rec = () => data.recordings[state.key];

  const pickKey = (): keyof Recordings["recordings"] =>
    state.allow ? "workaround" : state.teach || state.learned ? "teach" : "default";

  const rules = () => ({
    teach_conflict: state.teach || state.learned,
    conflict_learned: state.learned && !state.teach,
    allow_workarounds: state.allow,
    conflict: (data.recordings.default.rules as Json).conflict,
  });

  const currentMap = () => {
    if (state.phase === "before") return data.recordings[pickKey()].map_before;
    const maps = rec().maps.filter((m) => m.seq <= state.seq);
    return maps.length ? maps[maps.length - 1].map : rec().map_before;
  };

  const projects = () => {
    if (state.phase === "before") return data.recordings.default.projects_before;
    if (state.phase === "running") {
      const sawDiagnosis = rec().events.some((e) => e.type === "diagnosis" && e.seq <= state.seq);
      return (sawDiagnosis && rec().projects_mid) || rec().projects_before;
    }
    return rec().projects_after;
  };

  async function fetchRoute(path: string, init?: RequestInit): Promise<unknown> {
    const method = (init?.method || "GET").toUpperCase();
    await new Promise((r) => setTimeout(r, 60));
    if (path === "/api/health") return { ...data.health, graph: { mode: "replay", detail: "recorded runs" } };
    if (path === "/api/projects" && method === "GET") return projects();
    if (path === "/api/projects" && method === "POST")
      throw new Error("This hosted demo replays recorded runs, so it can't clone new repositories. Run Re:Spawn locally to dig up your own.");
    if (path === "/api/rules" && method === "GET") return rules();
    if (path === "/api/rules" && method === "POST") {
      const body = JSON.parse(String(init?.body || "{}"));
      if (typeof body.teach_conflict === "boolean") {
        state.teach = body.teach_conflict;
        if (!body.teach_conflict) state.learned = false;
      }
      if (typeof body.allow_workarounds === "boolean") state.allow = body.allow_workarounds;
      return rules();
    }
    const m = path.match(/^\/api\/projects\/([^/]+)\/(map|resurrect|reset)$/);
    if (m) {
      if (m[2] === "map") return currentMap();
      if (m[2] === "reset") {
        state.phase = "before";
        state.learned = false;
        state.seq = -1;
        return { ok: true };
      }
      state.key = pickKey();
      state.phase = "running";
      state.seq = -1;
      return { id: rec().run_id, project: m[1], status: "running", phase: "diagnose", active_plan: [], active_step: null, certificate: null };
    }
    const r = path.match(/^\/api\/runs\/([^/]+)$/);
    if (r) return { id: r[1], events_list: rec().events.filter((e) => state.phase === "after" || e.seq <= state.seq) };
    throw new Error(`Not available in the hosted demo: ${path}`);
  }

  class ReplayEventSource {
    static CLOSED = 2;
    readyState = 1;
    onmessage: ((e: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    private timers: ReturnType<typeof setTimeout>[] = [];
    constructor() {
      const events = rec().events;
      events.forEach((ev) => {
        this.timers.push(
          setTimeout(() => {
            if (this.readyState === 2) return;
            state.seq = ev.seq;
            if (ev.type === "done") {
              state.phase = "after";
              if (state.key === "default") state.learned = true;
            }
            this.onmessage?.({ data: JSON.stringify(ev) });
          }, 400 + ev.t * 1000),
        );
      });
    }
    close() {
      this.readyState = 2;
      this.timers.forEach(clearTimeout);
    }
  }

  const asset = (path: string) => {
    const key = `${state.key}:${path}`;
    if (!blobs.has(key)) {
      const isPatch = path.endsWith("/patch");
      const blob = new Blob([isPatch ? rec().patch : rec().preview_html], { type: isPatch ? "text/plain" : "text/html" });
      blobs.set(key, URL.createObjectURL(blob));
    }
    return blobs.get(key)!;
  };

  const text = (path: string) => (path.endsWith("/patch") ? rec().patch : rec().preview_html);

  (window as unknown as { __RESPAWN_REPLAY__: unknown }).__RESPAWN_REPLAY__ = {
    fetch: fetchRoute,
    EventSource: ReplayEventSource,
    asset,
    text,
  };
}
