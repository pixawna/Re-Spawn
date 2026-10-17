"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import GraveyardScene from "./GraveyardScene";
import ResurrectionMap from "./ResurrectionMap";
import Journal from "./Journal";
import Heartbeat, { type Pulse } from "./Heartbeat";
import Resurrection from "./Resurrection";
import Pixel from "./Pixel";
import { reaper, shovel, type Mood } from "@/lib/sprites";
import { api, API, type Certificate, type GraphMap, type MapNode, type Project, type Rules, type RunEvent } from "@/lib/api";

type Health = { graph: { mode: string; detail: string }; stats: Record<string, number> };

const STATUS_TEXT: Record<string, string> = {
  unverified: "Not checked yet",
  diagnosing: "Being examined",
  dead: "Build fails",
  alive: "Alive and verified",
  "build-passing": "Builds, not fully verified",
};

function recipeText(op: Record<string, string>) {
  switch (op.op) {
    case "set":
      return `Set ${op.pkg} to ${op.range}`;
    case "replace":
      return `Replace ${op.pkg} with ${op.with} ${op.range}`;
    case "engines":
      return `Set engines.node to ${op.node}`;
    case "npmrc":
      return `Write ${op.key}=${op.value} to .npmrc`;
    case "runtime":
      return `Run on Node.js ${op.node}`;
  }
  return JSON.stringify(op);
}

