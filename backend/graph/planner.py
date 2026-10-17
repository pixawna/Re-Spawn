"""Graph-backed agent tools. FalkorDB decides what is feasible; nothing here is hard-coded
to the demo project.

find_blockers -> get_migration_options -> resolve_prerequisites -> rank_recovery_plans
record_attempt / learn_conflict -> find_alternative
"""
from __future__ import annotations

import json
import uuid
from typing import Optional

from . import client, queries as Q

RISK_WEIGHT = {"low": 0.0, "medium": 1.0, "high": 1.5}


# ---------------------------------------------------------------- tools
def find_blockers(project_id: str) -> dict:
    runtime = client.run(Q.FIND_RUNTIME_BLOCKERS, {"id": project_id}, tag="find_blockers")
    conflicts = client.run(Q.FIND_CONFLICT_BLOCKERS, {"id": project_id}, tag="find_blockers")
    blockers = [
        {"package": r["package"], "kind": "runtime", "against": r["runtime"], "reason": r["reason"],
         "signature": r["signature"]}
        for r in runtime
    ] + [
        {"package": r["package"], "kind": "conflict", "against": r["other"], "reason": r["reason"], "signature": ""}
        for r in conflicts
    ]
    return {"blockers": blockers}


def get_migration_options(project_id: str, package: str) -> dict:
    code = client.run(Q.PACKAGE_MIGRATIONS, {"package": package}, tag="get_migration_options")
    runtime = client.run(Q.RUNTIME_MIGRATIONS, {"package": package}, tag="get_migration_options")
    return {"package": package, "options": code + runtime}


def _migration(mid: str) -> dict:
    rows = client.run(Q.MIGRATION, {"mid": mid}, quiet=True)
    if not rows:
        raise KeyError(mid)
    m = dict(rows[0]["m"])
    m["target"] = rows[0]["target"]
    m["recipe"] = json.loads(m.get("recipe") or "[]")
    return m


def resolve_prerequisites(project_id: str, migration_id: str, _seen: Optional[set] = None) -> dict:
    """Returns ordered prerequisite migrations and any reason the migration cannot run."""
    seen = _seen or set()
    seen.add(migration_id)
    m = _migration(migration_id)
    problems: list[str] = []
    order: list[str] = []
    notes: list[dict] = []

    explicit = client.run(Q.EXPLICIT_PREREQS, {"mid": migration_id}, tag="resolve_prerequisites")
    for row in explicit:
        if row["id"] not in seen:
            sub = resolve_prerequisites(project_id, row["id"], seen)
            problems += sub["problems"]
            order += [x for x in sub["order"] if x not in order]
            if row["id"] not in order:
                order.append(row["id"])

    conflicts = client.run(Q.TARGET_CONFLICTS, {"mid": migration_id, "id": project_id}, tag="resolve_prerequisites")
    for c in conflicts:
        fixes = [f for f in c["fixes"] if f and f not in seen]
        notes.append({"blocked_by": c["blocked_by"], "reason": c["reason"], "learned": bool(c["learned"]),
                      "fixes": fixes})
        if not fixes:
            problems.append(f"{m['target']} conflicts with {c['blocked_by']} and the graph knows no fix")
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
        rt = client.run("MATCH (rt:Runtime {id: $rid}) RETURN rt.available AS available, rt.eol AS eol",
                        {"rid": m["target"]}, tag="resolve_prerequisites")
        if rt and not rt[0]["available"]:
            problems.append(f"{m['target']} is not installed on this machine")
    else:
        still = client.run(Q.TARGET_STILL_INCOMPATIBLE, {"mid": migration_id, "id": project_id},
                           tag="resolve_prerequisites")
        for s in still:
            problems.append(f"{s['target']} is also incompatible with this runtime")

    return {"migration": migration_id, "order": order, "problems": problems, "conflicts": notes}


def _policy() -> dict:
    rows = client.run(Q.POLICY, tag="rank_recovery_plans")
    return rows[0] if rows else {"allow_workarounds": False, "eol_penalty": 3}


def plan_signature(steps: list[str]) -> str:
    return "+".join(sorted(steps))


