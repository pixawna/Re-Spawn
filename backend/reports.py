"""Run evidence → readable report. No LLM, graph writes, or inferred success."""

from __future__ import annotations
import html
import json
import re
import time
from pathlib import Path


def build(run, runs=()) -> dict:
    # Copy the event list under its writer lock; never change recorded evidence.
    with run.cond:
        events = list(run.events)
        cert = dict(run.certificate or {})
    controller = "unrecorded"
    timeline, queries, rounds, learned, reused, checks = [], [], [], [], [], []
    opened = []
    for e in events:
        kind = e["type"]
        if kind == "agent_mode":
            controller = e.get("mode", "unrecorded")
        if kind == "agent_fallback":
            controller = "deterministic"
        if kind == "tool" and e.get("status") == "start":
            row = {
                "seq": e["seq"],
                "t": e["t"],
                "kind": "tool",
                "title": e.get("tool", "tool"),
                "controller": controller,
                "args": e.get("args", {}),
                "queries": [],
                "result": None,
            }
            timeline.append(row)
            opened.append(row)
        elif kind == "cypher":
            q = {
                k: e.get(k)
                for k in ("seq", "t", "query", "params", "rows", "ms", "tag")
            }
            queries.append(q)
            if opened:
                opened[-1]["queries"].append(e["seq"])
        elif kind == "tool" and e.get("status") == "done":
            row = next(
                (x for x in reversed(opened) if x["title"] == e.get("tool")), None
            )
            if row:
                result = e.get("result")
                # Large certificates/tool payloads stay in their dedicated sections.
                if isinstance(result, dict):
                    result = {
                        k: v
                        for k, v in result.items()
                        if k
                        not in ("certificate", "decision_trace", "plans", "why_chains")
                    }
                row["result"] = result
                row["completed_at"] = e["t"]
                opened.remove(row)
        elif kind in (
            "decision",
            "agent_mode",
            "agent_fallback",
            "approval_required",
            "approval_resolved",
            "attempt",
            "error",
            "unsupported",
            "say",
        ):
            timeline.append(
                {
                    "seq": e["seq"],
                    "t": e["t"],
                    "kind": kind,
                    "title": e.get("text")
                    or e.get("message")
                    or e.get("mode")
                    or kind.replace("_", " "),
                    "controller": controller,
                    "detail": {
                        k: v for k, v in e.items() if k not in ("seq", "t", "type")
                    },
                }
            )
        if kind == "plans":
            rounds.append(
                {
                    "seq": e["seq"],
                    "t": e["t"],
                    "chosen": e.get("chosen"),
                    "plans": e.get("plans", []),
                    "planning": e.get("planning", {}),
                }
            )
        elif kind == "learned" and e.get("learned"):
            learned.append(e)
        elif kind == "shared_learning":
            reused.append(e)
        elif kind == "verify":
            checks.append(e)
    # Reuse is evidence observed in this API session, not an invented global count.
    later = []
    seen_reuse = set()
    for other in runs:
        if other.id == run.id:
            continue
        with other.cond:
            for e in other.events:
                if e["type"] == "shared_learning" and e.get("source_run") == run.id:
                    key = (other.id, e.get("a"), e.get("b"))
                    if key not in seen_reuse:
                        later.append(
                            {"project": other.project_id, "run": other.id, "fact": e}
                        )
                        seen_reuse.add(key)
    diagnosis = next((e for e in events if e["type"] == "diagnosis"), None)
    why = next((e for e in events if e["type"] == "why_chain"), {})
    attempts = cert.get("attempts") or [
        dict(e, outcome=e.get("status")) for e in events if e["type"] == "attempt"
    ]
    attempts = list({a["n"]: a for a in attempts if "n" in a}.values())
    before, after = cert.get("before", {}), cert.get("after", {})
    terminal = run.status not in ("running", "awaiting_approval")
    duration = cert.get(
        "duration",
        events[-1]["t"] if terminal and events else round(time.time() - run.started, 1),
    )
    return {
        "version": 1,
        "run": run.id,
        "project": run.project_id,
        "summary": {
            "status": run.status,
            "initial_status": (
                "build passed"
                if diagnosis and diagnosis.get("alive")
                else "build failed" if diagnosis else "not established"
            ),
            "duration": duration,
            "routes_tried": len(attempts),
            "tests": cert.get("tests"),
            "environment": cert.get("environment") or run.execution_environment,
            "controllers": list(dict.fromkeys(x["controller"] for x in timeline)),
            "complete": terminal,
        },
        "cause": {
            "diagnosis": diagnosis,
            "chains": why.get("chains", []),
            "queries": why.get("queries", []),
            "unavailable_reason": next(
                (
                    e.get("message")
                    for e in events
                    if e["type"] in ("unsupported", "error")
                ),
                None,
            ),
        },
        "timeline": timeline,
        "route_rounds": rounds,
        "attempts": attempts,
        "learned": learned,
        "reused": reused,
        "later_reuses": later,
        "reuse_scope": "Recorded reuse events observed when this report was generated; not an exhaustive graph-wide reuse count.",
        "changes": [
            {"name": name, "before": before.get(name), "after": after.get(name)}
            for name in dict.fromkeys([*before, *after])
            if before.get(name) != after.get(name)
        ],
        "patch": run.patch
        or next(
            (e.get("diff", "") for e in reversed(events) if e["type"] == "patch"), ""
        ),
        "proof": {
            "verification": cert.get("verification"),
            "checks": checks,
            "smoke": cert.get("smoke", []),
            "scope": cert.get(
                "verification_scope",
                "No completed verification certificate. A build failure or incomplete run is not proof of success.",
            ),
            "not_verified": "No automatic browser interaction, security audit, production deployment, or exhaustive compatibility guarantee.",
        },
        "queries": queries,
        "evidence_note": "Recorded run evidence only. Query row counts are not full result sets; route evidence includes captured graph facts (up to the backend capture limit). Missing data is reported as unavailable.",
    }


