"""Import npm's resolved installation graph, retaining nested/hoisted identities."""

from __future__ import annotations
import hashlib
import json
from pathlib import Path, PurePosixPath
from . import client

WHY_CHAINS = """
MATCH (p:Project {id: $id})-[:LOCK_ROOT]->(root:InstalledPackage)
MATCH path=(root)-[:DEPENDS_ON*1..10]->(leaf:InstalledPackage)-[:USES_API]->(api:RuntimeAPI)-[:INCOMPATIBLE_WITH]->(rt:Runtime)
WHERE (p)-[:RUNS_ON]->(rt)
RETURN [n IN nodes(path) | n.id] AS ids,
       [n IN nodes(path) | coalesce(n.name, n.id)] AS labels,
       [r IN relationships(path) | type(r)] AS relationships,
       api.evidence AS evidence, api.source AS source
LIMIT 20
"""
DEPENDENCY_CHAINS = """
MATCH (p:Project {id: $id})-[:LOCK_ROOT]->(root:InstalledPackage)
MATCH path=(root)-[:DEPENDS_ON*1..10]->(leaf:InstalledPackage)-[:VERSION]->(pv:PackageVersion)-[:INCOMPATIBLE_WITH]->(rt:Runtime)
WHERE (p)-[:RUNS_ON]->(rt)
RETURN [n IN nodes(path) | n.id] AS ids,
       [n IN nodes(path) | coalesce(n.name, n.id)] AS labels,
       [r IN relationships(path) | type(r)] AS relationships,
       pv.id AS blocker
LIMIT 20
"""
DEGREE = """
MATCH (p:Project {id: $id})-[:RUNS_ON]->(rt:Runtime)
MATCH (installed:InstalledPackage {project: $id})-[:VERSION]->(pv:PackageVersion)
WHERE (pv)-[:INCOMPATIBLE_WITH]->(rt) OR (pv)-[:CONFLICTS_WITH]-(:PackageVersion)<-[:USES]-(p)
OPTIONAL MATCH (dependent:InstalledPackage {project: $id})-[:DEPENDS_ON]->(installed)
RETURN pv.id AS package, count(DISTINCT dependent) AS dependents
ORDER BY dependents DESC
"""


def parse_lock(lock: dict, project_id: str) -> dict:
    if lock.get("lockfileVersion", 0) < 2 or not isinstance(lock.get("packages"), dict):
        raise ValueError("Dependency import requires npm package-lock v2 or v3")
    packages = lock["packages"]
    if len(packages) > 20000:
        raise ValueError("Lockfile exceeds the 20,000-package import limit")

    def ident(path):
        return "dep:" + hashlib.sha256(f"{project_id}:{path}".encode()).hexdigest()[:24]

    nodes, edges, versions, unresolved = [], [], [], []
    for path, entry in packages.items():
        if entry.get("link"):
            continue
        name = entry.get("name") or (
            path.rsplit("node_modules/", 1)[-1]
            if path
            else lock.get("name", project_id)
        )
        version = entry.get("version", "workspace")
        nodes.append(
            {"id": ident(path), "path": path, "name": name, "version": version}
        )
        if path and version.split(".")[0].isdigit():
            versions.append(
                {
                    "id": ident(path),
                    "pv": f"{name}@{int(version.split('.')[0])}",
                    "name": name,
                    "major": int(version.split(".")[0]),
                }
            )
        deps = {
            **entry.get("peerDependencies", {}),
            **entry.get("dependencies", {}),
            **entry.get("optionalDependencies", {}),
        }
        if path == "":
            deps.update(entry.get("devDependencies", {}))
        for dep, spec in deps.items():
            current = path
            while True:
                candidate = (
                    f"{current}/node_modules/{dep}"
                    if current
                    else f"node_modules/{dep}"
                )
                if candidate in packages and not packages[candidate].get("link"):
                    edges.append(
                        {"a": ident(path), "b": ident(candidate), "range": str(spec)}
                    )
                    break
                if not current:
                    unresolved.append({"from": path, "name": dep, "range": spec})
                    break
                current = str(PurePosixPath(current).parent)
                if current == ".":
                    current = ""
    return {
        "nodes": nodes,
        "edges": edges,
        "versions": versions,
        "root": ident(""),
        "unresolved": unresolved,
    }


