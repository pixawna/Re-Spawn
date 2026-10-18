# Records real Re:Spawn runs (one per graph-rule setting) from a running backend into recordings.json
# for the hosted replay demo:  python3 scripts/record-runs.py  (backend on :8000)
import json, time, urllib.request, re
B="http://localhost:8000"
def req(path, method="GET", body=None):
    r=urllib.request.Request(B+path, method=method, data=json.dumps(body).encode() if body is not None else None, headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(r, timeout=60) as f:
        d=f.read().decode()
        try: return json.loads(d)
        except: return d
P="legacy-todo-app"
out={"health":req("/api/health"),"recordings":{}}
for key,rules in [("default",{"teach_conflict":False,"allow_workarounds":False}),("teach",{"teach_conflict":True,"allow_workarounds":False}),("workaround",{"teach_conflict":False,"allow_workarounds":True})]:
    req(f"/api/projects/{P}/reset","POST")
    rr=req("/api/rules","POST",rules)
    rec={"rules":rr,"projects_before":req("/api/projects"),"map_before":req(f"/api/projects/{P}/map"),"maps":[]}
    run=req(f"/api/projects/{P}/resurrect","POST"); rid=run["id"]
    events=[]
    with urllib.request.urlopen(B+f"/api/runs/{rid}/events", timeout=300) as f:
        for line in f:
            line=line.decode()
            if not line.startswith("data:"): continue
            e=json.loads(line[5:]); events.append(e)
            if e["type"] in ("graph","done","plans","attempt","learned"):
                rec["maps"].append({"seq":e["seq"],"map":req(f"/api/projects/{P}/map")})
            if e["type"]=="diagnosis":
                rec["projects_mid"]=req("/api/projects")
            if e["type"]=="done": break
    rec["events"]=events
    rec["projects_after"]=req("/api/projects")
    rec["patch"]=req(f"/api/runs/{rid}/patch")
    html=req(f"/preview/{rid}/")
    m=re.search(r'<script src="\./([^"]+)"></script>',html)
    js=req(f"/preview/{rid}/{m.group(1)}")
    rec["preview_html"]=html.replace(m.group(0),"<script>"+js.replace("</script>","<\\/script>")+"</script>")
    rec["run_id"]=rid
    out["recordings"][key]=rec
    print(key, len(events), [ (e['n'],e['status']) for e in events if e['type']=='attempt' and e['status']!='running'], events[-1]['t'])
req(f"/api/projects/{P}/reset","POST"); req("/api/rules","POST",{"teach_conflict":False,"allow_workarounds":False})
json.dump(out,open("recordings.json","w"))
