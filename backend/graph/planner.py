"""Graph-backed agent tools. FalkorDB decides what is feasible; nothing here is hard-coded
to the demo project.

find_blockers -> get_migration_options -> resolve_prerequisites -> rank_recovery_plans
record_attempt / learn_conflict -> find_alternative
"""

from __future__ import annotations

import json
import contextvars
from contextlib import contextmanager
import uuid
from typing import Optional

from . import client, queries as Q, paths, dependencies
from .model import artifact_id

_overrides = contextvars.ContextVar("plan_overrides", default={})

RISK_WEIGHT = {"low": 0.0, "medium": 1.0, "high": 1.5}


# ---------------------------------------------------------------- tools
def find_blockers(project_id: str) -> dict:
    runtime = client.run(
        Q.FIND_RUNTIME_BLOCKERS, {"id": project_id}, tag="find_blockers"
    )
    conflicts = client.run(
        Q.FIND_CONFLICT_BLOCKERS, {"id": project_id}, tag="find_blockers"
    )
    blockers = [
        {
            "package": r["package"],
            "kind": "runtime",
            "against": r["runtime"],
            "reason": r["reason"],
            "signature": r["signature"],
        }
        for r in runtime
    ] + [
        {
            "package": r["package"],
            "kind": "conflict",
            "against": r["other"],
            "reason": r["reason"],
            "signature": "",
        }
        for r in conflicts
    ]
    degree = dependencies.rank_blockers(project_id)
    scores = {r["package"]: r["dependents"] for r in degree["ranking"]}
    for blocker in blockers:
        blocker["priority_score"] = scores.get(blocker["package"], 0)
    blockers.sort(key=lambda b: -b["priority_score"])
    return {"blockers": blockers, "ranking_algorithm": degree["algorithm"]}


def get_migration_options(project_id: str, package: str) -> dict:
    package = artifact_id(package)
    code = client.run(
        Q.PACKAGE_MIGRATIONS,
        {"id": project_id, "package": package},
        tag="get_migration_options",
    )
    runtime = client.run(
        Q.RUNTIME_MIGRATIONS,
        {"id": project_id, "package": package},
        tag="get_migration_options",
    )
    return {"package": package, "options": code + runtime}


def _migration(mid: str) -> dict:
    rows = client.run(Q.MIGRATION, {"mid": mid}, quiet=True)
    if not rows:
        raise KeyError(mid)
    m = dict(rows[0]["m"])
    m["target"] = rows[0]["target"]
    m["target_eol"] = bool(rows[0].get("target_eol"))
    m["target_kind"] = rows[0].get("target_kind")
    m["target_name"] = rows[0].get("target_name")
    m["recipe"] = json.loads(m.get("recipe") or "[]")
    return m


def resolve_prerequisites(
    project_id: str, migration_id: str, _seen: Optional[set] = None
) -> dict:
    with client.capture_queries() as evidence:
        result = _resolve_prerequisites(project_id, migration_id, _seen)
    return {**result, "evidence": evidence}


def _resolve_prerequisites(
    project_id: str, migration_id: str, _seen: Optional[set] = None
) -> dict:
    """Returns ordered prerequisite migrations and any reason the migration cannot run."""
    seen = _seen or set()
    seen.add(migration_id)
    m = _migration(migration_id)
    problems: list[str] = []
    order: list[str] = []
    notes: list[dict] = []

    explicit = client.run(
        Q.EXPLICIT_PREREQS, {"mid": migration_id}, tag="resolve_prerequisites"
    )
    for row in explicit:
        if row["id"] not in seen:
            sub = resolve_prerequisites(project_id, row["id"], seen)
            problems += sub["problems"]
            order += [x for x in sub["order"] if x not in order]
            if row["id"] not in order:
                order.append(row["id"])

    conflicts = client.run(
        Q.TARGET_CONFLICTS,
        {"mid": migration_id, "id": project_id},
        tag="resolve_prerequisites",
    )
    for c in conflicts:
        fixes = [f for f in c["fixes"] if f and f not in seen]
        notes.append(
            {
                "blocked_by": c["blocked_by"],
                "reason": c["reason"],
                "learned": bool(c["learned"]),
                "fixes": fixes,
                "source_project": c.get("source_project"),
                "source_run": c.get("source_run"),
            }
        )
        if not fixes:
            problems.append(
                f"{m['target']} conflicts with {c['blocked_by']} and the graph knows no fix"
            )
            continue
        best = None
        for fix in sorted(fixes, key=lambda f: _migration(f)["cost"]):
            sub = resolve_prerequisites(project_id, fix, set(seen))
            if not sub["problems"]:
                best = (fix, sub)
                break
        if best is None:
            problems.append(f"every fix for {c['blocked_by']} is blocked")
            continue
        fix, sub = best
        order += [x for x in sub["order"] if x not in order]
        if fix not in order:
            order.append(fix)

    if m["kind"] == "runtime":
        rt = client.run(
            "MATCH (rt:Environment {id: $rid}) RETURN rt.available AS available, rt.eol AS eol",
            {"rid": m["target"]},
            tag="resolve_prerequisites",
        )
        available = (
            _overrides.get()
            .get("runtime_available", {})
            .get(m["target"], bool(rt and rt[0]["available"]))
        )
        if not available:
            problems.append(f"{m['target']} is not installed on this machine")
    else:
        still = client.run(
            Q.TARGET_STILL_INCOMPATIBLE,
            {"mid": migration_id, "id": project_id},
            tag="resolve_prerequisites",
        )
        for s in still:
            problems.append(f"{s['target']} is also incompatible with this runtime")

    return {
        "migration": migration_id,
        "order": order,
        "problems": problems,
        "conflicts": notes,
    }


