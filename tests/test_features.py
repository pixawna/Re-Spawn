import asyncio
import json
import threading
from types import SimpleNamespace
from unittest.mock import patch
import pytest
from backend.graph.dependencies import parse_lock
from backend.graph.ask import validate_query
from backend.agent.mcp_runtime import connected
from backend.agent.claude import run_agent
from backend.agent.orchestrator import Run
from backend.recovery.verifier import count_tests, output_dir


def test_lock_resolution_preserves_hoisted_and_nested_scoped_packages():
    lock = {
        "lockfileVersion": 3,
        "name": "example",
        "packages": {
            "": {"devDependencies": {"a": "1", "@scope/tool": "2"}},
            "node_modules/a": {
                "version": "1.0.0",
                "dependencies": {"b": "1"},
                "peerDependencies": {"@scope/tool": "2"},
            },
            "node_modules/b": {"version": "2.0.0"},
            "node_modules/a/node_modules/b": {"version": "1.0.0"},
            "node_modules/@scope/tool": {
                "version": "2.0.0",
                "dependencies": {"b": "2"},
            },
        },
    }
    parsed = parse_lock(lock, "p")
    nodes = {n["path"]: n["id"] for n in parsed["nodes"]}
    pairs = {(e["a"], e["b"]) for e in parsed["edges"]}
    assert (nodes["node_modules/a"], nodes["node_modules/a/node_modules/b"]) in pairs
    assert (nodes["node_modules/@scope/tool"], nodes["node_modules/b"]) in pairs
    assert (nodes["node_modules/a"], nodes["node_modules/@scope/tool"]) in pairs
    assert parsed["unresolved"] == []
    assert (
        next(v for v in parsed["versions"] if v["name"] == "@scope/tool")["pv"]
        == "npm:@scope/tool@2"
    )


@pytest.mark.parametrize(
    "query",
    [
        "MATCH (n) DELETE n RETURN n",
        "MATCH (n) RETURN n; CREATE ()",
        "CALL db.labels()",
        "MATCH p=()-[*]->() RETURN p",
        "MATCH p=()-[*1..50]->() RETURN p",
        "MATCH p=()-[:DEPENDS_ON*100]->() RETURN p",
        "MATCH p=()-[:DEPENDS_ON* 1 .. 50]->() RETURN p",
        "MATCH p=()-[:DEPENDS_ON* 1 .. ]->() RETURN p",
        "MATCH p=()-[:DEPENDS_ON*11..]->() RETURN p",
        "MATCH p=()-[:DEPENDS_ON*5..2]->() RETURN p",
        "MATCH (n) RETURN n // ignored",
    ],
)
def test_query_guard_rejects_unbounded_or_mutating_queries(query):
    with pytest.raises(ValueError):
        validate_query(query)


def test_read_only_query_limit_is_owned_by_application():
    assert validate_query(
        "MATCH (p:Project {id:$project}) RETURN p.id AS id LIMIT 900"
    ).endswith("LIMIT 30")


class FakeSession:
    def __init__(self):
        self.run = Run("test")
        self.calls = []

    def dispatch(self, name, args):
        self.calls.append((name, args))
        if name == "execute_plan":
            self.run.status = "alive"
            return {"terminal": True, "status": "alive"}
        return {"chosen": {"id": "graph-selected"}, "status": "diagnosed"}


def test_real_mcp_transport_lists_validates_and_dispatches_tools():
    async def check():
        session = FakeSession()
        async with connected(session) as mcp:
            tools = await mcp.list_tools()
            assert "execute_plan" in [t.name for t in tools.tools]
            result = await mcp.call_tool("diagnose_project", {})
            assert not result.isError
            rejected = await mcp.call_tool("execute_plan", {"shell": "rm -rf /"})
            assert rejected.isError
            assert len(session.calls) == 1

    asyncio.run(check())


class Block:
    def __init__(self, name, args, ident):
        self.type = "tool_use"
        self.name = name
        self.input = args
        self.id = ident

    def model_dump(self, **_):
        return vars(self)


class FakeClaude:
    def __init__(self):
        self.messages = self
        self.requests = []

    async def create(self, **kw):
        self.requests.append(kw)
        choices = [
            ("diagnose_project", {}),
            ("rank_blockers", {}),
            ("trace_dependency_chain", {}),
            ("rank_recovery_plans", {}),
            ("execute_plan", {"plan_id": "graph-selected"}),
        ]
        name, args = choices[len(self.requests) - 1]
        return SimpleNamespace(content=[Block(name, args, str(len(self.requests)))])


def test_claude_selects_tools_through_mcp_and_consumes_results():
    session = FakeSession()
    claude = FakeClaude()
    asyncio.run(run_agent(session, claude))
    assert [c[0] for c in session.calls] == [
        "diagnose_project",
        "rank_blockers",
        "trace_dependency_chain",
        "rank_recovery_plans",
        "execute_plan",
    ]
    assert claude.requests[1]["messages"][2]["content"][0]["type"] == "tool_result"
    assert session.run.status == "alive"


