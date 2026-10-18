"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import ReportArchive from "./ReportArchive";
import RunReport from "./RunReport";
import LearnGame from "./LearnGame";
import GraveyardScene from "./GraveyardScene";
import ResurrectionMap from "./ResurrectionMap";
import Journal from "./Journal";
import Investigation, { type WhyChain } from "./Investigation";
import Heartbeat, { type Pulse } from "./Heartbeat";
import Resurrection from "./Resurrection";
import Pixel from "./Pixel";
import Link from "next/link";
import Stepper from "./Stepper";
import { reaper, shovel, type Mood } from "@/lib/sprites";
import {
  api,
  API,
  replay,
  type Certificate,
  type GraphMap,
  type MapNode,
  type Project,
  type Rules,
  type RunEvent,
} from "@/lib/api";

type Health = {
  agent?: { claude_available: boolean; model: string };
  graph: { mode: string; detail: string };
  stats: Record<string, number>;
};

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
      return op.environment
        ? `Run in ${op.environment}`
        : `Run on Node.js ${op.node}`;
    case "source_replace":
      return `Replace ${op.old} with ${op.new}`;
  }
  return JSON.stringify(op);
}

// What the user should understand right now, in plain words.
function guideFor(opts: {
  running: boolean;
  phase: string | null;
  status: string;
  done: boolean;
  lastSay: string | null;
  awaiting: boolean;
}) {
  const { running, phase, status, done, lastSay, awaiting } = opts;
  if (awaiting) return { title: "Your approval is needed", text: "The cheapest route is risky. Review it in the panel on the right and approve or reject it." };
  if (running) {
    const titles: Record<string, string> = {
      diagnose: "Step 1 of 4 · Reproducing the failure",
      discover: "Step 2 of 4 · Asking the graph for a route",
      repair: "Step 3 of 4 · Trying the repair in a sandbox",
      verify: "Step 4 of 4 · Proving it works",
    };
    return { title: titles[phase ?? "diagnose"] ?? "Working…", text: lastSay ?? "Mori is getting started." };
  }
  if (done && (status === "alive" || status === "build-passing"))
    return { title: "It's alive", text: "The app builds, its tests pass and it serves again. Read the report to see every decision and the graph facts behind it." };
  if (done && status === "dead")
    return { title: "This one stays buried for now", text: lastSay ?? "Every route the graph knows was tried. The report explains what failed and why." };
  if (status === "alive")
    return { title: "Already resurrected", text: "Press Resurrect again to replay it. The agent reuses what the graph learned last time." };
  return { title: "Ready when you are", text: "Press Resurrect. Mori will first run the original build to capture the real error, then ask the graph for the safest fix." };
}

