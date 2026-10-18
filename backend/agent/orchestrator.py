"""The resurrection agent loop: diagnose -> discover -> repair (with replanning) -> verify.

Every decision comes from a graph tool call. The loop never hard-codes a route:
change a relationship in FalkorDB and the chosen plan changes with it.
"""

from __future__ import annotations

import json
import asyncio
import os
import re
import subprocess
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any, Optional

from ..graph import client, planner, queries as Q
from ..recovery import executor, inspector, verifier
from .tools import TOOLS

ROOT = Path(__file__).resolve().parents[2]
DATA = client.DATA_DIR
EXAMPLES = ROOT / "examples"
PACE = float(os.getenv("RESPAWN_PACE", "0.45"))
MAX_ATTEMPTS = 4


class Run:
    def __init__(self, project_id: str, mode: str = "auto"):
        self.id = f"run-{uuid.uuid4().hex[:8]}"
        self.project_id = project_id
        self.mode = mode
        self.pending_approval = None
        self.approval_decision = None
        self.workspace = None
        self.pull_request = None
        self.execution_runtime = ""
        self.pr_lock = threading.Lock()
        self.events: list[dict] = []
        self.cond = threading.Condition()
        self.status = "running"
        self.phase = "diagnose"
        self.active_plan: list[str] = []
        self.active_step: Optional[str] = None
        self.plans: list[dict] = []
        self.preview: Optional[Path] = None
        self.certificate: Optional[dict] = None
        self.patch = ""
        self.started = time.time()

    def emit(self, type_: str, **data: Any) -> None:
        with self.cond:
            ev = {
                "seq": len(self.events),
                "type": type_,
                "t": round(time.time() - self.started, 2),
                **data,
            }
            self.events.append(ev)
            self.cond.notify_all()

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project": self.project_id,
            "status": self.status,
            "phase": self.phase,
            "active_plan": self.active_plan,
            "active_step": self.active_step,
            "certificate": self.certificate,
            "events": len(self.events),
            "mode": self.mode,
            "approval": self.pending_approval,
        }


RUNS: dict[str, Run] = {}
LATEST: dict[str, str] = {}  # project -> run id


# ---------------------------------------------------------------- project sources
def project_dir(project: dict) -> Path:
    src = project.get("source", "")
    if src.startswith("example:"):
        return EXAMPLES / src.split(":", 1)[1]
    if src.startswith("git:"):
        return DATA / "repos" / project["id"]
    raise ValueError(f"unknown source {src}")


def clone(url: str, project_id: str, sink) -> Path:
    dest = DATA / "repos" / project_id
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    res = executor.run(
        ["git", "clone", "--depth", "1", url, str(dest)],
        dest.parent,
        sink,
        timeout=180,
        containerize=False,
    )
    if res["code"] != 0:
        raise RuntimeError("git clone failed: " + res["tail"][-300:])
    return dest


def register_project(
    project_id: str, name: str, source: str, owner: str, path: Path, runtime: str
) -> dict:
    info = inspector.inspect(path)
    client.run(
        Q.UPSERT_PROJECT,
        {
            "id": project_id,
            "name": name,
            "source": source,
            "owner": owner,
            "description": info["description"],
        },
        tag="inspect",
    )
    client.run(Q.LINK_PACKAGES, {"id": project_id, "deps": info["deps"]}, tag="inspect")
    client.run(Q.LINK_RUNTIME, {"id": project_id, "runtime": runtime}, tag="inspect")
    return info


def get_project(project_id: str) -> Optional[dict]:
    rows = client.run(
        "MATCH (p:Project {id: $id}) RETURN p", {"id": project_id}, quiet=True
    )
    return rows[0]["p"] if rows else None


# ---------------------------------------------------------------- the loop
def start(project_id: str, mode: str = "auto") -> Run:
    run = Run(project_id, mode)
    RUNS[run.id] = run
    LATEST[project_id] = run.id
    threading.Thread(target=_safe_loop, args=(run,), daemon=True).start()
    return run


def _safe_loop(run: Run) -> None:
    def on_query(cypher, params, rows, ms, tag):
        run.emit(
            "cypher",
            query=cypher,
            params=_short(params),
            rows=rows,
            ms=round(ms, 1),
            tag=tag,
        )

    token = client.set_listener(on_query)
    try:
        _loop(run)
    except Exception as exc:  # noqa: BLE001
        run.status = "error"
        run.emit("error", message=str(exc), trace=traceback.format_exc()[-1500:])
        run.emit("done", status="error")
    finally:
        client.reset_listener(token)


