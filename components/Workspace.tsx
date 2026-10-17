"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Code2,
  Copy,
  FlaskConical,
  FolderGit2,
  GitBranch,
  FolderGit2 as Github,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Skull,
  Sparkles,
  Sprout,
  Terminal,
  X,
  Zap,
} from "lucide-react";
import Graveyard from "./Graveyard";
import GhostMascot from "./GhostMascot";
import RecoveryGraph from "./RecoveryGraph";
import { projects as seedProjects, demoLogs, type Project } from "@/lib/demo";
type Scene = "Graveyard" | "Resurrection lab" | "Recovery tree" | "Respawn";
const sceneIcons = [Skull, FlaskConical, GitBranch, Zap];
const scenes: Scene[] = [
  "Graveyard",
  "Resurrection lab",
  "Recovery tree",
  "Respawn",
];
export default function Workspace({
  initialProjectId,
}: {
  initialProjectId?: string;
}) {
  const [projects, setProjects] = useState(seedProjects);
  const [selected, setSelected] = useState<Project>(
    seedProjects.find((p) => p.id === initialProjectId) ?? seedProjects[0],
  );
  const [scene, setScene] = useState<Scene>(
    initialProjectId ? "Resurrection lab" : "Graveyard",
  );
  const [modal, setModal] = useState<"new" | "guide" | null>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All projects");
  const [search, setSearch] = useState("");
  const [step, setStep] = useState(0);
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");
  const [detail, setDetail] = useState<"logs" | "packages">("logs");
  const [todos, setTodos] = useState([
    { label: "Give an old project a second chance", done: true },
    { label: "Make something worth bringing back", done: false },
    { label: "Ship the demo", done: false },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement;
    const dialog = modalRef.current;
    const controls = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button, input, a[href], [tabindex="0"]',
        ) ?? [],
      );
    controls()[0]?.focus();
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setModal(null);
        return;
      }
      if (e.key !== "Tab") return;
      const items = controls();
      const first = items[0],
        last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previous?.focus();
    };
  }, [modal]);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(
      () => setStep((s) => Math.min(s + 1, demoLogs.length)),
      650,
    );
    return () => clearInterval(timer);
  }, [running]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(timer);
  }, [toast]);
  const finished = step === demoLogs.length;
  const visible = projects.filter(
    (p) =>
      (filter === "All projects" ||
        (filter === "Resurrected"
          ? p.status === "Verified working"
          : p.status !== "Verified working")) &&
      p.name.toLowerCase().includes(search.toLowerCase()),
  );
  function inspect(p: Project) {
    setSelected(p);
    setStep(0);
    setRunning(false);
    setScene("Resurrection lab");
  }
  function startDemo() {
    setStep(0);
    setRunning(true);
    setScene("Resurrection lab");
  }
  function addRepo(e: FormEvent) {
    e.preventDefault();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      setError(
        "Enter a GitHub repository URL, like https://github.com/you/project.",
      );
      return;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.hostname !== "github.com" || parts.length !== 2) {
      setError("Use a GitHub URL with an owner and repository name.");
      return;
    }
    const name = parts[1].replace(/\.git$/, "");
    const p: Project = {
      id: `${parts[0]}-${name}`,
      name,
      owner: parts[0],
      stack: "npm · Not inspected",
      status: "Unverified",
      age: "Just added",
      issue:
        "Repository added locally. Connect the backend to inspect this project.",
    };
    setProjects((prev) =>
      prev.some((item) => item.id === p.id) ? prev : [p, ...prev],
    );
    setModal(null);
    setUrl("");
    setError("");
    inspect(p);
    setToast("Repository added to this demo session.");
  }
  async function copyLogs() {
    try {
      await navigator.clipboard.writeText(
        demoLogs.slice(0, Math.max(step, 4)).join("\n"),
      );
      setToast("Demo logs copied.");
    } catch {
      setToast("Clipboard unavailable. You can select and copy the logs.");
    }
  }
  function certificate() {
    const content = `RE:SPAWN — DEMO RESURRECTION CERTIFICATE\nProject: ${selected.name}\nThis is simulated UI evidence, not a real repository repair.\nMigration: node-sass → sass; Node.js → 22\nDemo results: build passed; 8 tests passed; browser smoke check passed.\n`;
    const href = URL.createObjectURL(
      new Blob([content], { type: "text/plain" }),
    );
    const a = document.createElement("a");
    a.href = href;
    a.download = `${selected.name}-demo-certificate.txt`;
    a.click();
    URL.revokeObjectURL(href);
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/">
          <span className="brand-icon">
            <GhostMascot small />
          </span>
          <span>
            re<span className="brand-colon">:</span>spawn
            <span className="brand-period">.</span>
          </span>
        </Link>
        <div className="workspace-switch">
          <span className="workspace-avatar">W</span>
          <div>
            Weekend builders<small>Personal workspace</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-label">THE AFTERLIFE</span>
        <nav>
          {scenes.map((item, i) => {
            const Icon = sceneIcons[i];
            return (
              <button
                key={item}
                className={`nav-item ${scene === item ? "active" : ""}`}
                onClick={() => setScene(item)}
              >
                <Icon size={18} />
                {item}
                {item === "Graveyard" && (
                  <span className="nav-count">{projects.length}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-note">
          <span className="note-stars">✧</span>
          <p>
            Good ideas don’t expire.
            <br />
            Dependencies do.
          </p>
          <span>Let’s give yours another life.</span>
        </div>
        <div className="sidebar-bottom">
          <button onClick={() => setModal("guide")}>
            <BookOpen size={16} /> Field guide <ArrowUpRight size={14} />
          </button>
          <div className="profile">
            <span className="avatar">Y</span>
            <div>
              Your workspace<small>Hackathon edition</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <span>{scene}</span>
          </div>
          <div className="topbar-right">
            <span className="demo-pill">
              <span /> UI demo
            </span>
            <button
              className="icon-button"
              aria-label="Open field guide"
              onClick={() => setModal("guide")}
            >
              <CircleHelp size={18} />
            </button>
            <span className="avatar top-avatar">Y</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span className="tiny-star">✦</span> EVERY DEAD PROJECT DESERVES
                ANOTHER LIFE
              </div>
              <h1>
                {scene === "Graveyard"
                  ? "Welcome to the graveyard"
                  : scene === "Resurrection lab"
                    ? "A little life support."
                    : scene === "Recovery tree"
                      ? "There’s more than one way back."
                      : "Back among the living."}
              </h1>
              <p>
                {scene === "Graveyard"
                  ? "A resting place for unfinished ideas. And a starting point for their comeback."
                  : `${selected.name} · ${scene === "Resurrection lab" ? "Let’s find out what went wrong." : scene === "Recovery tree" ? "Follow the facts. Find a way forward." : "Every comeback deserves a little celebration."}`}
              </p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setModal("new");
                setTimeout(() => inputRef.current?.focus(), 0);
              }}
            >
              <Plus size={17} /> Add a repository
            </button>
          </div>
          {scene === "Graveyard" ? (
            <>
              <div className="hero-grid">
                <section className="graveyard-panel">
                  <div className="panel-top">
                    <div>
                      <span className="live-dot" /> Your little corner of the
                      afterlife
                    </div>
                    <span className="subtle">
                      {projects.length} projects resting here
                    </span>
                  </div>
                  <Graveyard projects={projects} onSelect={inspect} />
                  <div className="scene-footer">
                    <span>
                      <span className="keycap">↵</span> Click a project to
                      uncover its story
                    </span>
                    <span className="weather">
                      ☾ &nbsp; A good night for a comeback
                    </span>
                  </div>
                </section>
                <aside className="boo-card">
                  <div className="helper-label">
                    <span className="live-dot" /> YOUR RESURRECTION ASSISTANT
                  </div>
                  <GhostMascot />
                  <h2>Hey, I’m Boo.</h2>
                  <p>
                    I find what broke, explore the possibilities, and help your
                    old code find its pulse again.
                  </p>
                  <div className="boo-quote">
                    “That side project from 2022?
                    <br />I still believe in it.” <span>✧</span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(seedProjects[0]);
                      startDemo();
                    }}
                  >
                    Try a demo resurrection <ArrowRight size={16} />
                  </button>
                </aside>
              </div>
              <div className="stats-grid">
                {[
                  {
                    label: "Projects in the graveyard",
                    value: projects.length,
                    desc: "Good ideas, on pause",
                    icon: Skull,
                    tone: "purple",
                  },
                  {
                    label: "Waiting for a comeback",
                    value: projects.filter(
                      (p) => p.status !== "Verified working",
                    ).length,
                    desc: "A second chance starts here",
                    icon: Activity,
                    tone: "amber",
                  },
                  {
                    label: "Back among the living",
                    value: projects.filter(
                      (p) => p.status === "Verified working",
                    ).length,
                    desc: "One less ghost in the machine",
                    icon: Sprout,
                    tone: "green",
                  },
                ].map((s) => (
                  <div className="stat-card" key={s.label}>
                    <div>
                      <span>{s.label}</span>
                      <strong>{s.value.toString().padStart(2, "0")}</strong>
                      <small>{s.desc}</small>
                    </div>
                    <span className={`stat-icon ${s.tone}`}>
                      <s.icon size={23} />
                    </span>
                  </div>
                ))}
              </div>
              <section className="projects-section">
                <div className="section-heading">
                  <h2>
                    Your projects <span>{projects.length}</span>
                  </h2>
                  <div className="table-tools">
                    <label className="search-field">
                      <Search size={14} />
                      <input
                        aria-label="Search projects"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Find a lost soul…"
                      />
                    </label>
                    <button
                      className="icon-button"
                      aria-label="Add repository"
                      onClick={() => setModal("new")}
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </div>
                <div className="filter-tabs">
                  {["All projects", "Awaiting resurrection", "Resurrected"].map(
                    (tab) => (
                      <button
                        className={filter === tab ? "selected" : ""}
                        key={tab}
                        onClick={() => setFilter(tab)}
                      >
                        {tab}
                      </button>
                    ),
                  )}
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>PROJECT</th>
                        <th>STATUS</th>
                        <th>LAST ACTIVITY</th>
                        <th aria-label="Actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <button
                              className="project-link"
                              onClick={() => inspect(p)}
                            >
                              <span
                                className={`project-icon ${p.status === "Verified working" ? "green" : ""}`}
                              >
                                <FolderGit2 size={19} />
                              </span>
                              <span>
                                <strong>{p.name}</strong>
                                <small>
                                  {p.owner} <span> / </span> {p.stack}
                                </small>
                              </span>
                            </button>
                          </td>
                          <td>
                            <Status status={p.status} />
                          </td>
                          <td className="activity-cell">{p.age}</td>
                          <td>
                            <button
                              className="row-action"
                              onClick={() => inspect(p)}
                              aria-label={`Open ${p.name}`}
                            >
                              <ArrowUpRight size={17} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {visible.length === 0 && (
                    <div className="empty-state">
                      No lost souls found. Try another search.
                    </div>
                  )}
                </div>
              </section>
            </>
          ) : (
            <>
              <div className="project-toolbar">
                <span>
                  <Github size={17} />
                  {selected.owner} / <strong>{selected.name}</strong>
                </span>
                <Status
                  status={finished ? "Verified working" : selected.status}
                />
                <span className="mock-label">
                  Simulated data · no repository execution
                </span>
              </div>
              <div className="scene-tabs">
                {scenes.slice(1).map((s, i) => (
                  <button
                    className={scene === s ? "selected" : ""}
                    key={s}
                    onClick={() => setScene(s)}
                  >
                    <span>0{i + 1}</span>
                    {s}
                  </button>
                ))}
              </div>
              {scene === "Resurrection lab" ? (
                <div className="lab-grid">
                  <section className="panel lab-main">
                    <div className="panel-title">
                      <FlaskConical size={18} />
                      <h2>Resurrection lab</h2>
                      <span className="demo-pill">DEMO</span>
                    </div>
                    <div className="lab-mascot">
                      <GhostMascot />
                      <div>
                        <span className="eyebrow">
                          {finished
                            ? "A NEW LEASE ON LIFE"
                            : running
                              ? "BOO IS ON THE CASE"
                              : "YOUR NEXT GREAT COMEBACK"}
                        </span>
                        <h2>
                          {finished
                            ? "We found a pulse."
                            : running
                              ? "Following the recovery path…"
                              : "Let’s wake this project up."}
                        </h2>
                        <p>
                          {finished
                            ? "The demo checks have passed. Explore the preview and evidence."
                            : selected.issue}
                        </p>
                      </div>
                    </div>
                    <div className="checkpoints">
                      {["Diagnose", "Discover", "Repair", "Verify"].map(
                        (s, i) => (
                          <div
                            key={s}
                            className={step > i * 3 ? "complete" : ""}
                          >
                            <span>
                              {step > (i + 1) * 3 - 1 ? (
                                <Check size={14} />
                              ) : (
                                i + 1
                              )}
                            </span>
                            {s}
                          </div>
                        ),
                      )}
                    </div>
                    <div className="lab-actions">
                      <button
                        className="primary-button"
                        disabled={running && !finished}
                        onClick={startDemo}
                      >
                        {running && !finished ? (
                          <LoaderCircle className="spin" size={16} />
                        ) : (
                          <Sparkles size={16} />
                        )}{" "}
                        {finished ? "Replay demo" : "Run demo resurrection"}
                      </button>
                      <button
                        className="secondary-button"
                        onClick={() =>
                          setScene(finished ? "Respawn" : "Recovery tree")
                        }
                      >
                        {finished
                          ? "See the comeback"
                          : "Explore recovery tree"}
                        <ArrowRight size={15} />
                      </button>
                    </div>
                    <div className="terminal">
                      <div className="terminal-top">
                        <div>
                          <button
                            className={detail === "logs" ? "selected" : ""}
                            onClick={() => setDetail("logs")}
                          >
                            <Terminal size={13} /> Build logs
                          </button>
                          <button
                            className={detail === "packages" ? "selected" : ""}
                            onClick={() => setDetail("packages")}
                          >
                            <Code2 size={13} /> Packages
                          </button>
                        </div>
                        <button
                          className="icon-button"
                          aria-label="Copy demo logs"
                          onClick={copyLogs}
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                      <div className="terminal-content" aria-live="polite">
                        {detail === "packages" ? (
                          <pre>
                            {
                              "DEMO DEPENDENCY SNAPSHOT\n\nreact          16.14.0 → 18.3.1\nnode-sass       4.14.1 → removed\nsass                  → 1.77.0\nNode.js            14 → 22\n\nSource: local mock fixture"
                            }
                          </pre>
                        ) : (
                          <>
                            {demoLogs
                              .slice(0, running ? step : 4)
                              .map((line, i) => (
                                <div
                                  className={
                                    line.includes("✓")
                                      ? "log-success"
                                      : line.includes("ERR") ||
                                          line.includes("rejected")
                                        ? "log-error"
                                        : ""
                                  }
                                  key={i}
                                >
                                  <span>{String(i + 1).padStart(2, "0")}</span>
                                  {line}
                                </div>
                              ))}
                            {running && !finished && (
                              <div className="cursor-line">▌</div>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </section>
                  <aside className="panel evidence-panel">
                    <span className="eyebrow">THE DIAGNOSIS</span>
                    <h3>A runtime out of time.</h3>
                    <p>
                      The example project relies on a native Sass binding that
                      doesn’t speak modern Node.js.
                    </p>
                    <div className="issue-card">
                      <span className="error-dot" /> Runtime incompatibility
                      <code>node-sass@4 ↔ Node.js 22</code>
                    </div>
                    <span className="eyebrow">RECOVERY STRATEGY</span>
                    <ol>
                      <li>Replace the native Sass binding</li>
                      <li>Move to a supported runtime</li>
                      <li>Build, test, and open the app</li>
                    </ol>
                    <div className="evidence-note">
                      <ShieldCheck size={20} />
                      <p>
                        A passing build is only a milestone. Browser and test
                        evidence complete the story.
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setScene("Recovery tree")}
                    >
                      Inspect the graph facts <ArrowRight size={15} />
                    </button>
                  </aside>
                </div>
              ) : scene === "Recovery tree" ? (
                <section className="panel">
                  <div className="panel-title">
                    <GitBranch size={18} />
                    <h2>The recovery map</h2>
                    <span className="mock-label">
                      Drag to pan · scroll to zoom · click a node
                    </span>
                  </div>
                  <RecoveryGraph />
                  <div className="graph-legend">
                    <span>
                      <i className="green-dot" /> Feasible route
                    </span>
                    <span>
                      <i className="error-dot" /> Rejected route
                    </span>
                    <span>
                      Local demonstration of the planned FalkorDB model
                    </span>
                  </div>
                </section>
              ) : (
                <section className="panel respawn-panel">
                  {finished || selected.status === "Verified working" ? (
                    <>
                      <div className="celebration">
                        <span className="eyebrow">
                          ✦ DEMO RESURRECTION COMPLETE ✦
                        </span>
                        <h2>Some ideas deserve a sequel.</h2>
                        <p>
                          {selected.name} has a heartbeat again. Here’s the
                          simulated result.
                        </p>
                      </div>
                      <div className="preview-grid">
                        <div className="browser-preview">
                          <div className="browser-bar">
                            <span>● ● ●</span>
                            <code>localhost / {selected.name}</code>
                            <ShieldCheck size={14} />
                          </div>
                          <div className="todo-app">
                            <span className="eyebrow">A FRESH START</span>
                            <h3>Little things, big comeback.</h3>
                            <p>Your resurrected to-do list.</p>
                            {todos.map((t, i) => (
                              <button
                                key={t.label}
                                className={t.done ? "todo done" : "todo"}
                                onClick={() =>
                                  setTodos((prev) =>
                                    prev.map((item, index) =>
                                      index === i
                                        ? { ...item, done: !item.done }
                                        : item,
                                    ),
                                  )
                                }
                              >
                                <span>{t.done && <Check size={13} />}</span>
                                {t.label}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className="certificate">
                          <span className="certificate-seal">
                            <ShieldCheck size={28} />
                          </span>
                          <span className="eyebrow">
                            RESURRECTION CERTIFICATE
                          </span>
                          <h3>
                            Officially back.
                            <br />
                            Unofficially immortal.
                          </h3>
                          <p>
                            Demo checks: build, 8 tests, and a browser smoke
                            check.
                          </p>
                          <span className="badge green">
                            ✓ Verified working · demo
                          </span>
                          <button
                            className="secondary-button"
                            onClick={certificate}
                          >
                            <ArrowDownToLine size={15} /> Download demo
                            certificate
                          </button>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="waiting-state">
                      <GhostMascot />
                      <h2>A heartbeat is worth waiting for.</h2>
                      <p>
                        Run the demo in the lab to unlock the preview and
                        certificate.
                      </p>
                      <button className="primary-button" onClick={startDemo}>
                        <Sparkles size={16} /> Start demo resurrection
                      </button>
                    </div>
                  )}
                </section>
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <span className="footer-spark">✦</span> Built for second chances.
            </span>
            <span>
              Graph-powered possibilities. Human-sized hope.{" "}
              <span className="footer-divider">/</span> Re:Spawn © 2026
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <section
            ref={modalRef}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setModal(null);
            }}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "new" ? (
              <>
                <span className="modal-emblem">
                  <Github size={27} />
                </span>
                <div className="eyebrow">A SECOND CHANCE STARTS HERE</div>
                <h2 id="modal-title">Unearth a forgotten project.</h2>
                <p>
                  Bring a JavaScript or TypeScript repository to your graveyard.
                </p>
                <form onSubmit={addRepo}>
                  <label htmlFor="repo-url">GitHub repository URL</label>
                  <input
                    ref={inputRef}
                    id="repo-url"
                    type="url"
                    required
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value);
                      setError("");
                    }}
                    placeholder="https://github.com/you/that-old-idea"
                  />
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="form-note">
                    <ShieldCheck size={16} /> UI preview only. No repository is
                    cloned or modified.
                  </div>
                  <button className="primary-button" type="submit">
                    <Plus size={16} /> Add to the graveyard
                  </button>
                </form>
              </>
            ) : (
              <>
                <GhostMascot small />
                <div className="eyebrow">THE FIELD GUIDE</div>
                <h2 id="modal-title">A short guide to the afterlife.</h2>
                <p>
                  This interactive prototype follows four scenes. All repair
                  events and graph facts are demonstration data.
                </p>
                <ol className="guide-steps">
                  <li>
                    <Skull />
                    <div>
                      <strong>The graveyard</strong>
                      <p>Add a repository or inspect a project’s story.</p>
                    </div>
                  </li>
                  <li>
                    <FlaskConical />
                    <div>
                      <strong>The resurrection lab</strong>
                      <p>Play the demo diagnosis and repair sequence.</p>
                    </div>
                  </li>
                  <li>
                    <GitBranch />
                    <div>
                      <strong>The recovery tree</strong>
                      <p>
                        Inspect prerequisites, conflicts, and alternative paths.
                      </p>
                    </div>
                  </li>
                  <li>
                    <Zap />
                    <div>
                      <strong>Respawn</strong>
                      <p>Explore the mock app and download demo evidence.</p>
                    </div>
                  </li>
                </ol>
                <button
                  className="primary-button"
                  onClick={() => {
                    setModal(null);
                    startDemo();
                  }}
                >
                  Meet your next comeback <ArrowRight size={15} />
                </button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
function Status({ status }: { status: Project["status"] }) {
  const tone =
    status === "Verified working"
      ? "green"
      : status === "Diagnosed"
        ? "amber"
        : status === "Build passing"
          ? "purple"
          : "muted";
  return (
    <span className={`badge ${tone}`}>
      <span />
      {status}
    </span>
  );
}
