"""Materialize candidate package states; FalkorDB computes minimum-weight recovery."""

from __future__ import annotations
import hashlib
import json
import uuid
from . import client

SHORTEST_PATH = """
MATCH (source:RecoveryState {id:$source}), (target:RecoveryState {id:$target})
CALL algo.SPpaths({sourceNode:source, targetNode:target,
    relTypes:['RECOVERY_STEP'], weightProp:'weight', relDirection:'outgoing', pathCount:1})
YIELD path, pathWeight
RETURN pathWeight AS cost, [n IN nodes(path) | n.state] AS states,
       [r IN relationships(path) | r.migration] AS steps,
       [r IN relationships(path) | r.plan] AS plans
"""


def choose(
    project_id: str, plans: list[dict], migrations: dict[str, dict], policy: dict
) -> dict:
    evaluation = "eval:" + uuid.uuid4().hex
    source, target = evaluation + ":start", evaluation + ":goal"
    base_rows = client.run(
        "MATCH (:Project {id:$id})-[:USES]->(p:Artifact) RETURN p.name AS name,p.ecosystem AS ecosystem,p.id AS version",
        {"id": project_id},
        tag="state_space",
    )
    runtimes = client.run(
        "MATCH (:Project {id:$id})-[:RUNS_ON]->(r:Environment) RETURN r.id AS id",
        {"id": project_id},
        tag="state_space",
    )
    base = {f"{r['ecosystem']}:{r['name']}": r["version"] for r in base_rows}
    base["runtime"] = runtimes[0]["id"] if runtimes else "unknown"
    nodes = {
        source: json.dumps(base, sort_keys=True),
        target: json.dumps(
            {"goal": "eligible for execution; verification still required"}
        ),
    }
    edges = []
    for plan in plans:
        if not plan["feasible"]:
            continue
        state = dict(base)
        previous = source
        for i, step in enumerate(plan["steps"]):
            migration = migrations[step]
            for op in migration["recipe"]:
                if op["op"] == "runtime":
                    state["runtime"] = migration["target"]
                elif op["op"] == "set":
                    state[
                        f"{op.get('ecosystem', migration.get('ecosystem', 'npm'))}:{op['pkg']}"
                    ] = op["range"]
                elif op["op"] == "replace":
                    state.pop(f"{migration.get('ecosystem', 'npm')}:{op['pkg']}", None)
                    state[f"{migration.get('ecosystem', 'npm')}:{op['with']}"] = op[
                        "range"
                    ]
                elif op["op"] == "source_replace":
                    state["source_migration:" + step] = hashlib.sha256(
                        op["new"].encode()
                    ).hexdigest()
                elif op["op"] == "npmrc":
                    state["npmrc:" + op["key"]] = op["value"]
            # Plan prefix is part of state to prevent recombining already-failed sequences.
            key = hashlib.sha256((plan["id"] + ":" + str(i)).encode()).hexdigest()[:20]
            nid = evaluation + ":" + key
            nodes[nid] = json.dumps(state, sort_keys=True)
            weight = migration["cost"] + {"low": 0, "medium": 1, "high": 1.5}.get(
                migration["risk"], 0
            )
            if migration["kind"] == "runtime" and migration.get("target_eol"):
                weight += policy.get("eol_penalty") or 0
            edges.append(
                {
                    "a": previous,
                    "b": nid,
                    "migration": step,
                    "weight": weight,
                    "plan": plan["id"],
                }
            )
            previous = nid
        edges.append(
            {
                "a": previous,
                "b": target,
                "migration": "",
                "weight": 0,
                "plan": plan["id"],
            }
        )
    try:
        client.run(
            "UNWIND $rows AS r CREATE (:RecoveryState {id:r.id, evaluation:$evaluation, state:r.state})",
            {
                "evaluation": evaluation,
                "rows": [{"id": k, "state": v} for k, v in nodes.items()],
            },
            tag="state_space",
        )
        if edges:
            client.run(
                "UNWIND $rows AS r MATCH (a:RecoveryState {id:r.a}),(b:RecoveryState {id:r.b}) CREATE (a)-[:RECOVERY_STEP {migration:r.migration,weight:r.weight,plan:r.plan}]->(b)",
                {"rows": edges},
                tag="state_space",
            )
        rows = client.run(
            SHORTEST_PATH, {"source": source, "target": target}, tag="shortest_path"
        )
        selected = next(
            (p for p in plans if rows and p["id"] == rows[0]["plans"][-1]), None
        )
        return {
            "chosen": selected,
            "algorithm": "FalkorDB algo.SPpaths",
            "cost": rows[0]["cost"] if rows else None,
            "states": [json.loads(s) for s in rows[0]["states"]] if rows else [],
            "query": SHORTEST_PATH,
            "params": {"source": source, "target": target},
            "state_count": len(nodes),
            "edge_count": len(edges),
            "candidate_limit": 64,
        }
    finally:
        client.run(
            "MATCH (n:RecoveryState {evaluation:$evaluation}) DETACH DELETE n",
            {"evaluation": evaluation},
            quiet=True,
        )
