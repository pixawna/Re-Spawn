"""Detect once, then use the same adapter throughout a recovery session."""

from pathlib import Path
from .base import Adapter, environment_label


def get_adapter(path: Path) -> Adapter:
    from .npm import NpmAdapter
    from .python import PythonAdapter

    if (path / "package.json").is_file():
        return NpmAdapter()
    if any(
        (path / name).is_file()
        for name in ("requirements.txt", "pyproject.toml", "setup.py")
    ):
        return PythonAdapter()
    raise FileNotFoundError(
        "No supported manifest at the repository root. Supported: package.json, requirements.txt, pyproject.toml, setup.py."
    )
