"""Reads a project's package.json and maps it onto the graph."""

from __future__ import annotations

import json
import re
from pathlib import Path


def major_of(spec: str) -> int | None:
    """'^4.46.0' -> 4, '~3.3' -> 3, '4.x' -> 4, '>=5 <6' -> 5. Non-registry specs -> None."""
    if not isinstance(spec, str) or any(
        spec.startswith(p) for p in ("file:", "git", "http", "link:", "workspace:")
    ):
        return None
    m = re.search(r"(\d+)", spec)
    return int(m.group(1)) if m else None


def inspect(path: Path) -> dict:
    pkg_file = path / "package.json"
    if not pkg_file.exists():
        raise FileNotFoundError(
            "No package.json at the repository root. Re:Spawn currently revives npm projects."
        )
    pkg = json.loads(pkg_file.read_text())
    deps = {}
    for field in ("dependencies", "devDependencies"):
        for name, spec in (pkg.get(field) or {}).items():
            major = major_of(spec)
            if major is None:
                continue
            deps[name] = {
                "id": f"{name}@{major}",
                "name": name,
                "major": major,
                "range": spec,
                "field": field,
            }
    scripts = pkg.get("scripts") or {}
    test = scripts.get("test", "")
    has_test = bool(test) and "no test specified" not in test
    lockfiles = [
        f
        for f in ("package-lock.json", "yarn.lock", "pnpm-lock.yaml")
        if (path / f).exists()
    ]
    return {
        "name": pkg.get("name") or path.name,
        "version": pkg.get("version", ""),
        "description": pkg.get("description", ""),
        "engines": (pkg.get("engines") or {}).get("node", ""),
        "deps": list(deps.values()),
        "scripts": {
            "build": scripts.get("build", ""),
            "test": test if has_test else "",
        },
        "lockfiles": lockfiles,
    }


class NpmAdapter:
    ecosystem = "npm"

    def inspect(self, path):
        from ...graph import schema

        info = inspect(path)
        info.update(ecosystem="npm", environment=f"node@{schema.current_node_major()}")
        for dependency in info["deps"]:
            dependency.update(ecosystem="npm", id="npm:" + dependency["id"])
        return info

    def run(self, stage, workspace, sink, environment):
        from .. import executor

        if environment.get("kind", "node") != "node":
            raise ValueError("The npm adapter requires a Node environment")
        return getattr(executor, stage)(
            workspace,
            sink,
            node_major=environment["major"],
            node_path=environment.get("path") or None,
        )

    def apply_recipe(self, workspace, recipe):
        from ..executor import apply_recipe

        return apply_recipe(workspace, recipe)

    def import_dependencies(self, project_id, workspace):
        from ...graph.dependencies import import_lock

        return import_lock(project_id, workspace)

    def classify(self, output, signatures):
        from ..verifier import classify

        return classify(output, signatures)

    def verify(self, workspace):
        from .base import verify_static

        return verify_static(workspace)

    def patch_files(self, source, workspace, modified=()):
        return ["package.json", ".npmrc", "package-lock.json"]