def test_approval_is_scoped_and_cannot_be_replayed():
    from backend.main import approve, Approval
    from backend.agent import orchestrator as orch
    from fastapi import HTTPException

    run = Run("test")
    orch.RUNS[run.id] = run
    run.pending_approval = {"id": "exact-plan"}
    try:
        with pytest.raises(HTTPException):
            approve(run.id, Approval(approval_id="other-plan", approved=True))
        assert run.approval_decision is None
        approve(run.id, Approval(approval_id="exact-plan", approved=False))
        assert run.approval_decision is False
        with pytest.raises(HTTPException):
            approve(run.id, Approval(approval_id="exact-plan", approved=True))
    finally:
        orch.RUNS.pop(run.id)


def test_missing_key_falls_back_without_calling_claude(monkeypatch):
    from backend.agent.orchestrator import _loop

    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with patch("backend.agent.session.RecoverySession") as session:
        run = Run("test", "claude")
        _loop(run)
        session.return_value.fallback.assert_called_once()
        assert any(e.get("reason") == "missing_key" for e in run.events)


def test_verification_does_not_treat_public_source_as_build(tmp_path):
    (tmp_path / "public").mkdir()
    (tmp_path / "public/index.html").write_text("unbuilt source")
    assert output_dir(tmp_path) is None
    assert count_tests("ℹ pass 6\nℹ fail 0") == {"passed": 6, "failed": 0}


def test_unverified_run_cannot_publish():
    from backend.pull_requests import create

    with pytest.raises(ValueError, match="fully verified"):
        create(Run("test"), {}, None)


def test_workspace_rejects_symlink_escape(tmp_path):
    from backend.recovery.executor import fresh_workspace

    source = tmp_path / "source"
    source.mkdir()
    secret = tmp_path / "outside"
    secret.write_text("private")
    (source / "package.json").symlink_to(secret)
    with pytest.raises(ValueError, match="Symlinked"):
        fresh_workspace(source, tmp_path / "dest")
    assert secret.read_text() == "private"


def test_silent_commands_obey_timeout(tmp_path, monkeypatch):
    import sys, time
    from backend.recovery.executor import run

    monkeypatch.setenv("RESPAWN_SANDBOX", "local")
    started = time.monotonic()
    result = run(
        [sys.executable, "-c", "import time;time.sleep(20)"],
        tmp_path,
        lambda *_: None,
        timeout=0.2,
    )
    assert result["code"] == 124
    assert time.monotonic() - started < 3


def test_draft_pr_contains_only_verified_files_and_trace(tmp_path, monkeypatch):
    import httpx
    from backend import pull_requests

    source = tmp_path / "source"
    source.mkdir()
    ws = tmp_path / "workspace"
    ws.mkdir()
    (source / "package.json").write_text('{"version":"1"}')
    (ws / "package.json").write_text('{"version":"2"}')
    (ws / ".env").write_text("private-test-value")
    run = Run("imported")
    run.status = "alive"
    run.workspace = ws
    run.certificate = {
        "steps": ["Upgrade"],
        "tests": {"passed": 8},
        "decision_trace": [{"type": "decision", "text": "Graph selected upgrade"}],
    }
    calls = []

    def handler(request):
        body = json.loads(request.content) if request.content else None
        calls.append((request.method, request.url.path, body))
        path = request.url.path
        if path.endswith("/git/ref/heads/main"):
            return httpx.Response(200, json={"object": {"sha": "base"}})
        if "/git/ref/heads/respawn/" in path:
            return httpx.Response(404, json={})
        if path.endswith("/git/commits/base"):
            return httpx.Response(200, json={"tree": {"sha": "tree-base"}})
        if path.endswith("/pulls"):
            return httpx.Response(
                200,
                json=(
                    []
                    if request.method == "GET"
                    else {"html_url": "https://github.com/owner/project/pull/1"}
                ),
            )
        if path.endswith("/git/blobs"):
            return httpx.Response(201, json={"sha": "blob"})
        if path.endswith("/git/trees"):
            return httpx.Response(201, json={"sha": "new-tree"})
        if path.endswith("/git/commits"):
            return httpx.Response(201, json={"sha": "new-commit"})
        if path.endswith("/git/refs"):
            return httpx.Response(201, json={})
        return httpx.Response(200, json={"default_branch": "main"})

    original = httpx.Client
    monkeypatch.setattr(
        pull_requests.httpx,
        "Client",
        lambda **kw: original(transport=httpx.MockTransport(handler), **kw),
    )
    monkeypatch.setattr(
        pull_requests.subprocess,
        "run",
        lambda *a, **kw: SimpleNamespace(stdout="base\n"),
    )
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    result = pull_requests.create(
        run,
        {"source": "git:https://github.com/owner/project", "name": "project"},
        source,
    )
    assert result["url"].endswith("/pull/1")
    tree = next(body for method, path, body in calls if path.endswith("/git/trees"))
    assert {row["path"] for row in tree["tree"]} == {
        "package.json",
        f".respawn/{run.id}-certificate.json",
    }
    assert (
        next(
            body
            for method, path, body in calls
            if method == "POST" and path.endswith("/pulls")
        )["draft"]
        is True
    )
    count = len(calls)
    pull_requests.create(
        run,
        {"source": "git:https://github.com/owner/project", "name": "project"},
        source,
    )
    assert len(calls) == count


