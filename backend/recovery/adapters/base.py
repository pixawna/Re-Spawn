"""The shared agent calls this contract; ecosystem commands stay in adapters."""

from pathlib import Path
from typing import Protocol


def environment_label(environment: dict) -> str:
    kind = environment.get("kind", "node")
    name = {"node": "Node.js", "python": "Python", "jdk": "JDK"}.get(kind, kind)
    return f"{name} {environment.get('version', environment.get('major', ''))}"


def verify_static(workspace: Path) -> dict:
    from .. import verifier

    output = verifier.output_dir(workspace)
    result = (
        verifier.smoke(output)
        if output
        else {
            "ok": False,
            "checks": [],
            "error": "No static application output; verification is incomplete",
        }
    )
    return {
        **result,
        "preview": output,
        "scope": "build, declared tests, and HTTP asset smoke checks; no automatic browser interaction test",
    }


class Adapter(Protocol):
    ecosystem: str

    def inspect(self, path: Path) -> dict: ...
    def run(self, stage: str, workspace: Path, sink, environment: dict) -> dict: ...
    def apply_recipe(self, workspace: Path, recipe: list[dict]) -> dict: ...
    def import_dependencies(self, project_id: str, workspace: Path) -> dict: ...
    def classify(self, output: str, signatures: list[dict]) -> dict: ...
    def verify(self, workspace: Path) -> dict: ...
    def patch_files(self, source: Path, workspace: Path, modified=()) -> list[str]: ...
