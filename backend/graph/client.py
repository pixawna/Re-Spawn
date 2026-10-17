"""FalkorDB connection + an instrumented query helper.

Every Cypher statement the agent runs goes through `run()`, which times it and
forwards it to the active listener (the live run's event stream). That is how the
UI can show exactly which graph queries led to each decision.
"""
from __future__ import annotations

import contextvars
import os
import threading
import time
from pathlib import Path
from typing import Any, Callable, Optional

GRAPH_NAME = os.getenv("RESPAWN_GRAPH", "respawn")
# Outside the repo on purpose: sandboxes contain node_modules, which would flood the Next.js file watcher.
DATA_DIR = Path(os.getenv("RESPAWN_DATA", Path.home() / ".respawn"))

_lock = threading.RLock()
_graph = None
_mode = "disconnected"
_detail = ""

# Listener receives (cypher, params, rows, elapsed_ms, tag).
QueryListener = Callable[[str, dict, int, float, str], None]
_listener: contextvars.ContextVar[Optional[QueryListener]] = contextvars.ContextVar("listener", default=None)


def set_listener(fn: Optional[QueryListener]):
    return _listener.set(fn)


def reset_listener(token) -> None:
    _listener.reset(token)


def connect():
    """Connect to a FalkorDB server, falling back to embedded FalkorDB Lite."""
    global _graph, _mode, _detail
    with _lock:
        if _graph is not None:
            return _graph
        host = os.getenv("FALKORDB_HOST", "localhost")
        port = int(os.getenv("FALKORDB_PORT", "6379"))
        password = os.getenv("FALKORDB_PASSWORD") or None
        want = os.getenv("RESPAWN_FALKORDB", "auto")  # auto | server | embedded

        if want in ("auto", "server"):
            try:
                from falkordb import FalkorDB

                db = FalkorDB(host=host, port=port, password=password, socket_timeout=5)
                g = db.select_graph(GRAPH_NAME)
                g.query("RETURN 1")
                _graph, _mode, _detail = g, "server", f"{host}:{port}"
                return _graph
            except Exception as exc:  # noqa: BLE001
                if want == "server":
                    raise RuntimeError(f"Could not reach FalkorDB at {host}:{port}: {exc}") from exc

        try:
            from redislite.falkordb_client import FalkorDB as EmbeddedFalkorDB
        except ImportError as exc:
            raise RuntimeError(
                "No FalkorDB server on localhost:6379 and falkordblite is not installed. "
                "Run `docker compose up falkordb` or `pip install falkordblite`."
            ) from exc
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        db = EmbeddedFalkorDB(str(DATA_DIR / "falkordb.rdb"))
        _graph, _mode, _detail = db.select_graph(GRAPH_NAME), "embedded", "FalkorDB Lite (embedded)"
        return _graph


def status() -> dict:
    return {"mode": _mode, "detail": _detail, "graph": GRAPH_NAME}


def _plain(value: Any) -> Any:
    """Convert FalkorDB result objects to JSON-friendly values."""
    if hasattr(value, "properties") and hasattr(value, "labels"):
        props = dict(value.properties)
        props["_labels"] = list(value.labels)
        return props
    if hasattr(value, "properties") and hasattr(value, "relation"):
        props = dict(value.properties)
        props["_type"] = value.relation
        return props
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def run(cypher: str, params: Optional[dict] = None, tag: str = "", quiet: bool = False) -> list[dict]:
    """Run a query and return rows as dicts keyed by column alias."""
    g = connect()
    params = params or {}
    started = time.perf_counter()
    with _lock:
        res = g.query(cypher, params)
    elapsed = (time.perf_counter() - started) * 1000
    header = [h[1] if isinstance(h, (list, tuple)) else h for h in (res.header or [])]
    rows = [{header[i]: _plain(v) for i, v in enumerate(r)} for r in (res.result_set or [])]
    listener = _listener.get()
    if listener and not quiet:
        listener(" ".join(cypher.split()), params, len(rows), elapsed, tag)
    return rows
