"""Create indexes and seed the knowledge base."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

from . import client, queries as Q, seeds


def _node_major(binary: str) -> int | None:
    try:
        out = subprocess.run([binary, "-v"], capture_output=True, text=True, timeout=10).stdout.strip()
        return int(out.lstrip("v").split(".")[0])
    except Exception:  # noqa: BLE001
        return None


def detect_runtimes() -> dict[int, str]:
    """Find Node.js installs on this machine: PATH plus nvm / fnm / n / volta / asdf dirs."""
    found: dict[int, str] = {}
    current = shutil.which("node")
    if current:
        major = _node_major(current)
        if major:
            found[major] = current
    home = Path.home()
    patterns = [
        home / ".nvm" / "versions" / "node",
        home / ".local" / "share" / "fnm" / "node-versions",
        home / "Library" / "Application Support" / "fnm" / "node-versions",
        Path("/usr/local/n/versions/node"),
        home / ".volta" / "tools" / "image" / "node",
        home / ".asdf" / "installs" / "nodejs",
    ]
    for base in patterns:
        if not base.is_dir():
            continue
        for d in base.iterdir():
            m = re.match(r"v?(\d+)\.", d.name)
            if not m:
                continue
            for cand in (d / "bin" / "node", d / "installation" / "bin" / "node"):
                if cand.exists():
                    found.setdefault(int(m.group(1)), str(cand))
                    break
    for major, path in list(found.items()):
        if os.getenv("RESPAWN_HIDE_NODE_" + str(major)):
            found.pop(major)
    return found


def current_node_major() -> int:
    major = _node_major(shutil.which("node") or "node")
    return major or 22


def init(force: bool = False) -> dict:
    client.connect()
    for stmt in Q.SCHEMA:
        try:
            client.run(stmt, quiet=True)
        except Exception:  # noqa: BLE001 - index already exists
            pass

    installed = detect_runtimes()
    majors = sorted(set(seeds.NODE_MAJORS) | set(installed))
    client.run(Q.SEED_RUNTIMES, {"rows": [
        {"id": f"node@{m}", "major": m, "available": m in installed, "eol": m < 20 or m in (21, 23),
         "path": installed.get(m, "")}
        for m in majors
    ]}, quiet=True)

    pkg_rows = [{"id": f"{n}@{m}", "name": n, "major": m} for n, ms in seeds.PACKAGES.items() for m in ms]
    client.run(Q.SEED_PACKAGES, {"rows": pkg_rows}, quiet=True)

    client.run(Q.SEED_INCOMPATIBLE, {"rows": [
        {"pkg": p, "from_major": fm, "reason": r, "signature": s} for p, fm, r, s in seeds.INCOMPATIBLE
    ]}, quiet=True)
    client.run(Q.SEED_CONFLICT, {"rows": [
        {"a": a, "b": b, "reason": r} for a, b, r in seeds.CONFLICTS
    ]}, quiet=True)

    migs = [
        {**{k: v for k, v in m.items() if k != "recipe"}, "recipe": seeds.recipe_json(m["recipe"]),
         "to": m.get("to")}
        for m in seeds.MIGRATIONS
    ] + [
        {"id": m["id"], "title": m["title"], "kind": m["kind"], "cost": m["cost"], "risk": m["risk"],
         "why": m["why"], "recipe": seeds.recipe_json(m["recipe"]), "from": None, "to": m["to_runtime"]}
        for m in seeds.RUNTIME_MIGRATIONS
    ]
    client.run(Q.SEED_MIGRATION, {"rows": migs}, quiet=True)
    client.run(Q.SEED_POLICY, quiet=True)
    return {"runtimes": installed, **client.status()}