def _policy() -> dict:
    rows = client.run(Q.POLICY, tag="rank_recovery_plans")
    policy = dict(rows[0]) if rows else {"allow_workarounds": False, "eol_penalty": 3}
    if "allow_workarounds" in _overrides.get():
        policy["allow_workarounds"] = _overrides.get()["allow_workarounds"]
    return policy


def plan_signature(steps: list[str]) -> str:
    return "+".join(sorted(steps))


def rank_recovery_plans(project_id: str) -> dict:
    """Enumerate candidate plans for every blocker, mark infeasible ones, and rank the rest."""
    blockers = find_blockers(project_id)["blockers"]
    policy = _policy()
    failed = {
        r["plan"]: r
        for r in client.run(
            Q.FAILED_PLANS, {"id": project_id}, tag="rank_recovery_plans"
        )
    }

    per_blocker: list[list[dict]] = []
    for b in blockers:
        options = get_migration_options(project_id, b["package"])["options"]
        candidates = []
        for opt in options:
            pre = resolve_prerequisites(project_id, opt["id"])
            steps = pre["order"] + [opt["id"]]
            mig = {s: _migration(s) for s in steps}
            cost = sum(
                mig[s]["cost"] + RISK_WEIGHT.get(mig[s]["risk"], 0) for s in steps
            )
            reasons = list(pre["problems"])
            if opt["kind"] == "workaround" and not policy.get("allow_workarounds"):
                reasons.append("policy blocks high-risk workarounds")
            if opt["kind"] == "runtime" and opt.get("eol"):
                cost += policy.get("eol_penalty") or 0
            candidates.append(
                {
                    "blocker": b["package"],
                    "root": opt["id"],
                    "steps": steps,
                    "cost": round(cost, 2),
                    "reasons": reasons,
                    "conflicts": pre["conflicts"],
                    "evidence": pre["evidence"],
                    "titles": [mig[s]["title"] for s in steps],
                    "kinds": [mig[s]["kind"] for s in steps],
                }
            )
        per_blocker.append(candidates)

    # Combine: one candidate per blocker, deduplicating shared steps (small graphs -> brute force ok).
    combos: list[list[dict]] = [[]]
    for cands in per_blocker:
        combos = [c + [x] for c in combos for x in cands][:64]
    plans = []
    for combo in combos:
        if not combo:
            continue
        steps: list[str] = []
        for c in combo:
            steps += [s for s in c["steps"] if s not in steps]
        sig = plan_signature(steps)
        reasons = [r for c in combo for r in c["reasons"]]
        if sig in failed:
            reasons.append(f"already failed: {failed[sig]['summary']}")
        titles = []
        for c in combo:
            titles += [t for t in c["titles"] if t not in titles]
        plans.append(
            {
                "id": sig,
                "steps": steps,
                "titles": titles,
                "cost": round(sum(c["cost"] for c in combo), 2),
                "feasible": not reasons,
                "reasons": reasons,
                "roots": [c["root"] for c in combo],
                "kinds": [k for c in combo for k in c["kinds"]],
                "evidence": [e for c in combo for e in c["evidence"]]
                + [
                    {"query": Q.POLICY, "params": {}, "result": [policy]},
                    {
                        "query": Q.FAILED_PLANS,
                        "params": {"id": project_id},
                        "result": list(failed.values()),
                    },
                ],
                "shared_learning": [
                    fact
                    for c in combo
                    for fact in c["conflicts"]
                    if fact.get("learned")
                ],
            }
        )
    uniq = {}
    for p in plans:
        uniq.setdefault(p["id"], p)
    candidates = list(uniq.values())
    migrations = {step: _migration(step) for p in candidates for step in p["steps"]}
    for p in candidates:
        p["cost"] = round(
            sum(
                migrations[s]["cost"]
                + RISK_WEIGHT.get(migrations[s]["risk"], 0)
                + (
                    policy.get("eol_penalty", 0)
                    if migrations[s]["kind"] == "runtime"
                    and migrations[s].get("target_eol")
                    else 0
                )
                for s in p["steps"]
            ),
            2,
        )
        p["approval_required"] = any(
            migrations[s]["kind"] in ("runtime", "workaround")
            or migrations[s]["risk"] == "high"
            for s in p["steps"]
        )
    selection = paths.choose(project_id, candidates, migrations, policy)
    ranked = sorted(
        candidates,
        key=lambda p: (p != selection["chosen"], not p["feasible"], p["cost"]),
    )
    return {
        "blockers": blockers,
        "plans": ranked,
        "policy": policy,
        "chosen": selection["chosen"],
        "planning": {k: v for k, v in selection.items() if k != "chosen"},
        "hypothetical": bool(_overrides.get()),
        "overrides": _overrides.get(),
    }


