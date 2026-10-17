"""Failure classification and post-repair verification (tests + real HTTP smoke check)."""
from __future__ import annotations

import functools
import http.server
import re
import threading
import urllib.request
from pathlib import Path
from typing import Optional

from ..recovery.inspector import major_of


def classify(output: str, signatures: list[dict]) -> dict:
    """Turn raw npm output into a structured failure. Signatures come from the graph's
    INCOMPATIBLE_WITH edges, so the graph also drives diagnosis."""
    for sig in signatures:
        if sig.get("signature") and re.search(sig["signature"], output):
            return {"class": "runtime_incompatibility", "package": sig["package"], "runtime": sig.get("runtime"),
                    "summary": sig["reason"], "match": re.search(sig["signature"], output).group(0)}
    if "ERESOLVE" in output:
        # npm: 'peer webpack@"4.x.x" from webpack-cli@3.3.12' and 'Found: webpack@5.112.0'
        peer = re.search(r'peer ([@\w./-]+)@"([^"]+)" from ([@\w./-]+)@(\d[\w.-]*)', output)
        found = re.search(r"Found: ([@\w./-]+)@(\d[\w.-]*)", output)
        if peer:
            wanted_pkg, wanted_range, owner, owner_ver = peer.groups()
            found_major = major_of(found.group(2)) if found and found.group(1) == wanted_pkg else None
            return {
                "class": "peer_conflict",
                "summary": f"{owner}@{owner_ver} needs {wanted_pkg}@{wanted_range}"
                           + (f", but the plan installs {wanted_pkg}@{found_major}" if found_major else ""),
                "owner": f"{owner}@{major_of(owner_ver)}",
                "target": f"{wanted_pkg}@{found_major}" if found_major is not None else None,
                "match": peer.group(0),
            }
        return {"class": "peer_conflict", "summary": "npm could not resolve the dependency tree", "match": "ERESOLVE"}
    if "ETARGET" in output or "notarget" in output:
        return {"class": "missing_version", "summary": "A requested package version does not exist", "match": "ETARGET"}
    if re.search(r"ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network", output):
        return {"class": "network", "summary": "The registry could not be reached", "match": "network"}
    if re.search(r"Module not found|Cannot find module", output):
        m = re.search(r"(Module not found[^\n]*|Cannot find module[^\n]*)", output)
        return {"class": "missing_module", "summary": m.group(0)[:200] if m else "Missing module", "match": "module"}
    tail = [line for line in output.splitlines() if line.strip()][-1:] or ["unknown"]
    return {"class": "unknown", "summary": tail[0][:200], "match": ""}


def count_tests(output: str) -> dict:
    passed = failed = 0
    for pat_p, pat_f in ((r"(\d+) passing", r"(\d+) failing"),
                         (r"Tests:\s+(?:\d+ failed, )?(\d+) passed", r"Tests:\s+(\d+) failed"),
                         (r"# pass (\d+)", r"# fail (\d+)"),
                         (r"(\d+) tests? passed", r"(\d+) tests? failed"),
                         (r"Tests\s+(\d+) passed", r"Tests\s+(\d+) failed")):
        p = re.search(pat_p, output)
        if p:
            passed = int(p.group(1))
            f = re.search(pat_f, output)
            failed = int(f.group(1)) if f else 0
            break
    return {"passed": passed, "failed": failed}


def output_dir(ws: Path) -> Optional[Path]:
    for name in ("dist", "build", "out", "public"):
        d = ws / name
        if (d / "index.html").exists():
            return d
    return None


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D401
        pass


def smoke(site: Path) -> dict:
    """Serve the build over real HTTP and fetch the page plus every local script it references."""
    handler = functools.partial(_Quiet, directory=str(site))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    checks = []
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=10) as r:
            html = r.read().decode("utf8", "replace")
            checks.append({"url": "/", "status": r.status, "bytes": len(html)})
        for src in re.findall(r'<script[^>]+src="([^"]+)"', html):
            if src.startswith("http"):
                continue
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/{src.lstrip('./')}", timeout=10) as r:
                body = r.read()
                checks.append({"url": src, "status": r.status, "bytes": len(body)})
        ok = all(c["status"] == 200 and c["bytes"] > 0 for c in checks) and len(checks) >= 1
        return {"ok": ok, "checks": checks, "port": port}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "checks": checks, "error": str(exc)}
    finally:
        server.shutdown()
