"""Python 3.12 adapter: static manifest/source inspection and isolated execution.

No project code is imported during inspection. Execution uses a fresh virtualenv,
inside a resource-limited Docker container for cloned repositories.
"""

from __future__ import annotations
import ast
import json
import os
import re
import sys
from pathlib import Path

try:
    import tomllib
except ImportError:
    import tomli as tomllib
from packaging.requirements import Requirement
from packaging.specifiers import SpecifierSet
from packaging.utils import canonicalize_name

IGNORED = {
    "node_modules",
    ".git",
    ".venv",
    ".respawn-venv",
    "__pycache__",
    "dist",
    "build",
}
DISTUTILS_IMPORT = "from distutils.version import StrictVersion"


def python_sources(path):
    count = 0
    for base, directories, files in os.walk(path, followlinks=False):
        directories[:] = [
            d
            for d in directories
            if d not in IGNORED and not (Path(base) / d).is_symlink()
        ]
        for name in sorted(files):
            source = Path(base) / name
            if source.suffix != ".py" or source.is_symlink():
                continue
            count += 1
            if count > 1000 or source.stat().st_size > 2_000_000:
                raise ValueError(
                    "Python source inspection exceeds the supported size limit"
                )
            yield source


def requirements(path):
    entries = []
    for line in (
        (path / "requirements.txt").read_text().splitlines()
        if (path / "requirements.txt").exists()
        else []
    ):
        line = line.split(" #", 1)[0].strip()
        if line and not line.startswith("#"):
            entries.append(line)
    return entries


def metadata(path):
    data = {}
    if (path / "pyproject.toml").exists():
        data = tomllib.loads((path / "pyproject.toml").read_text()).get("project", {})
    if not data and (path / "setup.py").exists():
        for node in ast.walk(ast.parse((path / "setup.py").read_text())):
            if isinstance(node, ast.Call) and (
                (isinstance(node.func, ast.Name) and node.func.id == "setup")
                or (isinstance(node.func, ast.Attribute) and node.func.attr == "setup")
            ):
                for kw in node.keywords:
                    if kw.arg in (
                        "name",
                        "version",
                        "description",
                        "install_requires",
                        "python_requires",
                    ):
                        try:
                            data[kw.arg] = ast.literal_eval(kw.value)
                        except (ValueError, TypeError):
                            pass
    return data