def import_lock(project_id: str, workspace: Path) -> dict:
    lockfile = workspace / "package-lock.json"
    if not lockfile.exists():
        return {
            "imported": False,
            "reason": "No resolved package-lock.json exists yet",
            "packages": 0,
        }
    raw = lockfile.read_bytes()
    if len(raw) > 20_000_000:
        raise ValueError("Lockfile exceeds 20 MB")
    parsed = parse_lock(json.loads(raw), project_id)
    client.run(
        "MATCH (n:InstalledPackage {project: $id}) DETACH DELETE n",
        {"id": project_id},
        tag="import_dependencies",
    )
    for offset in range(0, len(parsed["nodes"]), 250):
        client.run(
            "UNWIND $rows AS r MERGE (n:InstalledPackage {id:r.id}) SET n.project=$id, n.name=r.name, n.version=r.version, n.path=r.path",
            {"id": project_id, "rows": parsed["nodes"][offset : offset + 250]},
            tag="import_dependencies",
        )
    client.run(
        "MATCH (p:Project {id:$id}), (root:InstalledPackage {id:$root}) MERGE (p)-[:LOCK_ROOT]->(root) SET p.lock_sha256=$hash",
        {
            "id": project_id,
            "root": parsed["root"],
            "hash": hashlib.sha256(raw).hexdigest(),
        },
        tag="import_dependencies",
    )
    for offset in range(0, len(parsed["edges"]), 250):
        client.run(
            "UNWIND $rows AS r MATCH (a:InstalledPackage {id:r.a}), (b:InstalledPackage {id:r.b}) MERGE (a)-[e:DEPENDS_ON]->(b) SET e.range=r.range",
            {"rows": parsed["edges"][offset : offset + 250]},
            tag="import_dependencies",
        )
    for offset in range(0, len(parsed["versions"]), 250):
        client.run(
            "UNWIND $rows AS r MATCH (n:InstalledPackage {id:r.id}) MERGE (pv:PackageVersion {id:r.pv}) SET pv.name=r.name,pv.major=r.major MERGE (n)-[:VERSION]->(pv)",
            {"rows": parsed["versions"][offset : offset + 250]},
            tag="import_dependencies",
        )
    # A source-backed API fact, not a fabricated edge inferred from package names.
    for entry in parsed["nodes"]:
        if entry["name"] != "webpack" or not entry["version"].startswith("4."):
            continue
        source = workspace / entry["path"] / "lib/util/createHash.js"
        defaults = workspace / entry["path"] / "lib/WebpackOptionsDefaulter.js"
        if (
            source.exists()
            and defaults.exists()
            and "createHash(algorithm)" in source.read_text()
            and "md4" in defaults.read_text()
        ):
            client.run(
                "MATCH (n:InstalledPackage {id:$node}), (rt:Runtime) WHERE rt.major >= 17 "
                'MERGE (a:RuntimeAPI {id:"crypto.createHash:md4"}) SET a.name="crypto.createHash(md4)",a.source=$source,a.evidence=$evidence '
                "MERGE (n)-[:USES_API]->(a) MERGE (a)-[:INCOMPATIBLE_WITH]->(rt)",
                {
                    "node": entry["id"],
                    "source": entry["path"] + "/lib/util/createHash.js",
                    "evidence": "webpack 4 default hashFunction=md4; createHash(algorithm) delegates to Node crypto; OpenSSL 3 disables MD4.",
                },
                tag="source_evidence",
            )
    return {
        "imported": True,
        "packages": len(parsed["nodes"]) - 1,
        "edges": len(parsed["edges"]),
        "unresolved": parsed["unresolved"],
        "sha256": hashlib.sha256(raw).hexdigest(),
    }


def why_chains(project_id: str) -> dict:
    chains = client.run(WHY_CHAINS, {"id": project_id}, tag="trace_dependency_chain")
    if not chains:
        chains = client.run(
            DEPENDENCY_CHAINS, {"id": project_id}, tag="trace_dependency_chain"
        )
    chains = [c for c in chains if len(c["ids"]) == len(set(c["ids"]))]
    chains.sort(key=lambda c: len(c["ids"]), reverse=True)
    for c in chains:
        c["labels"][0] = "package-lock.json"
        c["labels"][-1] = c["ids"][-1]
        c["ids"] = [project_id] + c["ids"]
        c["labels"] = [project_id] + c["labels"]
        c["relationships"] = ["LOCK_ROOT"] + c["relationships"]
    return {
        "chains": chains,
        "queries": [WHY_CHAINS, DEPENDENCY_CHAINS],
        "params": {"id": project_id},
        "max_dependency_hops": 10,
    }


def rank_blockers(project_id: str) -> dict:
    return {
        "algorithm": "FalkorDB incoming degree (distinct dependent packages)",
        "ranking": client.run(DEGREE, {"id": project_id}, tag="rank_blockers"),
        "query": DEGREE,
        "params": {"id": project_id},
    }