export default function ReSpawn({ initialProject }: { initialProject?: string } = {}) {
  const [reportRunId, setReportRunId] = useState<string | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [learnProject, setLearnProject] = useState<Project | null>(null);
  const [agentMode, setAgentMode] = useState("auto");
  const [chain, setChain] = useState<WhyChain | null>(null);
  const [highlightIds, setHighlightIds] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [rules, setRules] = useState<Rules | null>(null);
  const [view, setView] = useState<"graveyard" | "map">(initialProject ? "map" : "graveyard");
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
  const openRef = useRef<((pid: string, list?: Project[]) => void) | null>(null);
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
      .then((list) => {
        setProjects(list);
        if (initialProject && list.some((p) => p.id === initialProject)) openRef.current?.(initialProject, list);
      })
      .catch(() => setOffline(true));
    api<Health>("/api/health")
      .then(setHealth)
      .catch(() => setOffline(true));
    api<Rules>("/api/rules")
      .then(setRules)
      .catch(() => {});
  }, [initialProject]);

  const subscribe = useCallback(
    (rid: string, pid: string) => {
      esRef.current?.close();
      setEvents([]);
      setDone(false);
      setRunId(rid);
      setRunningProject(pid);
      const ES = replay()?.EventSource ?? EventSource;
      const es = new ES(`${API}/api/runs/${rid}/events`);
      esRef.current = es;
      es.onmessage = (msg) => {
        const ev = JSON.parse(msg.data) as RunEvent;
        setEvents((prev) =>
          prev.length && prev[prev.length - 1].seq >= ev.seq
            ? prev
            : [...prev, ev],
        );
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
          api<Rules>("/api/rules")
            .then(setRules)
            .catch(() => {});
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
    (pid: string, list?: Project[]) => {
      setSelected(pid);
      setChain(null);
      setHighlightIds([]);
      setNode(null);
      setView("map");
      setMap(null);
      selectedRef.current = pid;
      loadMap(pid, true);
      const p = (list ?? projects).find((x) => x.id === pid);
      if (p?.run && pid !== runningProject) {
        if (["running", "awaiting_approval"].includes(p.run.status))
          subscribe(p.run.id, pid);
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

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const resurrect = async () => {
    if (!selected) return;
    setNotice("");
    setShowCert(false);
    setCert(null);
    setPhase("diagnose");
    setMood("thinking");
    try {
      const run = await api<{ id: string }>(
        `/api/projects/${selected}/resurrect`,
        { method: "POST", body: JSON.stringify({ mode: agentMode }) },
      );
      subscribe(run.id, selected);
      loadProjects();
    } catch (e) {
      setNotice(`Could not start: ${(e as Error).message}`);
    }
  };

  const updateRules = async (patch: Partial<Rules>) => {
    try {
      setRules(
        await api<Rules>("/api/rules", {
          method: "POST",
          body: JSON.stringify(patch),
        }),
      );
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
    setNotice(
      "Attempts and learned facts cleared. The project is buried again.",
    );
  };

  const dig = async (e: FormEvent) => {
    e.preventDefault();
    setDigError("");
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(url.trim())) {
      setDigError(
        "Paste a GitHub repository URL, like https://github.com/owner/repo",
      );
      return;
    }
    setDigging(true);
    try {
      const r = await api<{ id: string }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
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
  const lastSay = [...events].reverse().find((e) => e.type === "say" || e.type === "decision");
  const awaiting =
    events.some((e) => e.type === "approval_required") &&
    !events.some((e) => e.type === "approval_resolved" && e.approval_id === [...events].reverse().find((x) => x.type === "approval_required")?.id);
  const running = !!runningProject && runningProject === selected;
  const status = project?.status || "unverified";
  const pulse: Pulse =
    status === "alive"
      ? "alive"
      : running && (phase === "repair" || phase === "verify")
        ? "weak"
        : "flat";

  const moriAt = useMemo(() => {
    if (!map || !selected) return null;
    if (running && map.run?.active_step) return map.run.active_step;
    if (running && phase === "repair" && map.run?.active_plan?.length)
      return map.run.active_plan[map.run.active_plan.length - 1];
    if (running && phase === "discover")
      return map.nodes.find((n) => n.blocked && !n.retired)?.id || selected;
    if (
      (phase === "verify" || status === "alive") &&
      map.nodes.some((n) => n.kind === "verification")
    )
      return "verification";
    return selected;
  }, [map, selected, running, phase, status]);

  const displayMap = useMemo(() => {
    if (!map || !chain) return map;
    return {
      ...map,
      layout: "chain" as const,
      nodes: chain.ids.map(
        (id, i) =>
          ({
            id,
            kind:
              i === 0
                ? "project"
                : i === chain.ids.length - 1
                  ? "runtime"
                  : "package",
            label: chain.labels[i],
            status:
              i === 0
                ? map.nodes.find((n) => n.kind === "project")?.status
                : undefined,
            sub:
              i === 0
                ? "Resolved dependency chain"
                : chain.relationships[i - 1],
            blocked: i === chain.ids.length - 1,
          }) as MapNode,
      ),
      edges: chain.ids.slice(1).map((id, i) => ({
        id: `why-${i}`,
        source: chain.ids[i],
        target: id,
        kind: chain.relationships[i],
        state: "active",
      })),
    };
  }, [map, chain]);

  const facts = useMemo(() => {
    if (!node || !displayMap) return [];
    const label = (id: string) => id;
    return displayMap.edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .filter((e) => !["USES"].includes(e.kind) || node.kind !== "project")
      .slice(0, 8)
      .map((e) => `(${label(e.source)})-[:${e.kind}]->(${label(e.target)})`);
  }, [node, displayMap]);

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
              re
              <span className="colon" aria-hidden>
                <i />
                <i />
              </span>
              spawn
            </h1>
            <p className="tagline">Every dead project deserves another life.</p>
          </header>
          <div className="graph-chip" title={health?.graph.detail}>
            <span className={`dot ${offline ? "off" : "on"}`} />
            {offline
              ? "Backend offline. Start it on :8000"
              : health?.graph.mode === "replay"
                ? "Replaying real recorded runs"
                : health
                  ? `FalkorDB ${health.graph.mode} · ${Object.values(health.stats).reduce((a, b) => a + b, 0)} nodes`
                  : "Connecting to FalkorDB"}
          </div>
          {view === "graveyard" && projects.length > 0 && (
            <button
              className="learn-entry btn-ghost"
              onClick={() =>
                setLearnProject(
                  projects.find((p) => p.id === selected) ?? projects[0],
                )
              }
            >
              ◇ Learn mode · play as Mori
            </button>
          )}
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
                  npm and Python 3.12 projects. Click a grave to open its
                  resurrection map.
                </p>
              )}
            </form>
          )}
        </section>

        <section
          className="layer-soil"
          aria-label="Resurrection map"
          aria-hidden={view !== "map"}
        >
          {project && (
            <>
              <div className="soil-bar">
                {initialProject ? (
                  <Link className="climb" href="/projects" aria-label="Back to all projects">
                    ← All projects
                  </Link>
                ) : (
                  <button
                    className="climb"
                    onClick={() => setView("graveyard")}
                    aria-label="Back to the graveyard"
                  >
                    ↑ Graveyard
                  </button>
                )}
                <div className="soil-title">
                  <h2>
                    {project.name}{" "}
                    <span className="ecosystem-badge">
                      {project.ecosystem === "pypi" ? "Python" : "npm"}
                    </span>
                  </h2>
                  <p className={`st st-${running ? "running" : status}`}>
                    {running ? "Being revived" : STATUS_TEXT[status] || status}
                  </p>
                </div>
                <Heartbeat pulse={pulse} />
                <div className="soil-actions">
                  <details className="more-menu">
                    <summary>More</summary>
                    <div className="more-pop">
                      {!replay() && (
                        <label className="agent-select">
                          Who drives the agent
                          <select
                            aria-label="Agent controller"
                            value={agentMode}
                            onChange={(e) => setAgentMode(e.target.value)}
                            disabled={running}
                          >
                            <option value="auto">
                              Auto ·{" "}
                              {health?.agent?.claude_available ? "Claude + MCP" : "graph fallback"}
                            </option>
                            <option value="claude">Claude + MCP</option>
                            <option value="deterministic">Deterministic graph</option>
                          </select>
                        </label>
                      )}
                      <button className="btn-ghost" onClick={() => setLearnProject(project)}>
                        Learn mode (mini-game)
                      </button>
                      {!replay() && (
                        <button className="btn-ghost" onClick={() => setShowArchive(true)}>
                          Past reports
                        </button>
                      )}
                      {cert && !running && (
                        <button className="btn-ghost" onClick={() => setShowCert(true)}>
                          Certificate
                        </button>
                      )}
                    </div>
                  </details>
                  {runId && done && !replay() ? (
                    <Link className="btn-ghost" href={`/report?run=${encodeURIComponent(runId)}&p=${encodeURIComponent(project.id)}`}>
                      Read the report
                    </Link>
                  ) : null}
                  <button
                    className="btn-life"
                    onClick={resurrect}
                    disabled={running || offline}
                  >
                    {running
                      ? "Resurrecting…"
                      : status === "alive"
                        ? "Resurrect again"
                        : "Resurrect"}
                  </button>
                </div>
              </div>
              {(() => {
                const g = guideFor({ running, phase, status, done, lastSay: lastSay ? String(lastSay.text) : null, awaiting });
                return (
                  <div className={`guide ${running ? "is-live" : done && status === "alive" ? "is-good" : ""}`} role="status" aria-live="polite">
                    <Pixel sprite={reaper(running ? mood : status === "alive" ? "happy" : "neutral")} scale={2} />
                    <div className="guide-text">
                      <strong>{g.title}</strong>
                      <span>{g.text}</span>
                    </div>
                    {initialProject && <Stepper current={done && runId ? 3 : 2} />}
                  </div>
                );
              })()}
              <div className="soil-grid">
                <div className="map-wrap">
                  {displayMap ? (
                    <ResurrectionMap
                      map={displayMap}
                      traceIds={chain?.ids}
                      highlightIds={highlightIds}
                      moriAt={moriAt}
                      mood={mood}
                      selectedId={node?.id || null}
                      onSelect={setNode}
                    />
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
                            onChange={(e) =>
                              updateRules({ teach_conflict: e.target.checked })
                            }
                            disabled={running}
                          />
                          <span>
                            FalkorDB knows <code>{rules.conflict.a}</code>{" "}
                            conflicts with <code>{rules.conflict.b}</code>
                            {rules.conflict_learned && (
                              <em> (learned from a failure)</em>
                            )}
                          </span>
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={rules.allow_workarounds}
                            onChange={(e) =>
                              updateRules({
                                allow_workarounds: e.target.checked,
                              })
                            }
                            disabled={running}
                          />
                          <span>Allow risky workarounds</span>
                        </label>
                        <button
                          className="j-link"
                          onClick={forget}
                          disabled={running}
                        >
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
                      <button
                        className="inspect-x"
                        onClick={() => setNode(null)}
                        aria-label="Close details"
                      >
                        ×
                      </button>
                      <h3>{node.label}</h3>
                      {node.sub && <p className="inspect-sub">{node.sub}</p>}
                      {node.reason && (
                        <p className="inspect-bad">{node.reason}</p>
                      )}
                      {node.why && <p>{node.why}</p>}
                      {node.source && (
                        <a href={node.source} target="_blank" rel="noreferrer">
                          Compatibility source ↗
                        </a>
                      )}
                      {node.kind === "migration" && (
                        <>
                          <p className="inspect-meta">
                            Cost {node.cost}, {node.risk} risk.{" "}
                            {node.state === "pruned"
                              ? "Ruled out: " + node.reasons?.join("; ")
                              : `State: ${node.state}.`}
                          </p>
                          <ul className="inspect-recipe">
                            {node.recipe?.map((op, i) => (
                              <li key={i}>{recipeText(op)}</li>
                            ))}
                          </ul>
                        </>
                      )}
                      {facts.length > 0 && (
                        <>
                          <p className="inspect-label">
                            Relationships in FalkorDB
                          </p>
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
                <div className="journal-stack">
                  <Journal events={events} phase={phase} done={done} />
                  <Investigation
                    key={`${project.id}:${runId ?? "idle"}`}
                    projectId={project.id}
                    runId={runId}
                    events={events}
                    onChain={setChain}
                    onHighlight={setHighlightIds}
                  />
                </div>
              </div>
              {notice && (
                <p
                  className="notice"
                  role="status"
                  onAnimationEnd={() => setNotice("")}
                >
                  {notice}
                </p>
              )}
            </>
          )}
        </section>
      </div>
      {showReport && reportRunId && (
        <RunReport
          key={reportRunId}
          runId={reportRunId}
          onClose={() => setShowReport(false)}
        />
      )}
      {showArchive && project && (
        <ReportArchive
          key={project.id}
          projectId={project.id}
          onClose={() => setShowArchive(false)}
          onSelect={(id) => {
            setReportRunId(id);
            setShowArchive(false);
            setShowReport(true);
          }}
        />
      )}
      {learnProject && (
        <LearnGame
          key={learnProject.id}
          project={learnProject}
          onClose={() => setLearnProject(null)}
          onExplore={() => {
            open(learnProject.id);
            setLearnProject(null);
          }}
        />
      )}
      {showCert && cert && (
        <Resurrection
          cert={cert}
          onClose={() => setShowCert(false)}
          onReport={() => {
            setShowCert(false);
            setReportRunId(runId);
            setShowReport(true);
          }}
        />
      )}
      {runId && (
        <span className="sr-only" aria-live="polite">
          {phase ? `Phase: ${phase}` : ""}
        </span>
      )}
    </div>
  );
}
