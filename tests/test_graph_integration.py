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
    client.run(
        'MATCH (r:Environment) WHERE r.id IN ["node@14", "node@16"] SET r.available=false',
        quiet=True,
    )
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
        'MATCH (n:Environment {id:"node@16"}) RETURN n.available AS value', quiet=True
    )
    result = planner.what_if(
        "legacy-todo-app", {"runtime_available": {"node@16": True}}
    )
    rt = next(p for p in result["plans"] if "mig:runtime-node-16" in p["steps"])
    assert rt["feasible"] and rt["approval_required"]
    assert (
        client.run(
            'MATCH (n:Environment {id:"node@16"}) RETURN n.available AS value',
            quiet=True,
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


def test_python_route_uses_the_same_planner_without_node_downgrades(graph):
    orch.register_project(
        "legacy-python-report",
        "legacy-python-report",
        "example:legacy-python-report",
        "tests",
        orch.EXAMPLES / "legacy-python-report",
    )
    ranked = planner.rank_recovery_plans("legacy-python-report")
    assert ranked["chosen"]["steps"] == [
        "mig:python-install-packaging",
        "mig:python-distutils-packaging",
    ]
    assert ranked["planning"]["algorithm"] == "FalkorDB algo.SPpaths"
    assert not any(
        "runtime-node" in step for plan in ranked["plans"] for step in plan["steps"]
    )
    assert ranked["blockers"][0]["package"] == "python-stdlib:distutils@3"
    why = dependencies.why_chains("legacy-python-report")["chains"][0]
    assert why["ids"] == [
        "legacy-python-report",
        "python-stdlib:distutils@3",
        "python@3.12",
    ]


def test_legacy_schema_migration_preserves_edges_and_is_idempotent(graph):
    client.run(
        "CREATE (p:Project {id:'old-project'})-[:USES]->(a:PackageVersion {id:'old-lib@1',name:'old-lib',major:1})-[:CONFLICTS_WITH {learned:true,evidence:'old run'}]->(:PackageVersion {id:'other-lib@2',name:'other-lib',major:2}) CREATE (p)-[:RUNS_ON]->(:Runtime {id:'node@99',major:99,available:false})",
        quiet=True,
    )
    schema.init()
    schema.init()
    rows = client.run(
        "MATCH (:Project {id:'old-project'})-[:USES]->(a:Artifact)-[c:CONFLICTS_WITH]->(b:Artifact) RETURN a.id AS a,b.id AS b,c.evidence AS evidence",
        quiet=True,
    )
    assert rows == [
        {"a": "npm:old-lib@1", "b": "npm:other-lib@2", "evidence": "old run"}
    ]
    assert client.run(
        "MATCH (:Project {id:'old-project'})-[:RUNS_ON]->(e:Environment) RETURN e.kind AS kind",
        quiet=True,
    ) == [{"kind": "node"}]


def test_python_capability_filter_blocks_unsupported_recipes(graph, tmp_path):
    (tmp_path / "requirements.txt").write_text("")
    (tmp_path / "report.py").write_text("import distutils\n")
    orch.register_project(
        "unsupported-python",
        "unsupported-python",
        "example:unsupported-python",
        "tests",
        tmp_path,
    )
    ranked = planner.rank_recovery_plans("unsupported-python")
    assert ranked["blockers"][0]["package"] == "python-stdlib:distutils@3"
    assert ranked["chosen"] is None
    assert not any(
        "mig:python-distutils-packaging" in p["steps"] for p in ranked["plans"]
    )


def test_source_evidence_survives_success_and_is_scoped_to_project(graph):
    path = orch.EXAMPLES / "legacy-python-report"
    orch.register_project(
        "python-one", "python-one", "example:legacy-python-report", "tests", path
    )
    client.run(
        "MATCH (p:Project {id:'python-one'})-[u:USES]->(:Artifact {id:'python-stdlib:distutils@3'}) SET u.source='one.py:3'",
        quiet=True,
    )
    orch.register_project(
        "python-two", "python-two", "example:legacy-python-report", "tests", path
    )
    planner.apply_success(
        "python-one",
        ["mig:python-install-packaging", "mig:python-distutils-packaging"],
        {"packaging": "==24.2"},
    )
    first = dependencies.why_chains("python-one")["chains"][0]
    second = dependencies.why_chains("python-two")["chains"][0]
    assert first["source"] == "one.py:3"
    assert first["relationships"][0] == "USED"
    assert second["source"] == "report.py:3"
    assert second["relationships"][0] == "USES"