class PythonAdapter:
    ecosystem = "pypi"

    def inspect(self, path):
        project = metadata(path)
        constraint = project.get("requires-python", project.get("python_requires", ""))
        if constraint and not SpecifierSet(constraint).contains("3.12"):
            raise ValueError(
                "This Python adapter executes Python 3.12. The declared requires-python constraint excludes it."
            )
        deps = {}
        supported_import = False
        declared = (
            requirements(path)
            if (path / "requirements.txt").exists()
            else project.get("dependencies", project.get("install_requires", []))
        )
        for entry in declared:
            try:
                req = Requirement(entry)
            except Exception as exc:
                raise ValueError(
                    f"Only PEP 508 requirements are supported: {entry}"
                ) from exc
            if req.marker and not req.marker.evaluate(
                {
                    "python_version": "3.12",
                    "python_full_version": "3.12.0",
                    "sys_platform": (
                        "linux"
                        if os.getenv("RESPAWN_SANDBOX") == "docker"
                        else sys.platform
                    ),
                }
            ):
                continue
            name = canonicalize_name(req.name)
            specs = sorted(req.specifier, key=lambda s: s.operator != "==")
            match = next(
                (
                    re.match(r"(\d+)", spec.version)
                    for spec in specs
                    if re.match(r"(\d+)", spec.version)
                ),
                None,
            )
            if match:
                major = int(match.group(1))
                deps[name] = {
                    "id": f"pypi:{name}@{major}",
                    "ecosystem": "pypi",
                    "name": name,
                    "major": major,
                    "range": str(req.specifier),
                    "field": "requirements",
                }
        for source in python_sources(path):
            try:
                tree = ast.parse(source.read_text())
            except SyntaxError:
                continue
            for node in ast.walk(tree):
                if (
                    isinstance(node, ast.ImportFrom)
                    and node.module == "distutils.version"
                    and len(node.names) == 1
                    and node.names[0].name == "StrictVersion"
                    and node.names[0].asname is None
                    and ast.get_source_segment(source.read_text(), node)
                    == DISTUTILS_IMPORT
                ):
                    supported_import = True
                if (
                    isinstance(node, ast.ImportFrom)
                    and node.module
                    and node.module.split(".")[0] == "distutils"
                ):
                    deps["python-stdlib:distutils"] = {
                        "id": "python-stdlib:distutils@3",
                        "ecosystem": "python-stdlib",
                        "name": "distutils",
                        "major": 3,
                        "range": "stdlib <3.12",
                        "field": "source-import",
                        "source": f"{source.relative_to(path)}:{node.lineno}",
                    }
                elif isinstance(node, ast.Import) and any(
                    alias.name.split(".")[0] == "distutils" for alias in node.names
                ):
                    deps["python-stdlib:distutils"] = {
                        "id": "python-stdlib:distutils@3",
                        "ecosystem": "python-stdlib",
                        "name": "distutils",
                        "major": 3,
                        "range": "stdlib <3.12",
                        "field": "source-import",
                        "source": f"{source.relative_to(path)}:{node.lineno}",
                    }
        return {
            "name": project.get("name", path.name),
            "version": project.get("version", ""),
            "description": project.get("description", ""),
            "ecosystem": "pypi",
            "supported_migrations": (
                ["mig:python-distutils-packaging"]
                if supported_import and (path / "requirements.txt").exists()
                else []
            ),
            "environment": "python@3.12",
            "engines": constraint,
            "deps": list(deps.values()),
            "scripts": {
                "build": "python build.py" if (path / "build.py").exists() else "",
                "test": (
                    "python -m unittest discover -s tests -v"
                    if (path / "tests").is_dir()
                    else ""
                ),
            },
            "lockfiles": [
                name
                for name in ("requirements.txt", "pyproject.toml")
                if (path / name).exists()
            ],
        }

    def run(self, stage, workspace, sink, environment):
        from .. import executor

        if environment.get("kind") != "python":
            raise ValueError("The Python adapter requires a Python environment")
        if not environment.get("available"):
            raise ValueError(
                "Python 3.12 is unavailable. Enable the Docker sandbox or install the matching interpreter."
            )
        docker = os.getenv("RESPAWN_SANDBOX", "local") == "docker"
        bootstrap = "python" if docker else environment["path"]
        venv = "/app/.respawn-venv" if docker else str(workspace / ".respawn-venv")
        python = venv + "/bin/python"

        def execute(command, timeout=240):
            return executor.run(
                command,
                workspace,
                sink,
                timeout=timeout,
                image=f"python:{environment['version']}-slim",
            )

        if stage == "install":
            result = execute([bootstrap, "-m", "venv", venv])
            if result["code"]:
                return result
            if (workspace / "requirements.txt").exists():
                command = [
                    python,
                    "-m",
                    "pip",
                    "install",
                    "--disable-pip-version-check",
                    "-r",
                    "requirements.txt",
                ]
            elif (workspace / "pyproject.toml").exists() or (
                workspace / "setup.py"
            ).exists():
                command = [
                    python,
                    "-m",
                    "pip",
                    "install",
                    "--disable-pip-version-check",
                    ".",
                ]
            else:
                return result
            return execute(command, timeout=420)
        if stage == "build":
            return execute([python, "build.py"])
        if stage == "test":
            return execute([python, "-m", "unittest", "discover", "-s", "tests", "-v"])
        raise ValueError("Unsupported Python execution stage")

    def apply_recipe(self, workspace, recipe):
        modified = set()
        for step in recipe:
            if step["op"] == "set" and step.get("ecosystem") == "pypi":
                req = Requirement(step["pkg"] + step["range"])
                path = workspace / "requirements.txt"
                lines = path.read_text().splitlines() if path.exists() else []
                retained = []
                for line in lines:
                    try:
                        same = canonicalize_name(
                            Requirement(line).name
                        ) == canonicalize_name(req.name)
                    except Exception:
                        same = False
                    if not same:
                        retained.append(line)
                path.write_text("\n".join(retained + [str(req)]) + "\n")
                modified.add("requirements.txt")
            elif step["op"] == "source_replace":
                if (
                    step["old"] != DISTUTILS_IMPORT
                    or step["new"]
                    != "from packaging.version import Version as StrictVersion"
                ):
                    raise ValueError(
                        "Python source migration is not a supported tested recipe"
                    )
                replaced = 0
                for source in python_sources(workspace):
                    contents = source.read_text()
                    try:
                        tree = ast.parse(contents)
                    except SyntaxError:
                        continue
                    lines = contents.splitlines(keepends=True)
                    imports = [
                        node
                        for node in ast.walk(tree)
                        if isinstance(node, ast.ImportFrom)
                        and node.module == "distutils.version"
                        and len(node.names) == 1
                        and node.names[0].name == "StrictVersion"
                        and node.names[0].asname is None
                        and node.lineno == node.end_lineno
                    ]
                    changed = False
                    for node in sorted(
                        imports, key=lambda item: item.lineno, reverse=True
                    ):
                        line = lines[node.lineno - 1]
                        if line[node.col_offset : node.end_col_offset] == step["old"]:
                            lines[node.lineno - 1] = (
                                line[: node.col_offset]
                                + step["new"]
                                + line[node.end_col_offset :]
                            )
                            replaced += 1
                            changed = True
                    if changed:
                        source.write_text("".join(lines))
                        modified.add(str(source.relative_to(workspace)))
                if not replaced:
                    raise ValueError(
                        "Migration prerequisite failed: expected distutils import was not found"
                    )
            else:
                raise ValueError(f"Unsupported Python recipe operation: {step['op']}")
        return {"runtime": None, "files": sorted(modified)}

    def import_dependencies(self, project_id, workspace):
        # Exact source-import evidence remains on USES; do not invent a pip lock graph.
        return {
            "imported": False,
            "packages": 0,
            "reason": "Python manifest and source imports mapped to Artifact nodes; a resolved pip transitive import is not implemented.",
        }

    def classify(self, output, signatures):
        from ..verifier import classify

        result = classify(output, signatures)
        if result["class"] != "unknown":
            return result
        missing = re.search(
            r"ModuleNotFoundError: No module named ['\"]([^'\"]+)", output
        )
        if missing:
            return {
                "class": "missing_module",
                "summary": f"Python module {missing.group(1)} is unavailable",
                "match": missing.group(0),
            }
        if (
            "Failed building wheel" in output
            or "subprocess-exited-with-error" in output
        ):
            return {
                "class": "wheel_build",
                "summary": "A Python wheel or build dependency could not be built",
                "match": "wheel",
            }
        return result

    def verify(self, workspace):
        from .base import verify_static

        return verify_static(workspace)

    def patch_files(self, source, workspace, modified=()):
        files = {"requirements.txt", "pyproject.toml", "setup.py"}
        for name in modified:
            file = workspace / name
            if (
                not file.resolve().is_relative_to(workspace.resolve())
                or file.is_symlink()
            ):
                raise ValueError("Python patch escapes the verified workspace")
            if file.suffix == ".py":
                files.add(name)
        return sorted(files)