def sections(report):
    def dump(value):
        return json.dumps(value, indent=2, ensure_ascii=False, default=str)

    s = report["summary"]
    yield "Summary", f"{s['initial_status']} → {s['status']}\nRun: {report['run']}\nDuration: {s['duration']} s · routes tried: {s['routes_tried']}\nTests: {dump(s['tests']) if s['tests'] is not None else 'Not recorded'}\nEnvironment: {dump(s['environment'])}\nControllers: {', '.join(s['controllers']) or 'Not recorded'}\n{'Completed run' if s['complete'] else 'Live snapshot — run is still in progress'}"
    c = report["cause"]
    yield "Cause of death", (
        dump(c["diagnosis"])
        if c["diagnosis"]
        else c.get("unavailable_reason") or "No diagnosis was recorded."
    )
    yield "Why chain", "\n\n".join(
        " → ".join(c.get("labels", c["ids"])) + "\n" + dump(c)
        for c in report["cause"]["chains"]
    ) or "No why-chain was captured."
    yield "Decision timeline", "\n\n".join(
        f"{x['t']}s · {x['controller']} · {x['title']}\n" + dump(x)
        for x in report["timeline"]
    ) or "No decisions recorded."
    route_text = []
    for index, rnd in enumerate(report["route_rounds"], 1):
        route_text.append(f"Planning round {index} · {rnd['t']}s")
        for p in rnd["plans"]:
            verdict = (
                "CHOSEN"
                if p["id"] == rnd["chosen"]
                else (
                    "Feasible alternative (not selected at this round)"
                    if p.get("feasible")
                    else "RULED OUT"
                )
            )
            route_text.append(
                f"{verdict} · cost {p['cost']} · {' → '.join(p.get('titles', p.get('steps', [])))}\nReasons: {'; '.join(p.get('reasons', [])) or 'No exclusion recorded'}\nGraph evidence:\n{dump(p.get('evidence', []))}"
            )
    yield "Routes considered", "\n\n".join(
        route_text
    ) or "No candidate plans were recorded."
    yield "What was learned", "New facts:\n" + (
        dump(report["learned"]) if report["learned"] else "None recorded."
    ) + "\n\nPrior knowledge reused:\n" + (
        dump(report["reused"]) if report["reused"] else "None recorded."
    ) + "\n\nLater observed reuse:\n" + (
        dump(report["later_reuses"]) if report["later_reuses"] else "None observed."
    ) + "\n" + report[
        "reuse_scope"
    ]
    yield "Changes made", dump(
        report["changes"]
    ) + "\n\nActual patch (last attempted patch if the run failed):\n" + (
        report["patch"] or "No patch recorded."
    )
    yield "Proof it works", dump(report["proof"])
    yield "Graph evidence", "\n\n".join(
        f"Query #{q['seq']} · {q['tag']} · {q['rows']} rows\n{q['query']}\nParameters: {dump(q['params'])}"
        for q in report["queries"]
    ) or "No queries recorded."