@pytest.mark.parametrize("bound", ["*1..10", "* 1 .. 10", "*3", "*..5"])
def test_query_guard_accepts_bounded_relationship_lengths(bound):
    assert validate_query(f"MATCH p=()-[:DEPENDS_ON{bound}]->() RETURN p").endswith(
        "LIMIT 30"
    )


def test_approved_plan_is_rejected_if_graph_selects_a_different_route(monkeypatch):
    from backend.agent.session import RecoverySession
    from backend.graph import planner

    session = RecoverySession.__new__(RecoverySession)
    session.run = Run("test")
    session.o = SimpleNamespace(MAX_ATTEMPTS=4)
    session.attempts = []
    session.approved_recipes = [[{"op": "runtime", "node": 16}]]
    plan = {
        "id": "original",
        "steps": ["runtime"],
        "feasible": True,
        "approval_required": True,
    }
    rankings = iter(
        [
            {"plans": [plan], "chosen": plan},
            {"plans": [plan], "chosen": {"id": "new-graph-choice"}},
        ]
    )
    session.rank = lambda: next(rankings)
    session.await_approval = lambda _: True
    monkeypatch.setattr(
        planner, "_migration", lambda _: {"recipe": session.approved_recipes[0]}
    )
    with pytest.raises(ValueError, match="Graph facts or recipes changed"):
        session.execute("original")
    assert session.run.workspace is None


def test_reported_failures_prevent_verified_status_even_with_zero_exit(
    monkeypatch, tmp_path
):
    from backend.agent import orchestrator as orch

    run = Run("test")
    run.execution_runtime = "22"
    (tmp_path / "package.json").write_text("{}")
    monkeypatch.setattr(orch, "_tool", lambda *a, **kw: {})
    monkeypatch.setattr(orch.planner, "_migration", lambda _: {"title": "Upgrade"})
    monkeypatch.setattr(orch.planner, "apply_success", lambda *a, **kw: None)
    monkeypatch.setattr(orch.client, "run", lambda *a, **kw: [])
    monkeypatch.setattr(orch.inspector, "inspect", lambda _: {"deps": []})
    monkeypatch.setattr(orch.verifier, "output_dir", lambda _: tmp_path)
    monkeypatch.setattr(
        orch.verifier,
        "smoke",
        lambda _: {"ok": True, "checks": [{"url": "/", "status": 200, "bytes": 10}]},
    )
    attempts = [
        {
            "n": 1,
            "titles": ["Upgrade"],
            "steps": ["migration"],
            "outcome": "build-passing",
        }
    ]
    orch._finish(
        run,
        "test",
        {"name": "test"},
        {"scripts": {"build": "build", "test": "test"}, "deps": []},
        tmp_path,
        tmp_path,
        ["migration"],
        {"code": 0, "output": "# pass 1\n# fail 1"},
        attempts,
    )
    assert run.status == "build-passing"
    assert attempts[0]["outcome"] == "build-passing"
    assert any(
        e["type"] == "attempt" and e["status"] == "build-passing" for e in run.events
    )
    assert run.certificate["verification"]["tests_failed"] == 1
    assert run.certificate["verification"]["smoke"] is True


def test_docker_npm_uses_container_binary_instead_of_host_runtime(
    monkeypatch, tmp_path
):
    from backend.recovery import executor

    runtime_dir = tmp_path / "host-node/bin"
    runtime_dir.mkdir(parents=True)
    (runtime_dir / "npm").write_text("host executable")
    monkeypatch.setenv("RESPAWN_SANDBOX", "docker")
    calls = []
    monkeypatch.setattr(
        executor, "run", lambda command, *a, **kw: calls.append(command) or {"code": 0}
    )
    executor.npm(
        tmp_path,
        ["run", "build"],
        lambda *_: None,
        node_path=str(runtime_dir / "node"),
        node_major=16,
    )
    assert calls == [["npm", "run", "build"]]


def test_provider_failure_resumes_existing_recovery_session(monkeypatch):
    from unittest.mock import AsyncMock
    from backend.agent.orchestrator import _loop

    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-only-not-a-real-key")
    with patch("backend.agent.session.RecoverySession") as session, patch(
        "backend.agent.claude.run_agent",
        new=AsyncMock(side_effect=TimeoutError("provider timeout")),
    ):
        run = Run("test", "claude")
        _loop(run)
        session.return_value.fallback.assert_called_once()
        assert any(
            e["type"] == "agent_fallback" and e["reason"] == "TimeoutError"
            for e in run.events
        )