def what_if(project_id: str, overrides: dict) -> dict:
    """Evaluate a counterfactual without editing runtime, policy, or learned graph facts."""
    allowed = {
        k: v
        for k, v in overrides.items()
        if k in ("allow_workarounds", "runtime_available")
    }
    token = _overrides.set(allowed)
    try:
        return rank_recovery_plans(project_id)
    finally:
        _overrides.reset(token)


def find_alternative(project_id: str, failed_plan: str) -> dict:
    ranked = rank_recovery_plans(project_id)
    # Failed plans are removed by FAILED_PLANS before the database computes the path.
    if ranked["chosen"] and ranked["chosen"]["id"] == failed_plan:
        return {**ranked, "chosen": None}
    return ranked


def record_attempt(
    project_id: str,
    run_id: str,
    steps: list[str],
    outcome: str,
    error_class: str = "",
    summary: str = "",
    verification: Optional[dict] = None,
) -> dict:
    aid = f"att:{uuid.uuid4().hex[:8]}"
    client.run(
        Q.RECORD_ATTEMPT,
        {
            "id": project_id,
            "aid": aid,
            "run": run_id,
            "plan": plan_signature(steps),
            "outcome": outcome,
            "error_class": error_class,
            "summary": summary[:300],
            "steps": steps,
        },
        tag="record_attempt",
    )
    if verification:
        client.run(
            Q.RECORD_VERIFICATION,
            {"aid": aid, "vid": f"ver:{uuid.uuid4().hex[:8]}", **verification},
            tag="record_attempt",
        )
    return {"attempt": aid, "plan": plan_signature(steps), "outcome": outcome}


def learn_conflict(
    a: str,
    b: str,
    reason: str,
    evidence: str,
    source_project: str = "",
    run_id: str = "",
) -> dict:
    a, b = artifact_id(a), artifact_id(b)
    rows = client.run(
        Q.LEARN_CONFLICT,
        {
            "a": a,
            "b": b,
            "reason": reason,
            "evidence": evidence[:400],
            "source_project": source_project,
            "run_id": run_id,
        },
        tag="learn_conflict",
    )
    return {
        "learned": bool(rows),
        "a": a,
        "b": b,
        "reason": reason,
        "source_project": source_project,
        "run_id": run_id,
    }


def apply_success(
    project_id: str, steps: list[str], ranges: dict[str, str], artifacts=None
) -> None:
    for s in steps:
        m = _migration(s)
        if m.get("target") and "@" in m["target"] and not m.get("target_kind"):
            name = (
                m.get("target_name") or m["target"].split(":", 1)[-1].rsplit("@", 1)[0]
            )
            client.run(
                Q.APPLY_MIGRATION_TO_PROJECT,
                {"id": project_id, "mid": s, "range": ranges.get(name, "")},
                tag="apply_success",
            )
        if m["kind"] == "runtime":
            client.run(
                "MATCH (p:Project {id: $id})-[r:RUNS_ON]->() DELETE r",
                {"id": project_id},
                tag="apply_success",
            )
            client.run(
                Q.LINK_RUNTIME,
                {"id": project_id, "runtime": m["target"]},
                tag="apply_success",
            )

    if artifacts is not None:
        client.run(
            "MATCH (p:Project {id:$id})-[u:USES]->(a:Artifact) WHERE NOT a.id IN $current MERGE (p)-[old:USED]->(a) SET old.range=u.range,old.source=u.source DELETE u",
            {"id": project_id, "current": [a["id"] for a in artifacts]},
            tag="apply_success",
        )
        client.run(
            Q.LINK_PACKAGES, {"id": project_id, "deps": artifacts}, tag="apply_success"
        )
