"""Real FalkorDB tests. Opt in with RESPAWN_TEST_GRAPH=1; each run uses a new graph."""

import os
import uuid
from pathlib import Path
import pytest
from backend.graph import client, planner, schema, dependencies, queries as Q
from backend.agent import orchestrator as orch

pytestmark = pytest.mark.skipif(
    os.getenv("RESPAWN_TEST_GRAPH") != "1", reason="Requires local FalkorDB"
)


@pytest.fixture()
def graph():
    old = (client._graph, client.GRAPH_NAME)
    client._graph = None
    client.GRAPH_NAME = "respawn_test_" + uuid.uuid4().hex
    schema.init()
    # Tests model a modern runtime and unavailable legacy runtimes independently
    # of which Node versions happen to be installed on the developer machine.
    client.run('MATCH (r:Runtime) WHERE r.id IN ["node@14", "node@16"] SET r.available=false', quiet=True)
    for pid in ("legacy-todo-app", "legacy-kanban-app"):
        orch.register_project(
            pid, pid, "example:" + pid, "tests", orch.EXAMPLES / pid, "node@22"
        )
    try:
        yield
    finally:
        client.connect().delete()
        client._graph, client.GRAPH_NAME = old


def test_weighted_path_replans_and_preserves_live_policy_in_what_if(graph):
    first = planner.rank_recovery_plans("legacy-todo-app")
    assert first["chosen"]["steps"] == ["mig:webpack-4-5"]
    assert first["planning"]["algorithm"] == "FalkorDB algo.SPpaths"
    assert first["planning"]["cost"] == 3
    original = client.run(Q.POLICY, quiet=True)
    hypothetical = planner.what_if("legacy-todo-app", {"allow_workarounds": True})
    assert hypothetical["chosen"]["steps"] == ["mig:openssl-legacy"]
    assert hypothetical["chosen"]["approval_required"]
    assert client.run(Q.POLICY, quiet=True) == original
    planner.record_attempt(
        "legacy-todo-app",
        "test-run",
        first["chosen"]["steps"],
        "failed",
        "peer_conflict",
        "CLI requires webpack 4",
    )
    planner.learn_conflict(
        "webpack-cli@3",
        "webpack@5",
        "CLI requires webpack 4",
        "real npm ERESOLVE fixture",
        "legacy-todo-app",
        "test-run",
    )
    second = planner.find_alternative("legacy-todo-app", "mig:webpack-4-5")
    assert second["chosen"]["steps"] == ["mig:webpack-cli-3-5", "mig:webpack-4-5"]
    assert second["planning"]["cost"] == 4
    shared = planner.rank_recovery_plans("legacy-kanban-app")
    assert shared["chosen"]["steps"] == second["chosen"]["steps"]
    assert shared["chosen"]["shared_learning"][0]["source_project"] == "legacy-todo-app"
    assert shared["chosen"]["evidence"]
    assert client.run(
        "MATCH (n:RecoveryState) RETURN count(n) AS count", quiet=True
    ) == [{"count": 0}]


def test_runtime_override_is_counterfactual_only(graph):
    before = client.run(
        'MATCH (n:Runtime {id:"node@16"}) RETURN n.available AS value', quiet=True
    )
    result = planner.what_if(
        "legacy-todo-app", {"runtime_available": {"node@16": True}}
    )
    rt = next(p for p in result["plans"] if "mig:runtime-node-16" in p["steps"])
    assert rt["feasible"] and rt["approval_required"]
    assert (
        client.run(
            'MATCH (n:Runtime {id:"node@16"}) RETURN n.available AS value', quiet=True
        )
        == before
    )


def test_database_read_only_boundary_blocks_mutation(graph):
    with pytest.raises(Exception):
        client.read_only("MATCH (p:Project) SET p.compromised=true RETURN p.id", {})
    assert (
        client.run("MATCH (p:Project) WHERE p.compromised=true RETURN p.id", quiet=True)
        == []
    )
