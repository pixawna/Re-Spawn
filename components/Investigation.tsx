"use client";
import { useState, type FormEvent } from "react";
import { api, replay, type Plan, type RunEvent } from "@/lib/api";
export type WhyChain = {
  ids: string[];
  labels: string[];
  relationships: string[];
  evidence?: string;
  source?: string;
};
type Planning = {
  plans: Plan[];
  chosen: Plan | null;
  planning: {
    algorithm: string;
    cost: number | null;
    state_count: number;
    query: string;
    states: Record<string, string>[];
  };
  hypothetical?: boolean;
};
type Answer = {
  answer: string;
  query?: string;
  rows: unknown[];
  highlight_ids: string[];
};
export default function Investigation({
  projectId,
  runId,
  events,
  onChain,
  onHighlight,
}: {
  projectId: string;
  runId: string | null;
  events: RunEvent[];
  onChain: (chain: WhyChain | null) => void;
  onHighlight: (ids: string[]) => void;
}) {
  const [tab, setTab] = useState<"routes" | "chain" | "ask">("routes");
  const [result, setResult] = useState<
    (Planning & { eventSeq: number }) | null
  >(null);
  const [simulation, setSimulation] = useState<Planning | null>(null);
  const [chains, setChains] = useState<WhyChain[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = events.filter((e) => e.type === "approval_required").at(-1);
  const resolved =
    pending &&
    events.some(
      (e) => e.type === "approval_resolved" && e.approval_id === pending.id,
    );
  const recentPlans = events.filter((e) => e.type === "plans").at(-1);
  // A manual refresh may be newer than the last SSE planning event. New run
  // events take over again as soon as their sequence passes that snapshot.
  const useLivePlans =
    recentPlans && (!result || recentPlans.seq > result.eventSeq);
  const plans = useLivePlans
    ? (recentPlans.plans as Plan[])
    : (result?.plans ?? []);
  const chosen = useLivePlans ? recentPlans.chosen : result?.chosen?.id;
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function approve(approved: boolean) {
    await task(async () => {
      await api(`/api/runs/${runId}/approval`, {
        method: "POST",
        body: JSON.stringify({ approval_id: pending?.id, approved }),
      });
    });
  }
  async function ask(e: FormEvent) {
    e.preventDefault();
    await task(async () => {
      const data = await api<Answer>(`/api/projects/${projectId}/ask`, {
        method: "POST",
        body: JSON.stringify({ question }),
      });
      setAnswer(data);
      onChain(null);
      onHighlight(data.highlight_ids ?? []);
    });
  }
  if (replay()) return null;
  return (
    <section className="investigation" aria-label="Graph investigation">
      {pending && !resolved && (
        <div className="approval-card" role="alert">
          <h3>Your approval is needed</h3>
          <p>
            {String(pending.risk)}. This approval applies only to the listed
            recipe in this run.
          </p>
          <strong>{(pending.titles as string[]).join(" → ")}</strong>
          <pre>{JSON.stringify(pending.recipes, null, 2)}</pre>
          <div className="invest-actions">
            <button
              className="btn-life"
              disabled={busy}
              onClick={() => approve(true)}
            >
              Approve this plan
            </button>
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() => approve(false)}
            >
              Reject and replan
            </button>
          </div>
        </div>
      )}
      <div className="invest-tabs">
        {(
          [
            ["routes", "Why this route?"],
            ["chain", "Why chain"],
            ["ask", "Ask Mori"],
          ] as const
        ).map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
            key={id}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="invest-error">
          {error}
        </p>
      )}
      {tab === "routes" && (
        <>
          <div className="invest-actions">
            <button
              disabled={busy}
              className="btn-ghost"
              onClick={() =>
                task(async () => {
                  setSimulation(null);
                  const data = await api<Planning>(
                    `/api/projects/${projectId}/plan`,
                  );
                  setResult({ ...data, eventSeq: events.at(-1)?.seq ?? -1 });
                })
              }
            >
              {busy ? "Reading graph…" : "Refresh recovery routes"}
            </button>
            <button
              disabled={busy}
              className="btn-ghost"
              onClick={() =>
                task(async () => {
                  setSimulation(
                    await api<Planning>(`/api/projects/${projectId}/what-if`, {
                      method: "POST",
                      body: JSON.stringify({ allow_workarounds: true }),
                    }),
                  );
                })
              }
            >
              What if workarounds were allowed?
            </button>
          </div>
          {simulation && (
            <div className="counterfactual">
              <strong>What-if result · live facts unchanged</strong>
              <p>
                {simulation.chosen?.titles.join(" → ") ?? "No feasible route"} ·
                cost {simulation.planning.cost ?? "—"}
              </p>
              <small>
                Execution still requires the live policy and approval. This
                result cannot execute.
              </small>
              <button className="j-link" onClick={() => setSimulation(null)}>
                Close comparison
              </button>
            </div>
          )}
          <p className="invest-caption">
            {result?.planning.algorithm ?? "FalkorDB algo.SPpaths"} selects the
            minimum weighted path through candidate package states.
          </p>
          {plans.map((plan) => (
            <details
              className={`route-evidence ${plan.id === chosen ? "chosen" : ""}`}
              key={plan.id}
            >
              <summary>
                <span>
                  {plan.id === chosen ? "✦ " : plan.feasible ? "○ " : "× "}
                  {plan.titles.join(" → ")}
                </span>
                <b>{plan.cost}</b>
              </summary>
              <p>
                {plan.feasible
                  ? "Feasible under the current graph facts."
                  : plan.reasons.join("; ")}
              </p>
              {plan.approval_required && (
                <p className="risk-note">Approval required before execution.</p>
              )}
              {plan.shared_learning?.map((fact, i) => (
                <p className="shared-fact" key={i}>
                  Known from a past resurrection:{" "}
                  {String(fact.source_project ?? "shared graph")} —{" "}
                  {String(fact.reason)}
                </p>
              ))}
              {plan.evidence?.map((e, i) => (
                <details key={i}>
                  <summary>
                    {e.tag || "Graph evidence"} ·{" "}
                    {e.row_count ?? e.result.length} rows
                  </summary>
                  <code>{e.query}</code>
                  <pre>
                    {JSON.stringify(
                      { params: e.params, facts: e.result },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ))}
            </details>
          ))}
          {plans.length === 0 && (
            <p className="invest-caption">
              Run a diagnosis or refresh routes to inspect feasible and excluded
              plans.
            </p>
          )}
          {result && (
            <details className="route-evidence">
              <summary>Algorithm query and package states</summary>
              <code>{result.planning.query}</code>
              <pre>{JSON.stringify(result.planning.states, null, 2)}</pre>
            </details>
          )}
        </>
      )}
      {tab === "chain" && (
        <>
          <p className="invest-caption">
            Resolved package-lock dependencies and source-backed runtime API
            facts. Import happens during diagnosis.
          </p>
          <div className="invest-actions">
            <button
              className="btn-ghost"
              disabled={busy}
              onClick={() =>
                task(async () => {
                  const data = await api<{ chains: WhyChain[] }>(
                    `/api/projects/${projectId}/why-chains`,
                  );
                  setChains(data.chains);
                  if (data.chains[0]) onChain(data.chains[0]);
                })
              }
            >
              Trace the dependency tree
            </button>
            <button className="btn-ghost" onClick={() => onChain(null)}>
              Back to recovery map
            </button>
          </div>
          {chains.map((chain, i) => (
            <button
              className="chain-choice"
              key={i}
              onClick={() => onChain(chain)}
            >
              <span>{chain.labels.join(" → ")}</span>
              <small>
                {chain.relationships.length} graph hops ·{" "}
                {chain.source ?? "package-lock.json"}
              </small>
              {chain.evidence && <small>{chain.evidence}</small>}
            </button>
          ))}
          {!chains.length && (
            <p className="invest-caption">
              No chain loaded yet. Run diagnosis first, then trace the tree.
            </p>
          )}
        </>
      )}
      {tab === "ask" && (
        <>
          <p className="invest-caption">
            Ask about blockers, migration prerequisites, or learned conflicts.
            Requires your local Anthropic key.
          </p>
          <form onSubmit={ask} className="ask-form">
            <input
              aria-label="Ask Mori about the graph"
              maxLength={1200}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Which packages block webpack 5?"
              required
            />
            <button className="btn-life" disabled={busy}>
              {busy ? "Asking…" : "Ask Mori"}
            </button>
          </form>
          {answer && (
            <div className="graph-answer">
              <p>{answer.answer}</p>
              {answer.query && (
                <details open>
                  <summary>Read-only query and returned facts</summary>
                  <code>{answer.query}</code>
                  <pre>{JSON.stringify(answer.rows, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
