"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Pixel from "./Pixel";
import { reaper, type Mood } from "@/lib/sprites";
import type { Plan, RunEvent } from "@/lib/api";

type Tab = "story" | "cypher" | "terminal";

type Item =
  | { kind: "say"; seq: number; text: string; mood: Mood }
  | { kind: "tool"; seq: number; tool: string; description: string; result?: unknown; queries: RunEvent[]; done: boolean }
  | { kind: "event"; seq: number; ev: RunEvent };

const PHASES = [
  { id: "diagnose", label: "Diagnose" },
  { id: "discover", label: "Search the graph" },
  { id: "repair", label: "Repair" },
  { id: "verify", label: "Verify" },
];

function buildStory(events: RunEvent[]): Item[] {
  const items: Item[] = [];
  let open: Extract<Item, { kind: "tool" }> | null = null;
  for (const ev of events) {
    if (ev.type === "say") items.push({ kind: "say", seq: ev.seq, text: String(ev.text), mood: (ev.mood as Mood) || "neutral" });
    else if (ev.type === "tool" && ev.status === "start") {
      open = { kind: "tool", seq: ev.seq, tool: String(ev.tool), description: String(ev.description), queries: [], done: false };
      items.push(open);
    } else if (ev.type === "tool" && ev.status === "done") {
      if (open) {
        open.result = ev.result;
        open.done = true;
      }
      open = null;
    } else if (ev.type === "cypher" && open) open.queries.push(ev);
    else if (["diagnosis", "plans", "attempt", "learned", "patch", "verify", "error"].includes(ev.type))
      items.push({ kind: "event", seq: ev.seq, ev });
  }
  return items;
}

