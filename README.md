# Re:Spawn

**A graph-powered agent that finds and runs verified migration paths to bring broken software back to life.**

Built for Graph Hacks, Track 1: *Agents That Act on Connected Data*.

Old projects die quietly. Nobody touched the code, but Node.js moved on, OpenSSL 3 dropped MD4, and now `npm run build` crashes. Re:Spawn digs up a repository, runs its real build in a sandbox, asks **FalkorDB** which recovery routes are feasible, applies the best one, and keeps going until the app builds, passes its tests and serves over HTTP. When a route fails, the agent writes what it learned back into the graph and replans.

You watch all of it happen in a pixel-art graveyard. The graph lives underground, beneath the grave.

---

## What happens in the demo

1. **Graveyard.** `legacy-todo-app` is a real 2020-era app pinned to `webpack@4.46.0` + `webpack-cli@3.3.12`. Click its grave.
2. **Diagnose.** Mori (the tiny reaper) installs the original dependencies and runs the build. It genuinely fails on Node ≥ 17 with `ERR_OSSL_EVP_UNSUPPORTED`. The error is matched against `INCOMPATIBLE_WITH` signatures stored in the graph.
3. **Search the graph.** `find_blockers` → `get_migration_options` → `resolve_prerequisites` → `rank_recovery_plans`. Runtime downgrades are ruled out (Node 16/14 aren't installed and are EOL), the OpenSSL workaround is blocked by policy, and the cheapest feasible route is *upgrade webpack 4 → 5*.
4. **Route 1 fails for real.** npm refuses with `ERESOLVE`: `webpack-cli@3.3.12` declares peer `webpack@4.x.x`. The agent records an `Attempt`, parses the error, and **writes a new relationship**: `(webpack-cli@3)-[:CONFLICTS_WITH {learned:true}]->(webpack@5)`.
5. **Replan.** `find_alternative` now discovers that the webpack 5 migration needs the webpack-cli 3 → 5 migration first. The map lights up a new branch.
6. **Route 2 works.** Fresh sandbox, both upgrades, `npm install`, `npm run build`, `npm test` (8 passing), then an HTTP smoke check of the built site.
7. **Respawn.** The tombstone cracks, a CRT rises, and the *actual repaired app* runs inside its screen. You get a collectible certificate with the before/after versions, the route history and the patch.

Nothing in that sequence is scripted. Every failure is a real npm/webpack error, and every decision is a Cypher query.

### Prove the graph is in charge

Open **Graph rules** on the map and flip one relationship, then press *Resurrect* again:

| Rule in FalkorDB | What the agent does |
| --- | --- |
| Default | Tries webpack 5 alone, fails on a peer conflict, learns it, succeeds on route 2 |
| `webpack-cli@3 CONFLICTS_WITH webpack@5` pre-seeded | Goes straight to *webpack-cli 3 → 5, then webpack 4 → 5*. One attempt |
| `Policy.allow_workarounds = true` | Picks the cheaper OpenSSL legacy-provider workaround (writes `node-options` to `.npmrc`) |

Learned facts persist, so *Resurrect again* benefits from what the previous run discovered. *Forget attempts and learned facts* resets the graph.

---

## Architecture

```
Next.js (pixel UI, React Flow)  ──SSE──▶  FastAPI  ──▶  Agent loop (diagnose → plan → repair → verify)
                                                      │            │
                                                      ▼            ▼
                                                FalkorDB      Sandbox executor
                                          (decisions + memory)  (npm install / build / test, HTTP smoke)
                                                      ▲
                                                 MCP server (same tools for Claude / any MCP client)
```

```
app/, components/        Next.js front end
  GraveyardScene.tsx     320×180 pixel world drawn as crisp SVG
  ResurrectionMap.tsx    live FalkorDB graph (React Flow custom nodes)
  Journal.tsx            agent story, every Cypher query, raw terminal
  Resurrection.tsx       crack → rise → live preview, certificate
lib/sprites.ts           hand-placed pixel sprites
backend/
  main.py                FastAPI: projects, runs (SSE), map, rules, preview, patch
  graph/queries.py       every Cypher query in one file
  graph/planner.py       graph-backed agent tools
  graph/seeds.py         compatibility facts + migration recipes
  graph/schema.py        indexes, seeding, runtime detection
  recovery/              inspector, executor (sandboxed workspaces), verifier
  agent/orchestrator.py  the loop + map assembly
  mcp_server.py          MCP tools
examples/legacy-todo-app the reference patient
```

The LLM is not asked to invent shell commands. Migrations are deterministic recipes stored on `Migration` nodes; the graph decides which ones are legal and in what order.

---

## Graph data model

```
(:Project {id, name, source, status})
(:PackageVersion {id: "webpack@4", name, major})
(:Runtime {id: "node@22", major, available, eol, path})
(:Migration {id, title, kind, cost, risk, why, recipe})
(:Attempt {id, run, plan, outcome, error_class, summary})
(:Verification {build, tests_passed, tests_failed, smoke})
(:Policy {allow_workarounds, eol_penalty})

(Project)-[:USES {range}]->(PackageVersion)
(Project)-[:USED {range}]->(PackageVersion)          history after a migration
(Project)-[:RUNS_ON]->(Runtime)
(PackageVersion)-[:INCOMPATIBLE_WITH {reason, signature}]->(Runtime)
(PackageVersion)-[:CONFLICTS_WITH {reason, learned, evidence}]->(PackageVersion)
(Migration)-[:FROM]->(PackageVersion)
(Migration)-[:TO]->(PackageVersion | Runtime)
(Migration)-[:REQUIRES]->(Migration)
(Project)-[:HAD_ATTEMPT]->(Attempt)-[:TRIED {order}]->(Migration)
(Attempt)-[:PRODUCED]->(Verification)
```

The seed knowledge covers webpack 4/5, webpack-cli, webpack-dev-server, css/style/sass loaders, html-webpack-plugin, react-scripts 3/4/5, node-sass → Dart Sass, OpenSSL workarounds and Node 12–24.

### Key Cypher queries

All of them live in [`backend/graph/queries.py`](backend/graph/queries.py) and are streamed to the UI's *Cypher* tab as they run.

**find_blockers**: a package the project uses is incompatible with the runtime it runs on.
```cypher
MATCH (p:Project {id: $id})-[:USES]->(pv:PackageVersion)-[i:INCOMPATIBLE_WITH]->(rt:Runtime)<-[:RUNS_ON]-(p)
RETURN pv.id AS package, rt.id AS runtime, i.reason AS reason, i.signature AS signature
```

**get_migration_options**: code migrations from the blocked version, and runtimes it is not incompatible with.
```cypher
MATCH (m:Migration)-[:FROM]->(pv:PackageVersion {id: $package})
OPTIONAL MATCH (m)-[:TO]->(t)
RETURN m.id AS id, m.title AS title, m.kind AS kind, m.cost AS cost, m.risk AS risk, t.id AS target

MATCH (pv:PackageVersion {id: $package}), (m:Migration {kind: 'runtime'})-[:TO]->(rt:Runtime)
WHERE NOT (pv)-[:INCOMPATIBLE_WITH]->(rt)
RETURN m.id AS id, rt.id AS target, rt.available AS available, rt.eol AS eol
```

**resolve_prerequisites**: explicit chains, plus conflicts the migration's target would create with packages the project still uses, and the fixes for them.
```cypher
MATCH (m:Migration {id: $mid})-[:REQUIRES*1..4]->(pre:Migration) RETURN DISTINCT pre.id AS id

MATCH (m:Migration {id: $mid})-[:TO]->(t:PackageVersion)-[c:CONFLICTS_WITH]-(other:PackageVersion)<-[:USES]-(p:Project {id: $id})
OPTIONAL MATCH (fix:Migration)-[:FROM]->(other)
WHERE NOT (fix)-[:TO]->(:PackageVersion)-[:CONFLICTS_WITH]-(t)
RETURN other.id AS blocked_by, c.reason AS reason, collect(fix.id) AS fixes
```

**rank_recovery_plans / find_alternative**: reads policy and past failures from the graph.
```cypher
MATCH (p:Policy {id: 'default'}) RETURN p.allow_workarounds AS allow_workarounds, p.eol_penalty AS eol_penalty

MATCH (:Project {id: $id})-[:HAD_ATTEMPT]->(a:Attempt {outcome: 'failed'})
RETURN DISTINCT a.plan AS plan, a.error_class AS error_class, a.summary AS summary
```

**record_attempt / learn_conflict**: the agent's memory.
```cypher
MATCH (p:Project {id: $id})
CREATE (p)-[:HAD_ATTEMPT]->(a:Attempt {id: $aid, run: $run, plan: $plan, outcome: $outcome, ...})
WITH a UNWIND range(0, size($steps) - 1) AS i
MATCH (m:Migration {id: $steps[i]}) CREATE (a)-[:TRIED {order: i}]->(m)

MATCH (a:PackageVersion {id: $a}), (b:PackageVersion {id: $b})
MERGE (a)-[c:CONFLICTS_WITH]->(b)
SET c.reason = $reason, c.learned = true, c.evidence = $evidence
```

Plans are scored as `Σ(cost + risk weight)` plus an EOL penalty for runtime downgrades. A plan is infeasible if a runtime isn't installed, policy blocks it, a conflict has no known fix, or the same plan already failed.

---

## Run it locally

Requirements: Node.js 20+, Python 3.10+, and Docker for FalkorDB. (On Linux with Python 3.12+ you can skip Docker: `pip install falkordblite` gives you embedded FalkorDB. It has no macOS wheels.)

```bash
# 1. FalkorDB
docker compose up -d falkordb          # FalkorDB on localhost:6379, browser on :3001

# 2. Backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
npm run api                            # FastAPI on http://localhost:8000

# 3. Front end (another terminal)
npm install
npm run dev                            # http://localhost:3000
```

Open http://localhost:3000, click **legacy-todo-app**, press **Resurrect**. The first run downloads webpack 4 (≈20 s); later runs use the npm cache.

The FalkorDB browser is at http://localhost:3001 (compose maps it there so it doesn't clash with Next.js). Try `MATCH p=(:Project)-[*1..3]->() RETURN p` after a run.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `FALKORDB_HOST` / `FALKORDB_PORT` / `FALKORDB_PASSWORD` | `localhost` / `6379` | FalkorDB server |
| `RESPAWN_FALKORDB` | `auto` | `server`, `embedded`, or `auto` (server, then embedded) |
| `RESPAWN_DATA` | `~/.respawn` | sandboxes, clones, embedded DB file |
| `RESPAWN_SANDBOX` | `local` | `docker` runs npm in throwaway `node:<major>` containers |
| `RESPAWN_PACE` | `0.45` | seconds between agent steps, so humans can follow |
| `NEXT_PUBLIC_RESPAWN_API` | `http://localhost:8000` | where the UI finds the backend |

### Revive your own repository

Paste a GitHub URL into *Dig up a repository*. Re:Spawn clones it, maps its `package.json` onto the graph and runs the same loop. It repairs what the knowledge base knows (webpack 4, CRA 3/4, node-sass, common loaders). For anything else it diagnoses honestly and stops rather than guessing.

### MCP

The same graph tools are available to any MCP client:

```bash
python -m backend.mcp_server
```

```json
{ "mcpServers": { "respawn": { "command": "python", "args": ["-m", "backend.mcp_server"], "cwd": "/path/to/Re-Spawn" } } }
```

Tools: `find_blockers`, `get_migration_options`, `resolve_prerequisites`, `rank_recovery_plans`, `find_alternative`, `record_attempt`, `learn_conflict`, `resurrect`, `run_status`. With embedded FalkorDB, point the MCP server at a separate `RESPAWN_DATA` or use the Docker FalkorDB so the API and MCP share one graph.

### API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/health` | graph mode, node counts, detected runtimes |
| GET/POST | `/api/projects` | list / add a GitHub repo |
| POST | `/api/projects/{id}/resurrect` | start a run |
| GET | `/api/runs/{run}/events` | Server-Sent Events: phases, tool calls, Cypher, logs |
| GET | `/api/projects/{id}/map` | the resurrection map, assembled from FalkorDB |
| GET/POST | `/api/rules` | read / change graph rules |
| POST | `/api/projects/{id}/reset` | forget attempts and learned facts |
| GET | `/api/runs/{run}/patch` | unified diff of the repair |
| GET | `/preview/{run}/` | the repaired build, served |
| GET | `/api/cypher` | every query the backend can run |

---

## Checks

```bash
npm run lint && npm run build
cd examples/legacy-todo-app && npm install && npm run build   # fails on Node >= 17, by design
```

## Limitations

- npm projects only. Yarn/pnpm lockfiles are ignored and regenerated by npm.
- Local sandbox mode runs npm on the host in a throwaway copy with a scrubbed environment. Use `RESPAWN_SANDBOX=docker` for container isolation.
- "Alive" means install, build, tests and an HTTP smoke check of the built site passed. It is not a full browser test suite.
- Run history (events, previews) lives in memory; attempts and learned facts persist in FalkorDB.

## AI assistance disclosure

This project was built with help from Claude (Anthropic), which wrote much of the code, the pixel sprites and this README under the author's direction. The migration knowledge base, failure behaviour and every demo result were verified by actually running them.
