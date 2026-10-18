"""Re:Spawn API. Run with:  uvicorn backend.main:app --reload --port 8000"""

from __future__ import annotations

import asyncio
import json
import mimetypes
import re
import os
import threading
import time
from typing import Literal
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse
from pydantic import BaseModel

from .config import agent_config
from .agent import orchestrator as orch
from .graph import client, queries as Q, schema, seeds, planner, dependencies
from .graph.ask import ask
from . import pull_requests

EXAMPLE_PROJECTS = [
    {
        "id": "legacy-todo-app",
        "name": "legacy-todo-app",
        "owner": "respawn-examples",
        "source": "example:legacy-todo-app",
    },
    {
        "id": "legacy-kanban-app",
        "name": "legacy-kanban-app",
        "owner": "respawn-examples",
        "source": "example:legacy-kanban-app",
    },
]


def _bootstrap() -> dict:
    info = schema.init()
    runtime = f"node@{schema.current_node_major()}"
    for ex in EXAMPLE_PROJECTS:
        if not orch.get_project(ex["id"]):
            orch.register_project(
                ex["id"],
                ex["name"],
                ex["source"],
                ex["owner"],
                orch.EXAMPLES / ex["source"].split(":", 1)[1],
                runtime,
            )
    return info


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _app.state.boot = _bootstrap()
    yield