function ToolCard({ item }: { item: Extract<Item, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  const r = item.result as Record<string, unknown> | string[] | undefined;
  let summary = "";
  if (Array.isArray(r)) summary = r.join(", ") || "nothing found";
  else if (r && typeof r === "object") {
    if ("chosen" in r) summary = r.chosen ? `best route: ${(r.chosen as string[]).join(" + ")}` : "no feasible route";
    else if ("learned" in r) summary = `${r.a} conflicts with ${r.b}`;
    else if ("attempt" in r) summary = `${r.outcome} · ${r.attempt}`;
    else summary = JSON.stringify(r).slice(0, 120);
  }
  return (
    <div className={`j-tool ${item.done ? "" : "is-live"}`}>
      <button className="j-tool-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="j-fn">{item.tool}()</span>
        <span className="j-q">{item.queries.length} {item.queries.length === 1 ? "query" : "queries"}</span>
      </button>
      <p className="j-sum">{item.done ? summary : item.description}</p>
      {open && (
        <ol className="j-queries">
          {item.queries.map((q) => (
            <li key={q.seq}>
              <code>{String(q.query)}</code>
              <small>
                {String(q.rows)} rows in {String(q.ms)} ms
              </small>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PlanList({ plans, chosen }: { plans: Plan[]; chosen: string | null }) {
  return (
    <div className="j-plans">
      <p className="j-label">Routes FalkorDB found</p>
      <ol>
        {plans.map((p) => (
          <li key={p.id} className={p.id === chosen ? "is-chosen" : p.feasible ? "" : "is-out"}>
            <span className="j-route">{p.titles.join(" → ")}</span>
            <span className="j-cost">{p.cost}</span>
            {!p.feasible && <small>{p.reasons.join("; ")}</small>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function EventCard({ ev }: { ev: RunEvent }) {
  const [showDiff, setShowDiff] = useState(false);
  switch (ev.type) {
    case "diagnosis": {
      if (ev.alive) return <div className="j-card ok">The original build passes. Nothing to repair.</div>;
      const err = ev.error as { summary: string; match: string };
      return (
        <div className="j-card bad">
          <p>
            <strong>{ev.step === "install" ? "npm install" : "npm run build"} failed</strong> with exit code {String(ev.code)}.
          </p>
          <pre>{String(ev.excerpt)}</pre>
          <small>Matched graph signature: {err.match || "none"}</small>
        </div>
      );
    }
    case "plans":
      return <PlanList plans={ev.plans as Plan[]} chosen={(ev.chosen as string) || null} />;
    case "attempt": {
      const titles = (ev.titles as string[]) || (ev.steps as string[]);
      if (ev.status === "running")
        return (
          <div className="j-card live">
            <strong>Route {String(ev.n)}</strong> in a fresh sandbox: {titles?.join(" → ")}
          </div>
        );
      if (ev.status === "success")
        return (
          <div className="j-card ok">
            <strong>Route {String(ev.n)} worked.</strong> Install, build and tests passed.
          </div>
        );
      const err = ev.error as { summary: string };
      return (
        <div className="j-card bad">
          <p>
            <strong>Route {String(ev.n)} failed at {String(ev.stage)}.</strong> {err?.summary}
          </p>
          <pre>{String(ev.excerpt)}</pre>
        </div>
      );
    }
    case "learned":
      return (
        <div className="j-card learn">
          New fact written to FalkorDB
          <code>
            ({String(ev.a)})-[:CONFLICTS_WITH]-&gt;({String(ev.b)})
          </code>
        </div>
      );
    case "patch":
      return (
        <div className="j-card">
          <button className="j-link" onClick={() => setShowDiff((s) => !s)} aria-expanded={showDiff}>
            {showDiff ? "Hide" : "Show"} the change for route {String(ev.n)}
          </button>
          {showDiff && <pre className="diff">{String(ev.diff)}</pre>}
        </div>
      );
    case "verify":
      if (ev.check === "tests")
        return (
          <div className={`j-card ${ev.ok ? "ok" : "bad"}`}>
            Tests: {String(ev.passed)} passing, {String(ev.failed)} failing
          </div>
        );
      return (
        <div className={`j-card ${ev.ok ? "ok" : "bad"}`}>
          HTTP smoke check:{" "}
          {((ev.checks as { url: string; status: number }[]) || []).map((c) => `${c.url} ${c.status}`).join(", ") ||
            String(ev.error)}
        </div>
      );
    case "error":
      return <div className="j-card bad">The agent crashed: {String(ev.message)}</div>;
  }
  return null;
}

export default function Journal({ events, phase, done }: { events: RunEvent[]; phase: string | null; done: boolean }) {
  const [tab, setTab] = useState<Tab>("story");
  const scroller = useRef<HTMLDivElement>(null);
  const story = useMemo(() => buildStory(events), [events]);
  const cypher = useMemo(() => events.filter((e) => e.type === "cypher"), [events]);
  const logs = useMemo(() => events.filter((e) => e.type === "log"), [events]);
  const phaseIdx = PHASES.findIndex((p) => p.id === phase);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length, tab]);

  return (
    <section className="journal" aria-label="What the agent is doing">
      <ol className="phases" aria-label="Progress">
        {PHASES.map((p, i) => (
          <li key={p.id} className={i < phaseIdx || (done && i <= phaseIdx) ? "is-done" : i === phaseIdx ? "is-now" : ""}>
            {p.label}
          </li>
        ))}
      </ol>
      <div className="tabs" role="tablist">
        {(
          [
            ["story", "Story"],
            ["cypher", `Cypher (${cypher.length})`],
            ["terminal", `Terminal (${logs.length})`],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="journal-body" ref={scroller}>
        {events.length === 0 && (
          <p className="j-empty">
            Press <strong>Resurrect</strong> and Mori will install the original dependencies, read the failure, and ask FalkorDB for a way back.
          </p>
        )}
        {tab === "story" &&
          story.map((item) =>
            item.kind === "say" ? (
              <div key={item.seq} className={`j-say mood-${item.mood}`}>
                <Pixel sprite={reaper(item.mood)} scale={2} />
                <p>{item.text}</p>
              </div>
            ) : item.kind === "tool" ? (
              <ToolCard key={item.seq} item={item} />
            ) : (
              <EventCard key={item.seq} ev={item.ev} />
            ),
          )}
        {tab === "cypher" &&
          cypher.map((q) => (
            <div key={q.seq} className="j-cy">
              <span>{String(q.tag)}</span>
              <code>{String(q.query)}</code>
              <small>
                {String(q.rows)} rows · {String(q.ms)} ms
              </small>
            </div>
          ))}
        {tab === "terminal" && (
          <pre className="j-term">
            {logs.map((l) => (
              <span key={l.seq} className={`t-${String(l.stream)} ${/ERR|error|ERESOLVE/.test(String(l.line)) ? "t-red" : ""}`}>
                {String(l.line)}
                {"\n"}
              </span>
            ))}
          </pre>
        )}
      </div>
    </section>
  );
}