export default function ReSpawn() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [rules, setRules] = useState<Rules | null>(null);
  const [view, setView] = useState<"graveyard" | "map">("graveyard");
  const [selected, setSelected] = useState<string | null>(null);
  const [map, setMap] = useState<GraphMap | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [runningProject, setRunningProject] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [mood, setMood] = useState<Mood>("neutral");
  const [done, setDone] = useState(false);
  const [cert, setCert] = useState<Certificate | null>(null);
  const [showCert, setShowCert] = useState(false);
  const [node, setNode] = useState<MapNode | null>(null);
  const [url, setUrl] = useState("");
  const [digError, setDigError] = useState("");
  const [digging, setDigging] = useState(false);
  const [notice, setNotice] = useState("");
  const esRef = useRef<EventSource | null>(null);
  const mapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  const loadProjects = useCallback(async () => {
    try {
      const list = await api<Project[]>("/api/projects");
      setProjects(list);
      setOffline(false);
      return list;
    } catch {
      setOffline(true);
      return [];
    }
  }, []);

  const loadMap = useCallback((pid: string, now = false) => {
    if (mapTimer.current) clearTimeout(mapTimer.current);
    const go = async () => {
      try {
        const m = await api<GraphMap>(`/api/projects/${pid}/map`);
        if (selectedRef.current === pid) setMap(m);
      } catch {}
    };
    if (now) go();
    else mapTimer.current = setTimeout(go, 140);
  }, []);

  useEffect(() => {
    api<Project[]>("/api/projects")
      .then(setProjects)
      .catch(() => setOffline(true));
    api<Health>("/api/health").then(setHealth).catch(() => setOffline(true));
    api<Rules>("/api/rules").then(setRules).catch(() => {});
  }, []);

  const subscribe = useCallback(
    (rid: string, pid: string) => {
      esRef.current?.close();
      setEvents([]);
      setDone(false);
      setRunId(rid);
      setRunningProject(pid);
      const es = new EventSource(`${API}/api/runs/${rid}/events`);
      esRef.current = es;
      es.onmessage = (msg) => {
        const ev = JSON.parse(msg.data) as RunEvent;
        setEvents((prev) => (prev.length && prev[prev.length - 1].seq >= ev.seq ? prev : [...prev, ev]));
        if (ev.type === "phase") setPhase(String(ev.phase));
        if (ev.type === "say") setMood((ev.mood as Mood) || "neutral");
        if (ev.type === "graph") loadMap(pid);
        if (ev.type === "diagnosis") loadProjects();
        if (ev.type === "done") {
          es.close();
          setDone(true);
          setRunningProject(null);
          loadMap(pid, true);
          loadProjects();
          if (ev.status === "alive" || ev.status === "build-passing") {
            setMood("happy");
            setCert(ev.certificate as Certificate);
            setTimeout(() => setShowCert(true), 1400);
          } else setMood("sad");
        }
      };
      es.onerror = () => {
        // The browser retries automatically; if the run is gone the server returns 404 and we stop.
        if (es.readyState === EventSource.CLOSED) setRunningProject(null);
      };
    },
    [loadMap, loadProjects],
  );

  useEffect(() => () => esRef.current?.close(), []);

  const open = useCallback(
    (pid: string) => {
      setSelected(pid);
      setNode(null);
      setView("map");
      setMap(null);
      selectedRef.current = pid;
      loadMap(pid, true);
      const p = projects.find((x) => x.id === pid);
      if (p?.run && pid !== runningProject) {
        if (p.run.status === "running") subscribe(p.run.id, pid);
        else {
          esRef.current?.close();
          setRunId(p.run.id);
          setCert(p.run.certificate);
          setPhase(p.run.phase);
          setDone(true);
          api<{ events_list: RunEvent[] }>(`/api/runs/${p.run.id}`)
            .then((r) => setEvents(r.events_list))
            .catch(() => setEvents([]));
        }
      } else if (pid !== runningProject) {
        esRef.current?.close();
        setEvents([]);
        setPhase(null);
        setDone(false);
        setCert(null);
        setRunId(null);
        setMood(p?.status === "alive" ? "happy" : "neutral");
      }
    },
    [loadMap, projects, runningProject, subscribe],
  );

  const resurrect = async () => {
    if (!selected) return;
    setNotice("");
    setShowCert(false);
    setCert(null);
    setPhase("diagnose");
    setMood("thinking");
    try {
      const run = await api<{ id: string }>(`/api/projects/${selected}/resurrect`, { method: "POST" });
      subscribe(run.id, selected);
      loadProjects();
    } catch (e) {
      setNotice(`Could not start: ${(e as Error).message}`);
    }
  };

  const updateRules = async (patch: Partial<Rules>) => {
    try {
      setRules(await api<Rules>("/api/rules", { method: "POST", body: JSON.stringify(patch) }));
      setNotice("Rule saved in FalkorDB. It applies to the next resurrection.");
    } catch (e) {
      setNotice((e as Error).message);
    }
  };

  const forget = async () => {
    if (!selected) return;
    await api(`/api/projects/${selected}/reset`, { method: "POST" });
    setEvents([]);
    setPhase(null);
    setDone(false);
    setCert(null);
    setRunId(null);
    setMood("neutral");
    await loadProjects();
    loadMap(selected, true);
    api<Rules>("/api/rules").then(setRules);
    setNotice("Attempts and learned facts cleared. The project is buried again.");
  };

  const dig = async (e: FormEvent) => {
    e.preventDefault();
    setDigError("");
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(url.trim())) {
      setDigError("Paste a GitHub repository URL, like https://github.com/owner/repo");
      return;
    }
    setDigging(true);
    try {
      const r = await api<{ id: string }>("/api/projects", { method: "POST", body: JSON.stringify({ url: url.trim() }) });
      setUrl("");
      const list = await loadProjects();
      if (list.some((p) => p.id === r.id)) setSelected(r.id);
    } catch (err) {
      setDigError((err as Error).message);
    } finally {
      setDigging(false);
    }
  };

  const project = projects.find((p) => p.id === selected) || null;
  const running = !!runningProject && runningProject === selected;
  const status = project?.status || "unverified";
  const pulse: Pulse = status === "alive" ? "alive" : running && (phase === "repair" || phase === "verify") ? "weak" : "flat";

  const moriAt = useMemo(() => {
    if (!map || !selected) return null;
    if (running && map.run?.active_step) return map.run.active_step;
    if (running && phase === "repair" && map.run?.active_plan?.length) return map.run.active_plan[map.run.active_plan.length - 1];
    if (running && phase === "discover") return map.nodes.find((n) => n.blocked && !n.retired)?.id || selected;
    if ((phase === "verify" || status === "alive") && map.nodes.some((n) => n.kind === "verification")) return "verification";
    return selected;
  }, [map, selected, running, phase, status]);

  const facts = useMemo(() => {
    if (!node || !map) return [];
    const label = (id: string) => id;
    return map.edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .filter((e) => !["USES"].includes(e.kind) || node.kind !== "project")
      .slice(0, 8)
      .map((e) => `(${label(e.source)})-[:${e.kind}]->(${label(e.target)})`);
  }, [node, map]);

  return (
    <div className={`world view-${view}`}>
      <div className="camera">
        <section className="layer-sky" aria-label="Graveyard">
          <GraveyardScene
            projects={projects}
            selected={selected}
            runningId={runningProject}
            mood={mood}
            onPick={open}
          />
          <header className="masthead">
            <h1 className="wordmark" aria-label="re:spawn">
              re<span className="colon" aria-hidden><i /><i /></span>spawn
            </h1>
            <p className="tagline">Every dead project deserves another life.</p>
          </header>
          <div className="graph-chip" title={health?.graph.detail}>
            <span className={`dot ${offline ? "off" : "on"}`} />
            {offline
              ? "Backend offline. Start it on :8000"
              : health
                ? `FalkorDB ${health.graph.mode} · ${Object.values(health.stats).reduce((a, b) => a + b, 0)} nodes`
                : "Connecting to FalkorDB"}
          </div>
          {view === "graveyard" && (
            <form className="dig" onSubmit={dig}>
              <Pixel sprite={shovel} scale={4} className="dig-shovel" />
              <label htmlFor="repo">Dig up a repository</label>
              <div className="dig-row">
                <input
                  id="repo"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setDigError("");
                  }}
                  placeholder="https://github.com/owner/old-project"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button type="submit" disabled={digging || offline}>
                  {digging ? "Digging…" : "Dig"}
                </button>
              </div>
              {digError ? (
                <p className="dig-error" role="alert">
                  {digError}
                </p>
              ) : (
                <p className="dig-hint">
                  npm projects only for now. Or click a grave to open its resurrection map.
                </p>
              )}
            </form>
          )}
        </section>

        <section className="layer-soil" aria-label="Resurrection map" aria-hidden={view !== "map"}>
          {project && (
            <>
              <div className="soil-bar">
                <button className="climb" onClick={() => setView("graveyard")} aria-label="Back to the graveyard">
                  ↑ Graveyard
                </button>
                <div className="soil-title">
                  <h2>{project.name}</h2>
                  <p className={`st st-${running ? "running" : status}`}>{running ? "Being revived" : STATUS_TEXT[status] || status}</p>
                </div>
                <Heartbeat pulse={pulse} />
                <div className="soil-actions">
                  {cert && !running && (
                    <button className="btn-ghost" onClick={() => setShowCert(true)}>
                      Certificate
                    </button>
                  )}
                  <button className="btn-life" onClick={resurrect} disabled={running || offline}>
                    {running ? "Resurrecting…" : status === "alive" ? "Resurrect again" : "Resurrect"}
                  </button>
                </div>
              </div>
              <div className="soil-grid">
                <div className="map-wrap">
                  {map ? (
                    <ResurrectionMap map={map} moriAt={moriAt} mood={mood} selectedId={node?.id || null} onSelect={setNode} />
                  ) : (
                    <div className="map-loading">
                      <Pixel sprite={reaper("thinking")} scale={4} />
                      <p>Reading the graph…</p>
                    </div>
                  )}
                  <details className="rules">
                    <summary>Graph rules</summary>
                    {rules && (
                      <>
                        <label>
                          <input
                            type="checkbox"
                            checked={rules.teach_conflict}
                            onChange={(e) => updateRules({ teach_conflict: e.target.checked })}
                            disabled={running}
                          />
                          <span>
                            FalkorDB knows <code>{rules.conflict.a}</code> conflicts with <code>{rules.conflict.b}</code>
                            {rules.conflict_learned && <em> (learned from a failure)</em>}
                          </span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={rules.allow_workarounds}
                            onChange={(e) => updateRules({ allow_workarounds: e.target.checked })}
                            disabled={running}
                          />
                          <span>Allow risky workarounds</span>
                        </label>
                        <button className="j-link" onClick={forget} disabled={running}>
                          Forget attempts and learned facts
                        </button>
                      </>
                    )}
                  </details>
                  <ul className="legend" aria-label="Legend">
                    <li className="lg-searching">Searching for life</li>
                    <li className="lg-valid">Valid route</li>
                    <li className="lg-failed">Failed route</li>
                    <li className="lg-pruned">Ruled out</li>
                    <li className="lg-unexplored">Unexplored</li>
                  </ul>
                  {node && (
                    <aside className="inspect" aria-live="polite">
                      <button className="inspect-x" onClick={() => setNode(null)} aria-label="Close details">
                        ×
                      </button>
                      <h3>{node.label}</h3>
                      {node.sub && <p className="inspect-sub">{node.sub}</p>}
                      {node.reason && <p className="inspect-bad">{node.reason}</p>}
                      {node.why && <p>{node.why}</p>}
                      {node.kind === "migration" && (
                        <>
                          <p className="inspect-meta">
                            Cost {node.cost}, {node.risk} risk. {node.state === "pruned" ? "Ruled out: " + node.reasons?.join("; ") : `State: ${node.state}.`}
                          </p>
                          <ul className="inspect-recipe">
                            {node.recipe?.map((op, i) => <li key={i}>{recipeText(op)}</li>)}
                          </ul>
                        </>
                      )}
                      {facts.length > 0 && (
                        <>
                          <p className="inspect-label">Relationships in FalkorDB</p>
                          <ul className="inspect-facts">
                            {facts.map((f) => (
                              <li key={f}>
                                <code>{f}</code>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </aside>
                  )}
                </div>
                <Journal events={events} phase={phase} done={done} />
              </div>
              {notice && (
                <p className="notice" role="status" onAnimationEnd={() => setNotice("")}>
                  {notice}
                </p>
              )}
            </>
          )}
        </section>
      </div>
      {showCert && cert && <Resurrection cert={cert} onClose={() => setShowCert(false)} />}
      {runId && <span className="sr-only" aria-live="polite">{phase ? `Phase: ${phase}` : ""}</span>}
    </div>
  );
}
