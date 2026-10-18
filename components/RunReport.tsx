"use client";
import { useEffect, useState } from "react";
import { api, assetUrl, environmentLabel, type Plan } from "@/lib/api";
import FeatureDialog from "./FeatureDialog";
type Entry = {
  seq: number;
  t: number;
  kind: string;
  title: string;
  controller: string;
  args?: unknown;
  result?: unknown;
  detail?: unknown;
  queries?: number[];
};
type Query = {
  seq: number;
  tag: string;
  query: string;
  params: unknown;
  rows: number;
  ms: number;
};
type Report = {
  run: string;
  project: string;
  evidence_note: string;
  summary: {
    status: string;
    initial_status: string;
    duration: number;
    routes_tried: number;
    tests: { passed: number; failed: number } | null;
    environment: { kind: string; version: string };
    controllers: string[];
    complete: boolean;
  };
  cause: {
    diagnosis: {
      alive: boolean;
      command?: string;
      code?: number;
      excerpt?: string;
      error?: { summary: string; class: string };
    } | null;
    chains: {
      ids: string[];
      labels: string[];
      source?: string;
      relationships: string[];
    }[];
    unavailable_reason?: string;
  };
  timeline: Entry[];
  route_rounds: {
    seq: number;
    t: number;
    chosen: string | null;
    plans: Plan[];
    planning: unknown;
  }[];
  attempts: unknown[];
  learned: unknown[];
  reused: unknown[];
  later_reuses: unknown[];
  reuse_scope: string;
  changes: { name: string; before: string | null; after: string | null }[];
  patch: string;
  proof: {
    verification: {
      build: boolean;
      tests_passed: number;
      tests_failed: number;
      smoke: boolean;
    } | null;
    checks: unknown[];
    smoke: unknown[];
    scope: string;
    not_verified: string;
  };
  queries: Query[];
};
function Json({ value }: { value: unknown }) {
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}
function describe(entry: Entry) {
  const data = (entry.kind === "tool" ? entry.result : entry.detail) as Record<
    string,
    unknown
  > | null;
  if (!data || typeof data !== "object") return "";
  const failure = data.failure as { summary?: string } | undefined;
  if (failure?.summary) return failure.summary;
  if (entry.kind === "attempt")
    return `Route ${data.n ?? ""}: ${data.status ?? "recorded"}${data.stage ? ` at ${data.stage}` : ""}`;
  if (entry.kind === "tool" && data.chosen && typeof data.chosen === "object") {
    const chosen = data.chosen as { titles?: string[] };
    return chosen.titles
      ? `Graph-selected route: ${chosen.titles.join(" → ")}`
      : "Graph returned a selected route.";
  }
  if (data.status) return `Recorded outcome: ${data.status}`;
  return "";
}
export default function RunReport({
  runId,
  onClose,
  inline = false,
}: {
  runId: string;
  onClose: () => void;
  inline?: boolean;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api<Report>(`/api/runs/${runId}/report`)
      .then((data) => {
        if (!cancelled) {
          setReport(data);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [runId, revision]);
  const sections = [
    "Summary",
    "Cause of death",
    "Decision timeline",
    "Routes considered",
    "What was learned",
    "Changes made",
    "Proof it works",
    "Graph evidence",
  ];
  return (
    <FeatureDialog
      title={report?.project ?? "Resurrection report"}
      kicker="Resurrection report"
      onClose={onClose}
      className="report-dialog"
      inline={inline}
    >
      {!report && !error && <p role="status">Gathering recorded evidence…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          <button
            className="btn-ghost"
            onClick={() => setRevision((v) => v + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {report && (
        <>
          <div className="report-banner">
            <span
              className={`report-status ${report.summary.status === "alive" ? "alive" : ""}`}
            >
              {report.summary.initial_status} → {report.summary.status}
            </span>
            <code>{report.run}</code>
            <p>
              {report.summary.complete
                ? "A complete record of this recovery."
                : "Live snapshot. This run is still in progress."}
            </p>
          </div>
          <div className="report-toolbar">
            <a
              className="btn-life"
              href={assetUrl(`/api/runs/${runId}/report?format=markdown`)}
            >
              Export Markdown ↓
            </a>
            <a
              className="btn-ghost"
              href={assetUrl(`/api/runs/${runId}/report?format=html`)}
            >
              Export HTML ↓
            </a>
            <button
              className="btn-ghost"
              onClick={() => setRevision((v) => v + 1)}
            >
              Refresh evidence
            </button>
          </div>
          <nav className="report-index" aria-label="Report sections">
            {sections.map((name, i) => (
              <a key={name} href={`#report-${i}`}>
                {String(i + 1).padStart(2, "0")} {name}
              </a>
            ))}
          </nav>
          <section id="report-0" className="report-section">
            <h3>
              <small>01</small> Summary
            </h3>
            <dl className="report-metrics">
              <div>
                <dt>Time to recover</dt>
                <dd>{report.summary.duration}s</dd>
              </div>
              <div>
                <dt>Routes tried</dt>
                <dd>{report.summary.routes_tried}</dd>
              </div>
              <div>
                <dt>Tests passed / failed</dt>
                <dd>
                  {report.summary.tests
                    ? `${report.summary.tests.passed} / ${report.summary.tests.failed}`
                    : "Not recorded"}
                </dd>
              </div>
              <div>
                <dt>Environment</dt>
                <dd>
                  {report.summary.environment?.kind
                    ? environmentLabel(report.summary.environment)
                    : "Not recorded"}
                </dd>
              </div>
            </dl>
            <p>
              Controller history:{" "}
              {report.summary.controllers.join(" → ") || "Not recorded"}.
              Recorded tool calls below show the controller active at the time.
            </p>
          </section>
          <section id="report-1" className="report-section">
            <h3>
              <small>02</small> Cause of death
            </h3>
            {report.cause.diagnosis ? (
              <>
                <p>
                  {report.cause.diagnosis.alive
                    ? "The original build passed; no build failure was established."
                    : (report.cause.diagnosis.error?.summary ??
                      "The original command failed.")}
                </p>
                {report.cause.diagnosis.command && (
                  <code>
                    {report.cause.diagnosis.command} · exit{" "}
                    {report.cause.diagnosis.code}
                  </code>
                )}
                {report.cause.diagnosis.excerpt && (
                  <pre className="report-error">
                    {report.cause.diagnosis.excerpt}
                  </pre>
                )}
              </>
            ) : (
              <p>
                {report.cause.unavailable_reason ??
                  "No diagnosis was recorded."}
              </p>
            )}
            {report.cause.chains.map((chain, i) => (
              <div className="report-chain" key={i}>
                <strong>{chain.labels.join(" → ")}</strong>
                <p>
                  {chain.relationships.join(" → ")}
                  {chain.source ? ` · ${chain.source}` : ""}
                </p>
              </div>
            ))}
            {!report.cause.chains.length && (
              <p className="feature-muted">
                No why-chain was captured for this run.
              </p>
            )}
          </section>
          <section id="report-2" className="report-section">
            <h3>
              <small>03</small> Decision timeline
            </h3>
            <ol className="report-timeline">
              {report.timeline.map((entry) => (
                <li key={entry.seq}>
                  <div>
                    <time>{entry.t}s</time>
                    <span>
                      {entry.controller} · {entry.kind}
                    </span>
                  </div>
                  <strong>{entry.title}</strong>
                  {describe(entry) && <p>{describe(entry)}</p>}
                  {entry.kind === "tool" && (
                    <p>
                      {entry.queries?.length ?? 0} recorded graph queries
                      {entry.result == null
                        ? " · no completed result recorded"
                        : ""}
                    </p>
                  )}
                  <details>
                    <summary>
                      Recorded{" "}
                      {entry.kind === "tool" ? "arguments and result" : "event"}
                    </summary>
                    <Json
                      value={
                        entry.kind === "tool"
                          ? {
                              arguments: entry.args,
                              result: entry.result,
                              query_sequences: entry.queries,
                            }
                          : entry.detail
                      }
                    />
                  </details>
                </li>
              ))}
            </ol>
            {!report.timeline.length && (
              <p>No decision events were recorded.</p>
            )}
          </section>
          <section id="report-3" className="report-section">
            <h3>
              <small>04</small> Routes considered
            </h3>
            {report.route_rounds.map((round, i) => (
              <div className="report-round" key={round.seq}>
                <h4>
                  Planning round {i + 1} <span>at {round.t}s</span>
                </h4>
                {round.plans.map((plan) => (
                  <details
                    className={`report-route ${plan.id === round.chosen ? "chosen" : ""}`}
                    key={plan.id}
                  >
                    <summary>
                      <span>
                        {plan.id === round.chosen
                          ? "✦ Chosen"
                          : plan.feasible
                            ? "○ Feasible alternative"
                            : "× Ruled out"}{" "}
                        · {plan.titles.join(" → ")}
                      </span>
                      <b>cost {plan.cost}</b>
                    </summary>
                    <p>
                      {plan.reasons.length
                        ? plan.reasons.join("; ")
                        : plan.id === round.chosen
                          ? "Selected by the graph planner at this round."
                          : "Feasible but not selected at this round; compare the recorded costs and algorithm evidence."}
                    </p>
                    {plan.approval_required && (
                      <p>Approval required before execution.</p>
                    )}
                    <details>
                      <summary>Exact graph facts and Cypher</summary>
                      <Json value={plan.evidence ?? []} />
                    </details>
                  </details>
                ))}
                <details>
                  <summary>Shortest-path algorithm evidence</summary>
                  <Json value={round.planning} />
                </details>
              </div>
            ))}
            {!report.route_rounds.length && (
              <p>No candidate plans were recorded.</p>
            )}
          </section>
          <section id="report-4" className="report-section">
            <h3>
              <small>05</small> What was learned
            </h3>
            <h4>New facts written</h4>
            {report.learned.length ? (
              <Json value={report.learned} />
            ) : (
              <p>No new learned fact was recorded.</p>
            )}
            <h4>Prior knowledge reused</h4>
            {report.reused.length ? (
              <Json value={report.reused} />
            ) : (
              <p>No reuse was recorded for this run.</p>
            )}
            <h4>Later projects that reused this run’s facts</h4>
            {report.later_reuses.length ? (
              <Json value={report.later_reuses} />
            ) : (
              <p>No later reuse observed.</p>
            )}
            <p className="feature-muted">{report.reuse_scope}</p>
          </section>
          <section id="report-5" className="report-section">
            <h3>
              <small>06</small> Changes made
            </h3>
            {report.changes.length ? (
              <div className="report-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Artifact</th>
                      <th>Before</th>
                      <th>After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.changes.map((change) => (
                      <tr key={change.name}>
                        <th>{change.name}</th>
                        <td>{change.before ?? "—"}</td>
                        <td>{change.after ?? "removed"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No before/after version changes recorded.</p>
            )}
            <details open>
              <summary>
                Actual patch · last attempted patch if recovery failed
              </summary>
              <pre>{report.patch || "No patch was recorded."}</pre>
            </details>
          </section>
          <section id="report-6" className="report-section">
            <h3>
              <small>07</small> Proof it works
            </h3>
            {report.proof.verification ? (
              <dl className="report-metrics">
                <div>
                  <dt>Build</dt>
                  <dd>
                    {report.proof.verification.build ? "Passed" : "Failed"}
                  </dd>
                </div>
                <div>
                  <dt>HTTP smoke</dt>
                  <dd>
                    {report.proof.verification.smoke
                      ? "Passed"
                      : "Incomplete / failed"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p>
                No completed verification certificate. Success has not been
                established.
              </p>
            )}
            <p>{report.proof.scope}</p>
            <p className="feature-muted">{report.proof.not_verified}</p>
            <details>
              <summary>Test and HTTP check records</summary>
              <Json
                value={{
                  checks: report.proof.checks,
                  http: report.proof.smoke,
                }}
              />
            </details>
          </section>
          <section id="report-7" className="report-section">
            <h3>
              <small>08</small> Graph evidence
            </h3>
            <p className="feature-muted">{report.evidence_note}</p>
            {report.queries.map((query) => (
              <details key={query.seq}>
                <summary>
                  #{query.seq} · {query.tag || "Cypher"} · {query.rows} rows ·{" "}
                  {query.ms}ms
                </summary>
                <pre>{query.query}</pre>
                <Json value={query.params} />
              </details>
            ))}
            {!report.queries.length && <p>No graph queries recorded.</p>}
          </section>
        </>
      )}
    </FeatureDialog>
  );
}