def _short(params: dict) -> dict:
    s = json.dumps(params, default=str)
    return params if len(s) < 600 else {"…": s[:600]}


def _tool(run: Run, name: str, **args) -> dict:
    run.emit(
        "tool",
        tool=name,
        args=args,
        status="start",
        description=TOOLS[name]["description"],
    )
    result = TOOLS[name]["fn"](**args)
    run.emit(
        "tool", tool=name, args=args, status="done", result=_summarize(name, result)
    )
    time.sleep(PACE)
    return result


def _summarize(name: str, r: dict) -> Any:
    if name == "find_blockers":
        return [f"{b['package']} ✕ {b['against']}" for b in r["blockers"]]
    if name == "get_migration_options":
        return [f"{o['id']} (cost {o['cost']}, risk {o['risk']})" for o in r["options"]]
    if name == "resolve_prerequisites":
        return {"order": r["order"], "problems": r["problems"]}
    if name in ("rank_recovery_plans", "find_alternative"):
        return {
            "chosen": r["chosen"]["steps"] if r.get("chosen") else None,
            "plans": [
                {
                    "steps": p["steps"],
                    "cost": p["cost"],
                    "feasible": p["feasible"],
                    "reasons": p["reasons"],
                }
                for p in r["plans"]
            ],
        }
    return r


def _sink(run: Run, step: str):
    root = str(DATA / "runs" / run.id)

    def sink(stream: str, line: str) -> None:
        if line.strip():
            run.emit(
                "log",
                stream=stream,
                line=line.replace(root, "<sandbox>")[:400],
                step=step,
            )

    return sink


def _say(run: Run, text: str, mood: str = "neutral") -> None:
    run.emit("say", text=text, mood=mood)
    time.sleep(PACE * 0.6)


def _phase(run: Run, phase: str, label: str) -> None:
    run.phase = phase
    run.emit("phase", phase=phase, label=label)
    run.emit("graph")


def _runtime_for(major: int) -> dict:
    rows = client.run(
        "MATCH (rt:Runtime {id: $id}) RETURN rt", {"id": f"node@{major}"}, quiet=True
    )
    return rows[0]["rt"] if rows else {}


def _loop(run: Run) -> None:
    from .session import RecoverySession
    from .claude import run_agent
    from ..config import agent_config

    session = RecoverySession(run)
    settings = agent_config()
    use_claude = run.mode in ("auto", "claude") and settings["claude_available"]
    if use_claude:
        try:
            asyncio.run(run_agent(session))
            return
        except Exception as exc:
            if run.status not in ("running", "awaiting_approval"):
                return
            run.emit(
                "agent_fallback",
                reason=type(exc).__name__,
                message="Claude could not continue. Resuming with the deterministic graph controller.",
            )
    elif run.mode != "deterministic":
        run.emit(
            "agent_fallback",
            reason="missing_key",
            message="ANTHROPIC_API_KEY is absent. Using the deterministic graph controller.",
        )
    run.emit("agent_mode", mode="deterministic")
    session.fallback()


def _excerpt(output: str, match: str) -> str:
    lines = output.splitlines()
    if match:
        for i, line in enumerate(lines):
            if match in line:
                return "\n".join(lines[max(0, i - 3) : i + 6])
    return "\n".join(lines[-10:])


