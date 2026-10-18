"""Run-scoped capabilities shared by deterministic and MCP/Claude controllers."""

from __future__ import annotations
import hashlib
import json
import os
import threading
import time
from pathlib import Path
from ..graph import client, planner, queries as Q, dependencies
from ..recovery import executor, inspector, verifier


class RecoverySession:
    def __init__(self, run):
        from . import orchestrator as o

        self.o = o
        self.run = run
        self.pid = run.project_id
        self.project = o.get_project(self.pid)
        if not self.project:
            raise ValueError("Unknown project")
        self.source = o.project_dir(self.project)
        if (
            self.project["source"].startswith("git:")
            and os.getenv("RESPAWN_SANDBOX", "local") != "docker"
        ):
            raise ValueError(
                "Cloned repositories require RESPAWN_SANDBOX=docker before running their scripts"
            )
        self.directory = o.DATA / "runs" / run.id
        self.directory.mkdir(parents=True, exist_ok=True)
        self.info = inspector.inspect(self.source)
        rows = client.run(
            "MATCH (:Project {id:$id})-[:RUNS_ON]->(r:Runtime) RETURN r",
            {"id": self.pid},
            tag="inspect",
        )
        self.runtime = rows[0]["r"] if rows else {"major": 22, "id": "node@22"}
        self.diagnosed = False
        self.attempts = []
        self.signatures = []
        self.lock = threading.Lock()

    def dispatch(self, name: str, args: dict) -> dict:
        if not self.lock.acquire(blocking=False):
            raise ValueError("A tool is already running for this run")
        try:
            if self.run.status not in ("running", "awaiting_approval"):
                return {"terminal": True, "status": self.run.status}
            methods = {
                "diagnose_project": self.diagnose,
                "execute_plan": self.execute,
                "find_blockers": lambda: planner.find_blockers(self.pid),
                "rank_blockers": lambda: dependencies.rank_blockers(self.pid),
                "trace_dependency_chain": lambda: dependencies.why_chains(self.pid),
                "get_migration_options": lambda package: planner.get_migration_options(
                    self.pid, package
                ),
                "resolve_prerequisites": lambda migration_id: (
                    planner.resolve_prerequisites(self.pid, migration_id)
                ),
                "rank_recovery_plans": self.rank,
                "find_alternative": lambda failed_plan: self.rank(failed_plan),
            }
            if name not in methods:
                raise ValueError("Unknown or unauthorized capability")
            if not self.diagnosed and name != "diagnose_project":
                raise ValueError("Run diagnose_project first")
            self.run.emit(
                "tool",
                tool=name,
                args=args,
                status="start",
                description="Run-scoped graph and recovery capability",
            )
            result = methods[name](**args)
            self.run.emit("tool", tool=name, args=args, status="done", result=result)
            if result.get("terminal"):
                self.run.emit("done",status=self.run.status,certificate=self.run.certificate)
            return result
        finally:
            self.lock.release()

    def diagnose(self) -> dict:
        if self.diagnosed:
            return {"diagnosed": True, "status": self.run.status}
        o, r = self.o, self.run
        o._phase(r, "diagnose", "Diagnosing")
        o._say(r, f"Inspecting {self.project['name']} and running its original build.")
        client.run(
            Q.SET_STATUS, {"id": self.pid, "status": "diagnosing"}, tag="inspect"
        )
        baseline = executor.fresh_workspace(self.source, self.directory / "baseline")
        sink = o._sink(r, "baseline")
        installed = executor.install(baseline, sink, node_major=self.runtime["major"])
        self.run.emit("dependencies", **dependencies.import_lock(self.pid, baseline))
        result = (
            executor.build(baseline, sink, node_major=self.runtime["major"])
            if installed["code"] == 0 and self.info["scripts"]["build"]
            else installed
        )
        self.diagnosed = True
        self.signatures = client.run(
            "MATCH (p:Project {id:$id})-[:USES]->(pv:PackageVersion)-[i:INCOMPATIBLE_WITH]->(rt:Runtime)<-[:RUNS_ON]-(p) RETURN pv.id AS package,rt.id AS runtime,i.signature AS signature,i.reason AS reason",
            {"id": self.pid},
            tag="classify",
        )
        if result["code"] == 0 and self.info["scripts"]["build"]:
            r.emit("diagnosis", alive=True, step="build", code=0)
            tests = (
                executor.test(baseline, sink, node_major=self.runtime["major"])
                if self.info["scripts"]["test"]
                else {"code": 0, "output": ""}
            )
            r.workspace = baseline
            o._finish(
                r,
                self.pid,
                self.project,
                self.info,
                baseline,
                self.source,
                [],
                tests,
                [],
            )
            return {"terminal": True, "status": r.status}
        failure = verifier.classify(result["output"], self.signatures)
        r.emit(
            "diagnosis",
            alive=False,
            step="install" if installed["code"] else "build",
            code=result["code"],
            error=failure,
            excerpt=o._excerpt(result["output"], failure.get("match", "")),
        )
        client.run(Q.SET_STATUS, {"id": self.pid, "status": "dead"}, tag="diagnose")
        o._phase(r, "discover", "Searching the graph")
        chains = dependencies.why_chains(self.pid)
        r.emit("why_chain", **chains)
        return {
            "failure": failure,
            "why_chains": chains,
            "build_script": self.info["scripts"]["build"],
        }

    def rank(self, failed_plan: str = "") -> dict:
        result = (
            planner.find_alternative(self.pid, failed_plan)
            if failed_plan
            else planner.rank_recovery_plans(self.pid)
        )
        r = self.run
        r.plans = result["plans"]
        r.emit(
            "plans",
            plans=result["plans"],
            chosen=result["chosen"]["id"] if result["chosen"] else None,
            planning=result["planning"],
        )
        r.emit("graph")
        for plan in result["plans"]:
            for fact in plan.get("shared_learning", []):
                if fact.get("source_project") and fact["source_project"] != self.pid:
                    r.emit("shared_learning", **fact)
        return result

    def await_approval(self, plan: dict) -> bool:
        r = self.run
        recipes = [planner._migration(s)["recipe"] for s in plan["steps"]]
        digest = hashlib.sha256(
            json.dumps([r.id, plan["id"], recipes], sort_keys=True).encode()
        ).hexdigest()
        with r.cond:
            r.pending_approval = {
                "id": digest,
                "plan": plan["id"],
                "titles": plan["titles"],
                "recipes": recipes,
                "risk": "Runtime downgrade, workaround, or high-risk migration",
                "expires_at": time.time() + 600,
            }
            r.approval_decision = None
            r.status = "awaiting_approval"
            r.emit("approval_required", **r.pending_approval)
            deadline = time.monotonic() + 600
            while r.approval_decision is None and time.monotonic() < deadline:
                r.cond.wait(timeout=min(5, max(0, deadline - time.monotonic())))
            approved = r.approval_decision is True
            self.approved_recipes = recipes if approved else None
            r.emit("approval_resolved", approval_id=digest, approved=approved)
            r.pending_approval = None
            r.status = "running"
            return approved

    def execute(self, plan_id: str) -> dict:
        o, r = self.o, self.run
        if len(self.attempts) >= o.MAX_ATTEMPTS:
            raise ValueError("Recovery attempt limit reached")
        ranked = self.rank()
        plan = next(
            (p for p in ranked["plans"] if p["id"] == plan_id and p["feasible"]), None
        )
        if not plan:
            raise ValueError(
                "Plan is no longer feasible; ask the graph for another route"
            )
        if not ranked["chosen"] or ranked["chosen"]["id"] != plan_id:
            raise ValueError("Only the graph-selected minimum-cost plan may execute")
        if plan.get("approval_required"):
            if not self.await_approval(plan):
                planner.record_attempt(
                    self.pid,
                    r.id,
                    plan["steps"],
                    "failed",
                    "approval_denied",
                    "User declined or approval expired",
                )
                return {
                    "outcome": "rejected",
                    "reason": "approval denied",
                    "failed_plan": plan_id,
                }
            refreshed = self.rank()
            current = next(
                (p for p in refreshed["plans"] if p["id"] == plan_id and p["feasible"]),
                None,
            )
            if (
                not current
                or not refreshed["chosen"]
                or refreshed["chosen"]["id"] != plan_id
                or current["steps"] != plan["steps"]
                or [planner._migration(s)["recipe"] for s in plan["steps"]]
                != self.approved_recipes
            ):
                raise ValueError(
                    "Graph facts or recipes changed during approval. Replan required."
                )
        n = len(self.attempts) + 1
        o._phase(r, "repair", "Attempting resurrection")
        r.active_plan = plan["steps"]
        r.emit(
            "attempt",
            n=n,
            steps=plan["steps"],
            titles=plan["titles"],
            status="running",
            cost=plan["cost"],
        )
        ws = executor.fresh_workspace(self.source, self.directory / f"attempt-{n}")
        runtime_override = None
        for step in plan["steps"]:
            r.active_step = step
            r.emit("graph")
            m = planner._migration(step)
            out = executor.apply_recipe(ws, m["recipe"])
            runtime_override = out["runtime"] or runtime_override
            r.emit("applied", migration=step, title=m["title"], recipe=m["recipe"])
        r.active_step = None
        rt = o._runtime_for(runtime_override) if runtime_override else self.runtime
        node_path = rt.get("path") or None
        node_major = runtime_override or self.runtime["major"]
        r.execution_runtime = str(node_major)
        sink = o._sink(r, f"attempt-{n}")
        result = executor.install(ws, sink, node_path=node_path, node_major=node_major)
        stage = "install"
        if result["code"] == 0 and self.info["scripts"]["build"]:
            stage = "build"
            result = executor.build(
                ws, sink, node_path=node_path, node_major=node_major
            )
        tests = {"code": 0, "output": ""}
        if result["code"] == 0 and self.info["scripts"]["test"]:
            stage = "test"
            tests = executor.test(ws, sink, node_path=node_path, node_major=node_major)
            if tests["code"] != 0:
                result = tests
        patch = executor.diff(self.source, ws)
        r.emit("patch", n=n, diff=patch)
        if result["code"] == 0 and self.info["scripts"]["build"]:
            r.patch = patch
            r.workspace = ws
            self.attempts.append(
                {
                    "n": n,
                    "steps": plan["steps"],
                    "titles": plan["titles"],
                    "outcome": "build-passing",
                }
            )
            o._finish(
                r,
                self.pid,
                self.project,
                self.info,
                ws,
                self.source,
                plan["steps"],
                tests,
                self.attempts,
            )
            return {"terminal": True, "status": r.status, "certificate": r.certificate}
        failure = verifier.classify(result["output"], self.signatures)
        self.attempts.append(
            {
                "n": n,
                "steps": plan["steps"],
                "titles": plan["titles"],
                "outcome": "failed",
                "error": failure["summary"],
                "stage": stage,
            }
        )
        r.emit(
            "attempt",
            n=n,
            steps=plan["steps"],
            status="failed",
            stage=stage,
            error=failure,
            excerpt=o._excerpt(result["output"], failure.get("match", "")),
        )
        planner.record_attempt(
            self.pid,
            r.id,
            plan["steps"],
            "failed",
            failure["class"],
            failure["summary"],
        )
        if (
            failure["class"] == "peer_conflict"
            and failure.get("owner")
            and failure.get("target")
        ):
            learned = planner.learn_conflict(
                failure["owner"],
                failure["target"],
                failure["summary"],
                failure.get("match", ""),
                self.pid,
                r.id,
            )
            r.emit("learned", **learned)
        r.active_plan = []
        o._phase(r, "discover", "Replanning")
        return {"outcome": "failed", "failed_plan": plan_id, "failure": failure}

    def fallback(self):
        if not self.diagnosed:
            self.dispatch("diagnose_project", {})
        while self.run.status == "running" and len(self.attempts) < self.o.MAX_ATTEMPTS:
            ranked = self.dispatch("rank_recovery_plans", {})
            if not ranked["chosen"]:
                break
            self.dispatch("execute_plan", {"plan_id": ranked["chosen"]["id"]})
        if self.run.status == "running":
            self.run.status = "dead"
            self.run.emit(
                "done", status="dead", reason="No further feasible recovery route"
            )