def markdown(report):
    def fence(text):
        marker = "`" * max(
            3, max((len(m.group()) + 1 for m in re.finditer(r"`+", text)), default=3)
        )
        return marker + "text\n" + text + "\n" + marker

    return (
        "# Resurrection report\n\n"
        + fence("Project: " + str(report["project"]))
        + "\n\n"
        + report["evidence_note"]
        + "\n\n"
        + "\n\n".join(
            "## " + title + "\n\n" + fence(body) for title, body in sections(report)
        )
        + "\n"
    )


def html_document(report):
    esc = html.escape
    body = "".join(
        "<section><h2>" + esc(title) + "</h2><pre>" + esc(content) + "</pre></section>"
        for title, content in sections(report)
    )
    return (
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Resurrection report</title><style>body{margin:0 auto;max-width:1000px;padding:32px;background:#140f28;color:#ece4ff;font:16px/1.65 system-ui}h1,h2{color:#7dff8a}section{border-top:1px solid #4b3a7d;padding:20px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.65 ui-monospace,monospace}p{color:#b9b2d1}@media print{body{background:white;color:black}h1,h2{color:#203c20}}</style><h1>'
        + esc(str(report["project"]))
        + " · Resurrection report</h1><p>"
        + esc(report["evidence_note"])
        + "</p>"
        + body
        + "</html>"
    )


def save(run, directory: Path, runs=()):
    directory.mkdir(parents=True, exist_ok=True)
    report = build(run, runs)
    destination = directory / (run.id + ".json")
    temporary = destination.with_suffix(".tmp")
    temporary.write_text(json.dumps(report, default=str))
    temporary.replace(destination)
    return report


def load(run_id, directory: Path):
    if not re.fullmatch(r"run-[a-f0-9]{8}", run_id):
        return None
    path = directory / (run_id + ".json")
    if not path.is_file() or path.is_symlink():
        return None
    report = json.loads(path.read_text())
    # Link saved runs too: later reuse must remain explainable after a restart.
    later = list(report.get("later_reuses", []))
    known = {
        (item["run"], item["fact"].get("a"), item["fact"].get("b")) for item in later
    }
    for other_path in directory.glob("run-*.json"):
        if other_path == path or other_path.is_symlink():
            continue
        try:
            other = json.loads(other_path.read_text())
            for fact in other.get("reused", []):
                key = (other["run"], fact.get("a"), fact.get("b"))
                if fact.get("source_run") == run_id and key not in known:
                    later.append(
                        {"project": other["project"], "run": other["run"], "fact": fact}
                    )
                    known.add(key)
        except (OSError, ValueError, KeyError):
            continue
    report["later_reuses"] = later
    report["reuse_scope"] = (
        "Recorded reuse events from saved reports; not an exhaustive graph-wide reuse count."
    )
    return report