def _finish(
    run: Run,
    pid: str,
    project: dict,
    info: dict,
    ws: Path,
    source: Path,
    steps: list[str],
    tests: dict,
    attempts: list[dict],
) -> None:
    _phase(run, "verify", "Verifying")
    counts = verifier.count_tests(tests.get("output", ""))
    run.emit("verify", check="tests", ok=tests["code"] == 0, **counts)
    site = verifier.output_dir(ws)
    smoke = (
        verifier.smoke(site)
        if site
        else {"ok": False, "checks": [], "error": "no index.html in build output"}
    )
    run.emit(
        "verify",
        check="smoke",
        ok=smoke["ok"],
        checks=smoke.get("checks", []),
        error=smoke.get("error"),
    )
    build_ok = True
    verification = {
        "build": build_ok,
        "tests_passed": counts["passed"],
        "tests_failed": counts["failed"],
        "smoke": bool(smoke["ok"]),
    }
    alive = bool(
        info["scripts"]["build"]
        and info["scripts"]["test"]
        and tests["code"] == 0
        and counts["passed"] > 0
        and counts["failed"] == 0
        and smoke["ok"]
    )
    if steps:
        outcome = "success" if alive else "build-passing"
        if attempts:
            attempts[-1]["outcome"] = outcome
            run.emit(
                "attempt", n=attempts[-1]["n"], steps=steps,
                titles=attempts[-1]["titles"], status=outcome, stage="verification",
            )
        _tool(
            run,
            "record_attempt",
            project_id=pid,
            run_id=run.id,
            steps=steps,
            outcome="success" if alive else "build-passing",
            error_class="",
            summary="build, tests and HTTP smoke check passed"
            if alive
            else "Build passed; verification is incomplete",
            verification=verification,
        )
        final_pkg = json.loads((ws / "package.json").read_text())
        ranges = {
            **(final_pkg.get("dependencies") or {}),
            **(final_pkg.get("devDependencies") or {}),
        }
        planner.apply_success(pid, steps, ranges)
    status = "alive" if alive else "build-passing"
    client.run(Q.SET_STATUS, {"id": pid, "status": status}, tag="inspect")
    run.preview = site
    after = inspector.inspect(ws)
    run.certificate = {
        "project": project["name"],
        "owner": project.get("owner", ""),
        "run": run.id,
        "source": project.get("source", ""),
        "issued": time.strftime("%Y-%m-%d %H:%M"),
        "before": {d["name"]: d["range"] for d in info["deps"]},
        "after": {d["name"]: d["range"] for d in after["deps"]},
        "steps": [planner._migration(s)["title"] for s in steps],
        "attempts": attempts,
        "tests": counts,
        "verification": verification,
        "smoke": smoke.get("checks", []),
        "status": status,
        "graph": client.status()["detail"],
        "node": run.execution_runtime
        or subprocess.run(
            ["node", "-v"], capture_output=True, text=True
        ).stdout.strip(),
        "agent_mode": next(
            (e["mode"] for e in reversed(run.events) if e["type"] == "agent_mode"),
            run.mode,
        ),
        "decision_trace": [
            e
            for e in run.events
            if e["type"]
            in (
                "decision",
                "tool",
                "cypher",
                "plans",
                "why_chain",
                "dependencies",
                "shared_learning",
                "approval_required",
                "approval_resolved",
            )
        ],
        "verification_scope": "production build, declared tests, HTTP asset smoke checks; no browser interaction test",
        "patch": run.patch,
        "duration": round(time.time() - run.started, 1),
        "preview": f"/preview/{run.id}/" if site else None,
    }
    run.status = status
    run.emit("graph")



