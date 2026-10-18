"""Ecosystem-neutral inspection facade. No project code executes here."""

from pathlib import Path
from .adapters.npm import major_of


def inspect(path: Path) -> dict:
    from .adapters import get_adapter

    return get_adapter(path).inspect(path)
