# Records real Re:Spawn runs from a running backend into recordings.json for the hosted replay demo.
#   python3 scripts/record-runs.py [out.json]      (backend on :8000)
# Projects run in order, so later patients reuse what the graph learned from earlier ones.
import json, re, sys, urllib.request, urllib.error

B = "http://localhost:8000"


def req(path, method="GET", body=None):
    r = urllib.request.Request(
        B + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(r, timeout=120) as f:
            d = f.read().decode()
    except urllib.error.HTTPError:
        return None
    try:
        return json.loads(d)
    except ValueError:
        return d


def inline_preview(rid):
    html = req(f"/preview/{rid}/")
    if not isinstance(html, str):
        return None
    for m in re.finditer(r'<script([^>]*) src="\./([^"]+)"([^>]*)></script>', html):
        js = req(f"/preview/{rid}/{m.group(2)}") or ""
        html = html.replace(m.group(0), "<script>" + str(js).replace("</script", "<\\/script") + "</script>")
    for m in re.finditer(r'<link[^>]*href="\./([^"]+\.css)"[^>]*>', html):
        css = req(f"/preview/{rid}/{m.group(1)}") or ""
        html = html.replace(m.group(0), "<style>" + str(css) + "</style>")
    return html


req("/api/rules", "POST", {"teach_conflict": False, "allow_workarounds": False})
ids = [p["id"] for p in req("/api/projects")]
for pid in ids:
    req(f"/api/projects/{pid}/reset", "POST")

out = {"health": req("/api/health"), "projects_initial": req("/api/projects"), "rules": req("/api/rules"), "projects": {}}
for pid in ids:
    rec = {"map_before": req(f"/api/projects/{pid}/map"), "maps": [], "get": {}}
    rid = req(f"/api/projects/{pid}/resurrect", "POST")["id"]
    events = []
    with urllib.request.urlopen(B + f"/api/runs/{rid}/events", timeout=600) as f:
        for line in f:
            line = line.decode()
            if not line.startswith("data:"):
                continue
            e = json.loads(line[5:])
            events.append(e)
            if e["type"] in ("graph", "done", "plans", "attempt", "learned", "diagnosis"):
                rec["maps"].append({"seq": e["seq"], "map": req(f"/api/projects/{pid}/map")})
            if e["type"] == "done":
                break
    rec["events"] = events
    rec["run_id"] = rid
    rec["projects_after"] = req("/api/projects")
    g = rec["get"]
    for path in [
        f"/api/projects/{pid}/why-chains",
        f"/api/projects/{pid}/plan",
        f"/api/projects/{pid}/reports",
        f"/api/runs/{rid}",
        f"/api/runs/{rid}/report",
        f"/api/runs/{rid}/report?format=markdown",
        f"/api/runs/{rid}/report?format=html",
        f"/api/runs/{rid}/certificate",
        f"/api/runs/{rid}/patch",
    ]:
        g[path] = req(path)
    g["what-if"] = req(f"/api/projects/{pid}/what-if", "POST", {"allow_workarounds": True})
    cert = g.get(f"/api/runs/{rid}/certificate") or {}
    if isinstance(cert, dict) and cert.get("preview"):
        g[cert["preview"]] = inline_preview(rid)
    out["projects"][pid] = rec
    attempts = [(e.get("n"), e.get("status")) for e in events if e["type"] == "attempt" and e.get("status") != "running"]
    print(pid, rid, len(events), attempts, events[-1].get("t"))

json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else "recordings.json", "w"))