# ---------------------------------------------------------------- map for the UI
def project_map(pid: str) -> dict:
    """Assemble the resurrection map for a project straight from FalkorDB."""
    run = RUNS.get(LATEST.get(pid, ""))
    base = client.run(Q.MAP_PROJECT, {"id": pid}, quiet=True)
    if not base:
        return {"nodes": [], "edges": []}
    project, runtime = base[0]["project"], base[0]["runtime"]
    pkgs = client.run(Q.PROJECT_PACKAGES, {"id": pid}, quiet=True)
    retired = client.run(Q.RETIRED_PACKAGES, {"id": pid}, quiet=True)
    blockers = planner.find_blockers(pid)["blockers"]
    attempts = client.run(Q.MAP_ATTEMPTS, {"id": pid}, quiet=True)

    # Migrations relevant to this project: from used packages, runtime moves, and anything attempted.
    mig_rows = client.run(
        "MATCH (p:Project {id: $id})-[:USES|USED]->(pv:PackageVersion)<-[:FROM]-(m:Migration) "
        "OPTIONAL MATCH (m)-[:TO]->(t) RETURN m, pv.id AS from, t.id AS to",
        {"id": pid},
        quiet=True,
    )
    blocked_pkgs = [b["package"] for b in blockers]
    history_blocked = [r["id"] for r in retired if r["incompatible"]]
    if blocked_pkgs or history_blocked:
        mig_rows += client.run(
            "MATCH (m:Migration {kind: 'runtime'})-[:TO]->(rt:Runtime) RETURN m, null AS from, rt.id AS to",
            quiet=True,
        )
    tried_ids = {a["migration"] for a in attempts}
    if tried_ids:
        mig_rows += client.run(
            "MATCH (m:Migration) WHERE m.id IN $ids OPTIONAL MATCH (m)-[:FROM]->(f) OPTIONAL MATCH (m)-[:TO]->(t) "
            "RETURN m, f.id AS from, t.id AS to",
            {"ids": list(tried_ids)},
            quiet=True,
        )
    migs: dict[str, dict] = {}
    for r in mig_rows:
        m = r["m"]
        migs.setdefault(m["id"], {**m, "from": r["from"], "to": r["to"]})

    learned = client.run(Q.LEARNED_CONFLICTS, quiet=True)
    conflicts = client.run(
        "MATCH (p:Project {id: $id})-[:USES|USED]->(a:PackageVersion)-[c:CONFLICTS_WITH]-(b:PackageVersion) "
        "RETURN DISTINCT a.id AS a, b.id AS b, c.learned AS learned, c.reason AS reason",
        {"id": pid},
        quiet=True,
    )

    plans = run.plans if run else []
    infeasible = {}
    for p in plans:
        if not p["feasible"]:
            for s in p["roots"]:
                infeasible.setdefault(s, p["reasons"])
    feasible_steps = {s for p in plans if p["feasible"] for s in p["steps"]}

    state: dict[str, str] = {}
    for a in attempts:
        if a["outcome"] != "success":
            state[a["migration"]] = "failed"
    # A step that failed inside plan A but succeeded in plan B is valid.
    success_steps = {a["migration"] for a in attempts if a["outcome"] == "success"}
    for s in success_steps:
        state[s] = "valid"
    if run and run.status == "running":
        for s in run.active_plan:
            if run.active_step:
                state[s] = "active" if s == run.active_step else "searching"
            else:
                state[s] = "active"

    nodes, edges = [], []
    nodes.append(
        {
            "id": pid,
            "kind": "project",
            "label": project["name"],
            "status": project.get("status", ""),
            "sub": project.get("owner", ""),
        }
    )
    for p in pkgs:
        nodes.append(
            {
                "id": p["id"],
                "kind": "package",
                "label": p["name"],
                "sub": p["range"],
                "major": p["major"],
                "blocked": bool(p["incompatible"]) or p["id"] in blocked_pkgs,
                "reason": p["incompatible"],
            }
        )
        edges.append(
            {"id": f"uses:{p['id']}", "source": pid, "target": p["id"], "kind": "USES"}
        )
    for p in retired:
        nodes.append(
            {
                "id": p["id"],
                "kind": "package",
                "label": p["name"],
                "sub": p["range"],
                "major": p["major"],
                "blocked": bool(p["incompatible"]),
                "retired": True,
                "reason": p["incompatible"],
            }
        )
        edges.append(
            {"id": f"used:{p['id']}", "source": pid, "target": p["id"], "kind": "USED"}
        )
        if p["incompatible"] and p["runtime"]:
            edges.append(
                {
                    "id": f"inc:{p['id']}",
                    "source": p["id"],
                    "target": p["runtime"],
                    "kind": "INCOMPATIBLE_WITH",
                    "reason": p["incompatible"],
                    "healed": True,
                }
            )
    if runtime:
        nodes.append(
            {
                "id": runtime["id"],
                "kind": "runtime",
                "label": f"Node.js {runtime['major']}",
                "sub": "installed" if runtime.get("available") else "missing",
            }
        )
        edges.append(
            {
                "id": f"runs:{runtime['id']}",
                "source": pid,
                "target": runtime["id"],
                "kind": "RUNS_ON",
            }
        )
    for b in blockers:
        if b["kind"] == "runtime":
            edges.append(
                {
                    "id": f"inc:{b['package']}",
                    "source": b["package"],
                    "target": b["against"],
                    "kind": "INCOMPATIBLE_WITH",
                    "reason": b["reason"],
                }
            )
    known = {n["id"] for n in nodes}

    for mid, m in migs.items():
        st = state.get(mid) or (
            "pruned"
            if mid in infeasible
            else ("candidate" if mid in feasible_steps else "unexplored")
        )
        nodes.append(
            {
                "id": mid,
                "kind": "migration",
                "label": m["title"],
                "mkind": m["kind"],
                "cost": m["cost"],
                "risk": m["risk"],
                "why": m["why"],
                "state": st,
                "reasons": infeasible.get(mid, []),
                "recipe": json.loads(m.get("recipe") or "[]"),
            }
        )
        if m["from"]:
            edges.append(
                {
                    "id": f"from:{mid}",
                    "source": m["from"],
                    "target": mid,
                    "kind": "FROM",
                    "state": st,
                }
            )
        if m["to"]:
            if m["to"] not in known:
                to_kind = "runtime-target" if m["to"].startswith("node@") else "target"
                label = (
                    f"Node.js {m['to'].split('@')[1]}"
                    if to_kind == "runtime-target"
                    else m["to"].split("@")[0]
                )
                nodes.append(
                    {
                        "id": m["to"],
                        "kind": to_kind,
                        "label": label,
                        "sub": "v" + m["to"].split("@")[1],
                    }
                )
                known.add(m["to"])
            edges.append(
                {
                    "id": f"to:{mid}",
                    "source": mid,
                    "target": m["to"],
                    "kind": "TO",
                    "state": st,
                }
            )
        elif m["kind"] == "runtime":
            pass
    if runtime and (blocked_pkgs or history_blocked):
        for mid, m in migs.items():
            if m["kind"] == "runtime":
                edges.append(
                    {
                        "id": f"rfrom:{mid}",
                        "source": runtime["id"],
                        "target": mid,
                        "kind": "FROM",
                        "state": state.get(mid)
                        or ("pruned" if mid in infeasible else "unexplored"),
                    }
                )

    # Only conflicts between things that are actually on this map.
    seen_cf: set = set()
    for c in conflicts:
        key = tuple(sorted((c["a"], c["b"])))
        if c["a"] in known and c["b"] in known and key not in seen_cf:
            seen_cf.add(key)
            edges.append(
                {
                    "id": f"cf:{c['a']}:{c['b']}",
                    "source": c["a"],
                    "target": c["b"],
                    "kind": "CONFLICTS_WITH",
                    "learned": bool(c["learned"]),
                    "reason": c["reason"],
                }
            )

    # Derived prerequisites (what resolve_prerequisites found) shown as REQUIRES edges.
    for p in plans:
        if len(p["steps"]) > 1:
            last = p["steps"][-1]
            for pre in p["steps"][:-1]:
                eid = f"req:{last}:{pre}"
                if not any(e["id"] == eid for e in edges):
                    edges.append(
                        {
                            "id": eid,
                            "source": last,
                            "target": pre,
                            "kind": "REQUIRES",
                            "state": state.get(pre, "candidate"),
                        }
                    )

    verification = next(
        (a["verification"] for a in attempts if a["verification"]), None
    )
    if verification:
        nodes.append(
            {
                "id": "verification",
                "kind": "verification",
                "label": "Heartbeat",
                "sub": f"{verification.get('tests_passed', 0)} tests · smoke {'ok' if verification.get('smoke') else '✕'}",
            }
        )
        for s in success_steps:
            if any(e["source"] == s and e["kind"] == "TO" for e in edges):
                tgt = next(
                    e["target"] for e in edges if e["source"] == s and e["kind"] == "TO"
                )
                edges.append(
                    {
                        "id": f"ver:{s}",
                        "source": tgt,
                        "target": "verification",
                        "kind": "PRODUCED",
                        "state": "valid",
                    }
                )
            else:
                edges.append(
                    {
                        "id": f"ver:{s}",
                        "source": s,
                        "target": "verification",
                        "kind": "PRODUCED",
                        "state": "valid",
                    }
                )

    att_summary = []
    seen: dict[str, dict] = {}
    for a in attempts:
        if a["attempt"] not in seen:
            seen[a["attempt"]] = {
                "id": a["attempt"],
                "outcome": a["outcome"],
                "plan": a["plan"],
                "summary": a["summary"],
                "error_class": a["error_class"],
                "steps": [],
            }
            att_summary.append(seen[a["attempt"]])
        seen[a["attempt"]]["steps"].append(a["migration"])
    for i, a in enumerate(att_summary):
        nodes.append(
            {
                "id": a["id"],
                "kind": "attempt",
                "label": f"Attempt {i + 1}",
                "outcome": a["outcome"],
                "sub": a["summary"],
                "error_class": a["error_class"],
            }
        )
        for s in a["steps"]:
            edges.append(
                {
                    "id": f"tried:{a['id']}:{s}",
                    "source": s,
                    "target": a["id"],
                    "kind": "TRIED",
                    "state": "valid" if a["outcome"] == "success" else "failed",
                }
            )
    return {
        "project": project,
        "runtime": runtime,
        "nodes": nodes,
        "edges": edges,
        "attempts": att_summary,
        "learned": learned,
        "plans": plans,
        "run": run.to_dict() if run else None,
    }