def rank_recovery_plans(project_id: str) -> dict:
    """Enumerate candidate plans for every blocker, mark infeasible ones, and rank the rest."""
    blockers = find_blockers(project_id)["blockers"]
    policy = _policy()
    failed = {r["plan"]: r for r in client.run(Q.FAILED_PLANS, {"id": project_id}, tag="rank_recovery_plans")}

    per_blocker: list[list[dict]] = []
    for b in blockers:
        options = get_migration_options(project_id, b["package"])["options"]
        candidates = []
        for opt in options:
            pre = resolve_prerequisites(project_id, opt["id"])
            steps = pre["order"] + [opt["id"]]
            mig = {s: _migration(s) for s in steps}
            cost = sum(mig[s]["cost"] + RISK_WEIGHT.get(mig[s]["risk"], 0) for s in steps)
            reasons = list(pre["problems"])
            if opt["kind"] == "workaround" and not policy.get("allow_workarounds"):
                reasons.append("policy blocks high-risk workarounds")
            if opt["kind"] == "runtime" and opt.get("eol"):
                cost += policy.get("eol_penalty") or 0
            candidates.append({
                "blocker": b["package"], "root": opt["id"], "steps": steps, "cost": round(cost, 2),
                "reasons": reasons, "conflicts": pre["conflicts"],
                "titles": [mig[s]["title"] for s in steps], "kinds": [mig[s]["kind"] for s in steps],
            })
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
        plans.append({
            "id": sig, "steps": steps, "titles": titles, "cost": round(sum(c["cost"] for c in combo), 2),
            "feasible": not reasons, "reasons": reasons, "roots": [c["root"] for c in combo],
            "kinds": [k for c in combo for k in c["kinds"]],
        })
    uniq = {}
    for p in plans:
        uniq.setdefault(p["id"], p)
    ranked = sorted(uniq.values(), key=lambda p: (not p["feasible"], p["cost"], len(p["steps"])))
    return {"blockers": blockers, "plans": ranked, "policy": policy,
            "chosen": next((p for p in ranked if p["feasible"]), None)}


def find_alternative(project_id: str, failed_plan: str) -> dict:
    ranked = rank_recovery_plans(project_id)
    alt = next((p for p in ranked["plans"] if p["feasible"] and p["id"] != failed_plan), None)
    return {**ranked, "chosen": alt}


def record_attempt(project_id: str, run_id: str, steps: list[str], outcome: str, error_class: str = "",
                   summary: str = "", verification: Optional[dict] = None) -> dict:
    aid = f"att:{uuid.uuid4().hex[:8]}"
    client.run(Q.RECORD_ATTEMPT, {
        "id": project_id, "aid": aid, "run": run_id, "plan": plan_signature(steps), "outcome": outcome,
        "error_class": error_class, "summary": summary[:300], "steps": steps,
    }, tag="record_attempt")
    if verification:
        client.run(Q.RECORD_VERIFICATION, {"aid": aid, "vid": f"ver:{uuid.uuid4().hex[:8]}", **verification},
                   tag="record_attempt")
    return {"attempt": aid, "plan": plan_signature(steps), "outcome": outcome}


def learn_conflict(a: str, b: str, reason: str, evidence: str) -> dict:
    rows = client.run(Q.LEARN_CONFLICT, {"a": a, "b": b, "reason": reason, "evidence": evidence[:400]},
                      tag="learn_conflict")
    return {"learned": bool(rows), "a": a, "b": b, "reason": reason}


def apply_success(project_id: str, steps: list[str], ranges: dict[str, str]) -> None:
    for s in steps:
        m = _migration(s)
        if m.get("target") and "@" in m["target"] and not m["target"].startswith("node@"):
            name = m["target"].split("@")[0]
            client.run(Q.APPLY_MIGRATION_TO_PROJECT, {"id": project_id, "mid": s, "range": ranges.get(name, "")},
                       tag="apply_success")
        if m["kind"] == "runtime":
            client.run("MATCH (p:Project {id: $id})-[r:RUNS_ON]->() DELETE r", {"id": project_id}, tag="apply_success")
            client.run(Q.LINK_RUNTIME, {"id": project_id, "runtime": m["target"]}, tag="apply_success")
