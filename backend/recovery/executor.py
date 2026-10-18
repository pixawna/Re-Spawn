"""Applies migration recipes in disposable workspaces and runs real commands.

Sandboxing: every attempt gets a fresh copy of the original source under
.respawn/runs/<run>/<attempt>. Set RESPAWN_SANDBOX=docker to run npm inside a
throwaway `node:<major>` container instead of on the host.
"""

from __future__ import annotations

import difflib
import json
import os
import shutil
import subprocess
import time
import signal
import threading
import uuid
from pathlib import Path
from typing import Callable, Optional

IGNORE = shutil.ignore_patterns(
    "node_modules", ".git", "dist", "build", ".next", ".respawn", ".env", ".env.*"
)
LineSink = Callable[[str, str], None]  # (stream, line)


def fresh_workspace(source: Path, dest: Path) -> Path:
    if dest.exists():
        shutil.rmtree(dest)
    for base, dirs, files in os.walk(source):
        dirs[:] = [d for d in dirs if d not in {"node_modules", ".git", "dist", "build", ".next", ".respawn"}]
        if any((Path(base) / name).is_symlink() for name in [*dirs, *files]):
            raise ValueError("Symlinked source files are not supported in recovery workspaces")
    shutil.copytree(source, dest, ignore=IGNORE)
    return dest


def apply_recipe(ws: Path, recipe: list[dict]) -> dict:
    """Edit package.json / .npmrc according to a recipe. Returns runtime override if any."""
    pkg_path = ws / "package.json"
    pkg = json.loads(pkg_path.read_text())
    runtime = None
    for step in recipe:
        op = step["op"]
        if op == "set":
            for field in ("dependencies", "devDependencies"):
                if step["pkg"] in (pkg.get(field) or {}):
                    pkg[field][step["pkg"]] = step["range"]
        elif op == "replace":
            for field in ("dependencies", "devDependencies"):
                deps = pkg.get(field) or {}
                if step["pkg"] in deps:
                    deps.pop(step["pkg"])
                    deps[step["with"]] = step["range"]
                    pkg[field] = dict(sorted(deps.items()))
        elif op == "engines":
            if "engines" in pkg:
                pkg["engines"]["node"] = step["node"]
        elif op == "npmrc":
            rc = ws / ".npmrc"
            lines = rc.read_text().splitlines() if rc.exists() else []
            lines = [line for line in lines if not line.startswith(step["key"] + "=")]
            lines.append(f"{step['key']}={step['value']}")
            rc.write_text("\n".join(lines) + "\n")
        elif op == "runtime":
            runtime = step["node"]
    pkg_path.write_text(json.dumps(pkg, indent=2) + "\n")
    # A lockfile pinned to the old tree would fight the migration; npm regenerates it.
    for lock in ("package-lock.json", "npm-shrinkwrap.json"):
        if (ws / lock).exists():
            (ws / lock).unlink()
    return {"runtime": runtime}


def diff(original: Path, changed: Path) -> str:
    out = []
    for name in ("package.json", ".npmrc", "package-lock.json"):
        a = (
            (original / name).read_text().splitlines(keepends=True)
            if (original / name).exists()
            else []
        )
        b = (
            (changed / name).read_text().splitlines(keepends=True)
            if (changed / name).exists()
            else []
        )
        if a != b:
            out += difflib.unified_diff(a, b, f"a/{name}", f"b/{name}")
    return "".join(out)


def _clean_env(node_path: Optional[str]) -> dict:
    keep = (
        "PATH",
        "HOME",
        "USER",
        "LANG",
        "TMPDIR",
        "SystemRoot",
        "APPDATA",
        "LOCALAPPDATA",
        "npm_config_cache",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
        "https_proxy",
        "http_proxy",
        "no_proxy",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "REQUESTS_CA_BUNDLE",
    )
    env = {k: v for k, v in os.environ.items() if k in keep}
    env["CI"] = "1"
    env["FORCE_COLOR"] = "0"
    env["npm_config_update_notifier"] = "false"
    env["npm_config_fund"] = "false"
    env["npm_config_audit"] = "false"
    if node_path:
        env["PATH"] = str(Path(node_path).parent) + os.pathsep + env.get("PATH", "")
    return env


def run(
    cmd: list[str],
    cwd: Path,
    sink: LineSink,
    timeout: int = 300,
    node_path: Optional[str] = None,
    node_major: Optional[int] = None,
    containerize: bool = True,
) -> dict:
    """Run a command, streaming each output line to `sink`. Returns exit code + tail."""
    sandbox = os.getenv("RESPAWN_SANDBOX", "local")
    container_name = None
    if sandbox == "docker" and containerize:
        container_name = "respawn-exec-" + uuid.uuid4().hex[:12]
        image = f"node:{node_major or 22}"
        cmd = [
            "docker",
            "run",
            "--rm",
            "--name",
            container_name,
            "--network",
            "bridge",
            "-v",
            f"{cwd}:/app",
            "-w",
            "/app",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            "256",
            "--memory",
            "2g",
            "--cpus",
            "2",
            "-e",
            "CI=1",
            image,
        ] + cmd
    started = time.time()
    sink("cmd", "$ " + " ".join(cmd))
    lines: list[str] = []
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            env=_clean_env(node_path),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            start_new_session=True,
        )
    except FileNotFoundError as exc:
        sink("err", str(exc))
        return {"code": 127, "tail": str(exc), "seconds": 0.0, "output": str(exc)}
    assert proc.stdout
    timed_out = threading.Event()

    def terminate():
        timed_out.set()
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    timer = threading.Timer(timeout, terminate)
    timer.daemon = True
    timer.start()
    try:
        for raw in proc.stdout:
            line = raw.rstrip("\n")
            lines.append(line)
            sink("out", line)
            if time.time() - started > timeout:
                proc.kill()
                sink("err", f"timed out after {timeout}s")
                break
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        proc.kill()
    finally:
        timer.cancel()
    if timed_out.is_set() and container_name:
        subprocess.run(["docker", "rm", "-f", container_name], capture_output=True, timeout=30)
    if timed_out.is_set():
        sink("err", f"timed out after {timeout}s")
    code = (
        124
        if timed_out.is_set()
        else (proc.returncode if proc.returncode is not None else 124)
    )
    return {
        "code": code,
        "tail": "\n".join(lines[-40:]),
        "seconds": round(time.time() - started, 1),
        "output": "\n".join(lines),
    }


def npm(
    ws: Path,
    args: list[str],
    sink: LineSink,
    timeout: int = 300,
    node_path: Optional[str] = None,
    node_major: Optional[int] = None,
) -> dict:
    npm_bin = "npm"
    if node_path and os.getenv("RESPAWN_SANDBOX", "local") != "docker":
        cand = Path(node_path).parent / "npm"
        if cand.exists():
            npm_bin = str(cand)
    return run([npm_bin, *args], ws, sink, timeout, node_path, node_major)


def install(ws: Path, sink: LineSink, **kw) -> dict:
    return npm(
        ws,
        ["install", "--no-audit", "--no-fund", "--no-progress"],
        sink,
        timeout=420,
        **kw,
    )


def build(ws: Path, sink: LineSink, **kw) -> dict:
    return npm(ws, ["run", "build"], sink, timeout=240, **kw)


def test(ws: Path, sink: LineSink, **kw) -> dict:
    return npm(ws, ["test"], sink, timeout=180, **kw)