app = FastAPI(title="Re:Spawn", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    stats = {r["label"]: r["c"] for r in client.run(Q.STATS, quiet=True)}
    runtimes = client.run(
        "MATCH (r:Runtime) RETURN r.id AS id, r.available AS available, r.eol AS eol ORDER BY r.major",
        quiet=True,
    )
    return {
        "ok": True,
        "graph": client.status(),
        "stats": stats,
        "runtimes": runtimes,
        "agent": agent_config(),
        "github_available": bool(os.getenv("GITHUB_TOKEN")),
    }


@app.get("/api/projects")
def projects():
    rows = client.run(Q.LIST_PROJECTS, quiet=True)
    out = []
    for r in rows:
        p = r["project"]
        rid = orch.LATEST.get(p["id"])
        run = orch.RUNS.get(rid) if rid else None
        pkgs = client.run(Q.PROJECT_PACKAGES, {"id": p["id"]}, quiet=True)
        out.append(
            {
                "id": p["id"],
                "name": p["name"],
                "owner": p.get("owner", ""),
                "source": p.get("source", ""),
                "status": p.get("status", "unverified"),
                "description": p.get("description", ""),
                "runtime": r["runtime"],
                "attempts": r["attempts"],
                "packages": [
                    {
                        "id": x["id"],
                        "range": x["range"],
                        "blocked": bool(x["incompatible"]),
                    }
                    for x in pkgs
                ],
                "run": run.to_dict() if run else None,
            }
        )
    return out


class NewProject(BaseModel):
    url: str


@app.post("/api/projects")
def add_project(body: NewProject):
    m = re.match(
        r"^https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", body.url.strip()
    )
    if not m:
        raise HTTPException(400, "Use a GitHub URL like https://github.com/owner/repo")
    owner, repo = m.groups()
    pid = f"{owner}-{repo}".lower()
    if not orch.get_project(pid):
        logs: list[str] = []
        try:
            path = orch.clone(body.url.strip(), pid, lambda s, line: logs.append(line))
            orch.register_project(
                pid,
                repo,
                f"git:{body.url.strip()}",
                owner,
                path,
                f"node@{schema.current_node_major()}",
            )
        except FileNotFoundError as exc:
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(422, f"{exc}") from exc
    return {"id": pid}


@app.delete("/api/projects/{pid}")
def delete_project(pid: str):
    if pid in {e["id"] for e in EXAMPLE_PROJECTS}:
        raise HTTPException(400, "Example projects can be reset, not deleted")
    client.run(Q.DELETE_PROJECT, {"id": pid}, quiet=True)
    return {"ok": True}


class StartRun(BaseModel):
    mode: Literal["auto", "claude", "deterministic"] = "auto"


_start_lock = threading.Lock()


@app.post("/api/projects/{pid}/resurrect")
def resurrect(pid: str, body: StartRun = StartRun()):
    if not orch.get_project(pid):
        raise HTTPException(404, "Unknown project")
    with _start_lock:
        current = orch.RUNS.get(orch.LATEST.get(pid, ""))
        if current and current.status in ("running", "awaiting_approval"):
            return current.to_dict()
        _reset(pid, forget=False)
        return orch.start(pid, body.mode).to_dict()


def _reset(pid: str, forget: bool) -> None:
    project = orch.get_project(pid)
    client.run(Q.RESET_ATTEMPTS, {"id": pid}, quiet=True)
    if forget:
        client.run(Q.FORGET_LEARNED, quiet=True)
    orch.register_project(
        pid,
        project["name"],
        project["source"],
        project.get("owner", ""),
        orch.project_dir(project),
        f"node@{schema.current_node_major()}",
    )
    client.run(Q.SET_STATUS, {"id": pid, "status": "unverified"}, quiet=True)
    orch.LATEST.pop(pid, None)


@app.post("/api/projects/{pid}/reset")
def reset(pid: str):
    if not orch.get_project(pid):
        raise HTTPException(404, "Unknown project")
    current = orch.RUNS.get(orch.LATEST.get(pid, ""))
    if current and current.status in ("running", "awaiting_approval"):
        raise HTTPException(409, "Wait for the active run before resetting")
    _reset(pid, forget=True)
    return {"ok": True}


@app.get("/api/projects/{pid}/map")
def project_map(pid: str):
    return orch.project_map(pid)


@app.get("/api/runs/{rid}")
def get_run(rid: str):
    run = orch.RUNS.get(rid)
    if not run:
        raise HTTPException(404, "Unknown run")
    return {**run.to_dict(), "events_list": run.events}


@app.get("/api/runs/{rid}/events")
async def events(rid: str, request: Request, since: int = 0):
    run = orch.RUNS.get(rid)
    if not run:
        raise HTTPException(404, "Unknown run")

    async def stream():
        i = since
        while True:
            if await request.is_disconnected():
                return
            while i < len(run.events):
                yield f"data: {json.dumps(run.events[i], default=str)}\n\n"
                i += 1
                if run.events[i - 1]["type"] == "done":
                    return
            await asyncio.sleep(0.12)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/runs/{rid}/patch", response_class=PlainTextResponse)
def patch(rid: str):
    run = orch.RUNS.get(rid)
    if not run or not run.patch:
        raise HTTPException(404, "No patch for this run")
    return run.patch


@app.get("/preview/{rid}/{path:path}")
def preview(rid: str, path: str = ""):
    run = orch.RUNS.get(rid)
    if not run or not run.preview:
        raise HTTPException(404, "Nothing to preview")
    root = run.preview.resolve()
    target = (root / (path or "index.html")).resolve()
    if root not in target.parents and target != root:
        raise HTTPException(403)
    if target.is_dir():
        target = target / "index.html"
    if not target.exists():
        raise HTTPException(404)
    return FileResponse(
        target,
        media_type=mimetypes.guess_type(target.name)[0] or "application/octet-stream",
        headers={
            # Permit JS submit handlers while preventing native form navigation.
            # Keep the document opaque: never add allow-same-origin.
            "Content-Security-Policy": "sandbox allow-scripts allow-forms; form-action 'none'",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ---------------------------------------------------------------- graph rules (live FalkorDB edits)
def _rules() -> dict:
    a, b, _ = seeds.TEACHABLE_CONFLICT
    has = client.run(Q.HAS_CONFLICT, {"a": a, "b": b}, quiet=True)
    pol = client.run(Q.POLICY, quiet=True)
    return {
        "teach_conflict": bool(has),
        "conflict_learned": bool(has and has[0]["learned"]),
        "allow_workarounds": bool(pol and pol[0]["allow_workarounds"]),
        "conflict": {"a": a, "b": b},
    }


class Rules(BaseModel):
    teach_conflict: bool | None = None
    allow_workarounds: bool | None = None


@app.get("/api/rules")
def get_rules():
    return _rules()


@app.post("/api/rules")
def set_rules(body: Rules):
    a, b, reason = seeds.TEACHABLE_CONFLICT
    if body.teach_conflict is not None:
        if body.teach_conflict:
            client.run(
                Q.SEED_CONFLICT,
                {"rows": [{"a": a, "b": b, "reason": reason, "learned": False}]},
                quiet=True,
            )
        else:
            client.run(Q.FORGET_CONFLICT, {"a": a, "b": b}, quiet=True)
    if body.allow_workarounds is not None:
        client.run(
            Q.SET_POLICY, {"allow_workarounds": body.allow_workarounds}, quiet=True
        )
    return _rules()


@app.get("/api/cypher")
def cypher_catalog():
    return {
        k: " ".join(v.split())
        for k, v in vars(Q).items()
        if k.isupper() and isinstance(v, str)
    }


class Approval(BaseModel):
    approval_id: str
    approved: bool


@app.post("/api/runs/{rid}/approval")
def approve(rid: str, body: Approval):
    run = orch.RUNS.get(rid)
    if not run:
        raise HTTPException(404, "Unknown run")
    with run.cond:
        pending = run.pending_approval
        if (
            not pending
            or pending["id"] != body.approval_id
            or run.approval_decision is not None
            or time.time() > pending.get("expires_at", float("inf"))
        ):
            raise HTTPException(409, "Approval is no longer pending for this plan")
        run.approval_decision = body.approved
        run.cond.notify_all()
    return {"ok": True}


class Counterfactual(BaseModel):
    allow_workarounds: bool | None = None
    runtime_available: dict[str, bool] | None = None


@app.post("/api/projects/{pid}/what-if")
def what_if(pid: str, body: Counterfactual):
    if not orch.get_project(pid):
        raise HTTPException(404, "Unknown project")
    return planner.what_if(pid, body.model_dump(exclude_none=True))


@app.get("/api/projects/{pid}/why-chains")
def why_chains(pid: str):
    return dependencies.why_chains(pid)


@app.get("/api/projects/{pid}/plan")
def explain_plan(pid: str):
    if not orch.get_project(pid):
        raise HTTPException(404, "Unknown project")
    return planner.rank_recovery_plans(pid)


class Question(BaseModel):
    question: str


@app.post("/api/projects/{pid}/ask")
def ask_graph(pid: str, body: Question):
    if not orch.get_project(pid):
        raise HTTPException(404, "Unknown project")
    if not 1 <= len(body.question.strip()) <= 1200:
        raise HTTPException(400, "Question must be between 1 and 1,200 characters")
    try:
        return ask(pid, body.question)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            502,
            "Graph question could not be completed. Check the local model and database configuration.",
        ) from exc


@app.get("/api/runs/{rid}/certificate")
def certificate(rid: str):
    run = orch.RUNS.get(rid)
    if not run or not run.certificate:
        raise HTTPException(404, "No certificate yet")
    return run.certificate


@app.post("/api/runs/{rid}/pull-request")
def pull_request(rid: str):
    run = orch.RUNS.get(rid)
    if not run:
        raise HTTPException(404, "Unknown run")
    project = orch.get_project(run.project_id)
    try:
        return pull_requests.create(run, project, orch.project_dir(project))
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
