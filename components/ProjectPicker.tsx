"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import Pixel from "./Pixel";
import Stepper from "./Stepper";
import { crt, tombstone, tombstoneCracked } from "@/lib/sprites";
import { api, type Project } from "@/lib/api";

const STATUS: Record<string, { label: string; tone: string }> = {
  unverified: { label: "Not checked yet", tone: "idle" },
  diagnosing: { label: "Being examined", tone: "busy" },
  dead: { label: "Build fails", tone: "bad" },
  alive: { label: "Alive and verified", tone: "good" },
  "build-passing": { label: "Builds, partly verified", tone: "busy" },
};

// Plain-language "what's wrong" for the bundled patients; imported repos fall back to their description.
const STORY: Record<string, string> = {
  "legacy-todo-app":
    "A 2020 to-do app on webpack 4. On Node 22 its build crashes with an OpenSSL error. The obvious fix fails, so the agent has to learn and try again.",
  "legacy-kanban-app":
    "Another webpack 4 app with the same disease. Watch it reuse what the graph learned from the to-do app and recover in one try.",
  "legacy-python-report":
    "A Python report generator that imports distutils, which Python 3.12 removed. Same graph, same agent, different ecosystem.",
};

export default function ProjectPicker() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Project[]>("/api/projects")
      .then(setProjects)
      .catch(() => {
        setOffline(true);
        setProjects([]);
      });
  }, []);

  async function dig(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(url.trim())) {
      setError("Paste a GitHub repository URL, like https://github.com/owner/repo");
      return;
    }
    setBusy(true);
    try {
      const r = await api<{ id: string }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ url: url.trim() }),
      });
      router.push(`/resurrect?p=${encodeURIComponent(r.id)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <header className="page-top">
        <Link href="/" className="mini-mark" aria-label="Re:Spawn home">
          re<span>:</span>spawn
        </Link>
        <Stepper current={1} />
      </header>
      <main className="page-body">
        <h1 className="page-title">Choose a project to bring back</h1>
        <p className="page-lede">
          Each of these is genuinely broken on today&apos;s tools. Start with the first one to see the
          whole story: a failed attempt, a lesson written to the graph, and a successful repair.
        </p>
        {offline && (
          <p className="callout bad" role="alert">
            The backend isn&apos;t running. Start it with <code>npm run api</code> and refresh.
          </p>
        )}
        <ul className="project-grid">
          {(projects ?? []).map((p, i) => {
            const st = STATUS[p.status] ?? { label: p.status, tone: "idle" };
            const alive = p.status === "alive" || p.status === "build-passing";
            return (
              <li key={p.id}>
                <Link href={`/resurrect?p=${encodeURIComponent(p.id)}`} className="project-card">
                  {i === 0 && !alive && <span className="ribbon">Start here</span>}
                  <span className="pc-art">
                    <Pixel sprite={alive ? crt : p.status === "dead" ? tombstoneCracked : tombstone} scale={3} />
                  </span>
                  <span className="pc-body">
                    <span className="pc-head">
                      <strong>{p.name}</strong>
                      <span className="eco">{p.ecosystem === "pypi" ? "Python" : "npm"}</span>
                    </span>
                    <span className="pc-story">{STORY[p.id] ?? p.description ?? "An imported repository."}</span>
                    <span className={`pill ${st.tone}`}>{st.label}</span>
                  </span>
                  <span className="pc-go">Open</span>
                </Link>
              </li>
            );
          })}
          {projects === null && <li className="pc-loading">Loading projects…</li>}
        </ul>

        <details className="dig-panel">
          <summary>Or try your own GitHub repository</summary>
          <form onSubmit={dig}>
            <label htmlFor="repo">Public repository URL</label>
            <div className="dig-row">
              <input
                id="repo"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError("");
                }}
                placeholder="https://github.com/owner/old-project"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="submit" className="btn-life" disabled={busy || offline}>
                {busy ? "Cloning…" : "Add project"}
              </button>
            </div>
            <p className={error ? "dig-error" : "dig-hint"} role={error ? "alert" : undefined}>
              {error ||
                "npm and Python projects. Re:Spawn repairs failures its graph knows about and tells you honestly when it doesn't."}
            </p>
          </form>
        </details>
      </main>
    </div>
  );
}
