"""Every Cypher query Re:Spawn runs, in one place.

Graph model
-----------
(:Project {id, name, source, status})
(:PackageVersion {id: "webpack@4", name, major})
(:Runtime {id: "node@22", name, major, available, eol, path})
(:Migration {id, title, kind, cost, risk, why, recipe})
(:Attempt {id, run, plan, outcome, error_class, summary, at})
(:Verification {id, build, tests_passed, tests_failed, smoke, at})
(:Policy {id: "default", allow_workarounds, eol_penalty})

(Project)-[:USES {range}]->(PackageVersion)
(Project)-[:USED {range}]->(PackageVersion)   # history after a migration
(Project)-[:RUNS_ON]->(Runtime)
(PackageVersion)-[:INCOMPATIBLE_WITH {reason, signature}]->(Runtime)
(PackageVersion)-[:CONFLICTS_WITH {reason, learned, evidence}]->(PackageVersion)
(Migration)-[:FROM]->(PackageVersion)
(Migration)-[:TO]->(PackageVersion | Runtime)
(Migration)-[:REQUIRES {learned}]->(Migration)
(Project)-[:HAD_ATTEMPT]->(Attempt)-[:TRIED {order}]->(Migration)
(Attempt)-[:PRODUCED]->(Verification)
"""

SCHEMA = [
    "CREATE INDEX FOR (n:InstalledPackage) ON (n.id)",
    "CREATE INDEX FOR (n:InstalledPackage) ON (n.project)",
    "CREATE INDEX FOR (n:RecoveryState) ON (n.id)",
    "CREATE INDEX FOR (n:RecoveryState) ON (n.evaluation)",
    "CREATE INDEX FOR (n:RuntimeAPI) ON (n.id)",
    "CREATE INDEX FOR (n:Project) ON (n.id)",
    "CREATE INDEX FOR (n:PackageVersion) ON (n.id)",
    "CREATE INDEX FOR (n:Runtime) ON (n.id)",
    "CREATE INDEX FOR (n:Migration) ON (n.id)",
    "CREATE INDEX FOR (n:Attempt) ON (n.id)",
]

# ---------------------------------------------------------------- seeding
SEED_RUNTIMES = """
UNWIND $rows AS r
MERGE (n:Runtime {id: r.id})
SET n.name = 'node', n.major = r.major, n.available = r.available, n.eol = r.eol, n.path = r.path
"""

SEED_PACKAGES = """
UNWIND $rows AS r
MERGE (n:PackageVersion {id: r.id})
SET n.name = r.name, n.major = r.major
"""

SEED_INCOMPATIBLE = """
UNWIND $rows AS r
MATCH (pv:PackageVersion {id: r.pkg}), (rt:Runtime)
WHERE rt.major >= r.from_major
MERGE (pv)-[i:INCOMPATIBLE_WITH]->(rt)
SET i.reason = r.reason, i.signature = r.signature
"""

SEED_CONFLICT = """
UNWIND $rows AS r
MATCH (a:PackageVersion {id: r.a}), (b:PackageVersion {id: r.b})
MERGE (a)-[c:CONFLICTS_WITH]->(b)
SET c.reason = r.reason, c.learned = coalesce(r.learned, false), c.evidence = coalesce(r.evidence, '')
"""

SEED_MIGRATION = """
UNWIND $rows AS r
MERGE (m:Migration {id: r.id})
SET m.title = r.title, m.kind = r.kind, m.cost = r.cost, m.risk = r.risk, m.why = r.why, m.recipe = r.recipe
WITH m, r
OPTIONAL MATCH (f:PackageVersion {id: r.from})
FOREACH (_ IN CASE WHEN f IS NULL THEN [] ELSE [1] END | MERGE (m)-[:FROM]->(f))
WITH m, r
OPTIONAL MATCH (t {id: r.to})
FOREACH (_ IN CASE WHEN t IS NULL THEN [] ELSE [1] END | MERGE (m)-[:TO]->(t))
"""

SEED_POLICY = """
MERGE (p:Policy {id: 'default'})
ON CREATE SET p.allow_workarounds = false, p.eol_penalty = 3
"""

# ---------------------------------------------------------------- projects
UPSERT_PROJECT = """
MERGE (p:Project {id: $id})
SET p.name = $name, p.source = $source, p.owner = $owner, p.description = $description,
    p.status = coalesce(p.status, 'unverified'), p.added = coalesce(p.added, timestamp())
WITH p
OPTIONAL MATCH (p)-[old:USES|RUNS_ON|USED]->()
DELETE old
"""

LINK_PACKAGES = """
MATCH (p:Project {id: $id})
UNWIND $deps AS d
MERGE (pv:PackageVersion {id: d.id})
ON CREATE SET pv.name = d.name, pv.major = d.major
MERGE (p)-[u:USES]->(pv)
SET u.range = d.range
"""

LINK_RUNTIME = """
MATCH (p:Project {id: $id}), (rt:Runtime {id: $runtime})
MERGE (p)-[:RUNS_ON]->(rt)
"""

SET_STATUS = (
    "MATCH (p:Project {id: $id}) SET p.status = $status, p.updated = timestamp()"
)

LIST_PROJECTS = """
MATCH (p:Project)
OPTIONAL MATCH (p)-[:RUNS_ON]->(rt:Runtime)
OPTIONAL MATCH (p)-[:HAD_ATTEMPT]->(a:Attempt)
RETURN p AS project, rt.id AS runtime, count(a) AS attempts
ORDER BY p.added
"""

PROJECT_PACKAGES = """
MATCH (p:Project {id: $id})-[u:USES]->(pv:PackageVersion)
OPTIONAL MATCH (pv)-[i:INCOMPATIBLE_WITH]->(:Runtime)<-[:RUNS_ON]-(p)
OPTIONAL MATCH (pv)-[c:CONFLICTS_WITH]-(other:PackageVersion)<-[:USES]-(p)
RETURN pv.id AS id, pv.name AS name, pv.major AS major, u.range AS range,
       i.reason AS incompatible, collect(DISTINCT other.id) AS conflicts_with
ORDER BY name
"""

# ---------------------------------------------------------------- agent tools
# find_blockers: a package the project uses is incompatible with the runtime it runs on,
# or two packages it uses conflict with each other.
FIND_RUNTIME_BLOCKERS = """
MATCH (p:Project {id: $id})-[:USES]->(pv:PackageVersion)-[i:INCOMPATIBLE_WITH]->(rt:Runtime)<-[:RUNS_ON]-(p)
RETURN pv.id AS package, rt.id AS runtime, i.reason AS reason, i.signature AS signature
"""

FIND_CONFLICT_BLOCKERS = """
MATCH (p:Project {id: $id})-[:USES]->(a:PackageVersion)-[c:CONFLICTS_WITH]->(b:PackageVersion)<-[:USES]-(p)
RETURN a.id AS package, b.id AS other, c.reason AS reason
"""

# get_migration_options: code migrations that move a blocked package somewhere else,
# plus runtime moves to a Node version the package is not incompatible with.
PACKAGE_MIGRATIONS = """
MATCH (m:Migration)-[:FROM]->(pv:PackageVersion {id: $package})
OPTIONAL MATCH (m)-[:TO]->(t)
RETURN m.id AS id, m.title AS title, m.kind AS kind, m.cost AS cost, m.risk AS risk,
       m.why AS why, t.id AS target
ORDER BY m.cost
"""

RUNTIME_MIGRATIONS = """
MATCH (pv:PackageVersion {id: $package}), (m:Migration {kind: 'runtime'})-[:TO]->(rt:Runtime)
WHERE NOT (pv)-[:INCOMPATIBLE_WITH]->(rt)
RETURN m.id AS id, m.title AS title, m.kind AS kind, m.cost AS cost, m.risk AS risk, m.why AS why,
       rt.id AS target, rt.available AS available, rt.eol AS eol
ORDER BY m.cost
"""

# resolve_prerequisites: explicit REQUIRES chains, plus conflicts the migration's target
# would create with other packages the project still uses (and the fixes for those).
EXPLICIT_PREREQS = """
MATCH (m:Migration {id: $mid})-[:REQUIRES*1..4]->(pre:Migration)
RETURN DISTINCT pre.id AS id
"""

TARGET_CONFLICTS = """
MATCH (m:Migration {id: $mid})-[:TO]->(t:PackageVersion)-[c:CONFLICTS_WITH]-(other:PackageVersion)<-[:USES]-(p:Project {id: $id})
OPTIONAL MATCH (fix:Migration)-[:FROM]->(other)
WHERE NOT (fix)-[:TO]->(:PackageVersion)-[:CONFLICTS_WITH]-(t)
RETURN other.id AS blocked_by, c.reason AS reason, c.learned AS learned, c.source_project AS source_project, c.run_id AS source_run, collect(fix.id) AS fixes
"""

TARGET_STILL_INCOMPATIBLE = """
MATCH (m:Migration {id: $mid})-[:TO]->(t:PackageVersion)-[i:INCOMPATIBLE_WITH]->(rt:Runtime)<-[:RUNS_ON]-(p:Project {id: $id})
RETURN t.id AS target, i.reason AS reason
"""

MIGRATION = "MATCH (m:Migration {id: $mid}) OPTIONAL MATCH (m)-[:TO]->(t) RETURN m, t.id AS target"

POLICY = "MATCH (p:Policy {id: 'default'}) RETURN p.allow_workarounds AS allow_workarounds, p.eol_penalty AS eol_penalty"

FAILED_PLANS = """
MATCH (:Project {id: $id})-[:HAD_ATTEMPT]->(a:Attempt {outcome: 'failed'})
RETURN DISTINCT a.plan AS plan, a.error_class AS error_class, a.summary AS summary
"""

# record_attempt
RECORD_ATTEMPT = """
MATCH (p:Project {id: $id})
CREATE (p)-[:HAD_ATTEMPT]->(a:Attempt {id: $aid, run: $run, plan: $plan, outcome: $outcome,
        error_class: $error_class, summary: $summary, at: timestamp()})
WITH a
UNWIND range(0, size($steps) - 1) AS i
MATCH (m:Migration {id: $steps[i]})
CREATE (a)-[:TRIED {order: i}]->(m)
RETURN a.id AS id
"""

RECORD_VERIFICATION = """
MATCH (a:Attempt {id: $aid})
CREATE (a)-[:PRODUCED]->(v:Verification {id: $vid, build: $build, tests_passed: $tests_passed,
        tests_failed: $tests_failed, smoke: $smoke, at: timestamp()})
RETURN v.id AS id
"""

LEARN_CONFLICT = """
MATCH (a:PackageVersion {id: $a}), (b:PackageVersion {id: $b})
MERGE (a)-[c:CONFLICTS_WITH]->(b)
SET c.reason = $reason, c.learned = true, c.evidence = $evidence, c.source_project=$source_project, c.run_id=$run_id
RETURN a.id AS a, b.id AS b
"""

# Applying a successful plan moves the project's USES edges to the new versions.
APPLY_MIGRATION_TO_PROJECT = """
MATCH (p:Project {id: $id})-[u:USES]->(f:PackageVersion)<-[:FROM]-(m:Migration {id: $mid})-[:TO]->(t:PackageVersion)
MERGE (p)-[old:USED]->(f)
SET old.range = u.range
DELETE u
MERGE (p)-[nu:USES]->(t)
SET nu.range = $range
"""

# ---------------------------------------------------------------- map (visualisation read)
MAP_PROJECT = """
MATCH (p:Project {id: $id})
OPTIONAL MATCH (p)-[:RUNS_ON]->(rt:Runtime)
RETURN p AS project, rt AS runtime
"""

MAP_ATTEMPTS = """
MATCH (:Project {id: $id})-[:HAD_ATTEMPT]->(a:Attempt)-[t:TRIED]->(m:Migration)
OPTIONAL MATCH (a)-[:PRODUCED]->(v:Verification)
RETURN a.id AS attempt, a.run AS run, a.outcome AS outcome, a.plan AS plan, a.error_class AS error_class,
       a.summary AS summary, a.at AS at, m.id AS migration, t.order AS ord, v AS verification
ORDER BY a.at, t.order
"""

LEARNED_CONFLICTS = """
MATCH (a:PackageVersion)-[c:CONFLICTS_WITH {learned: true}]->(b:PackageVersion)
RETURN a.id AS a, b.id AS b, c.reason AS reason, c.evidence AS evidence, c.source_project AS source_project, c.run_id AS source_run
"""

RETIRED_PACKAGES = """
MATCH (p:Project {id: $id})-[u:USED]->(pv:PackageVersion)
OPTIONAL MATCH (pv)-[i:INCOMPATIBLE_WITH]->(rt:Runtime)<-[:RUNS_ON]-(p)
RETURN pv.id AS id, pv.name AS name, pv.major AS major, u.range AS range, i.reason AS incompatible, rt.id AS runtime
"""

# ---------------------------------------------------------------- reset / rules
RESET_ATTEMPTS = """
MATCH (:Project {id: $id})-[:HAD_ATTEMPT]->(a:Attempt)
OPTIONAL MATCH (a)-[:PRODUCED]->(v:Verification)
DETACH DELETE a, v
"""

FORGET_LEARNED = "MATCH ()-[c:CONFLICTS_WITH {learned: true}]->() DELETE c"

FORGET_CONFLICT = "MATCH (:PackageVersion {id: $a})-[c:CONFLICTS_WITH]-(:PackageVersion {id: $b}) DELETE c"

HAS_CONFLICT = "MATCH (:PackageVersion {id: $a})-[c:CONFLICTS_WITH]-(:PackageVersion {id: $b}) RETURN c.learned AS learned"

SET_POLICY = (
    "MATCH (p:Policy {id: 'default'}) SET p.allow_workarounds = $allow_workarounds"
)

DELETE_PROJECT = """
MATCH (p:Project {id: $id})
OPTIONAL MATCH (p)-[:HAD_ATTEMPT]->(a:Attempt)
OPTIONAL MATCH (a)-[:PRODUCED]->(v:Verification)
DETACH DELETE p, a, v
"""

STATS = """
MATCH (n) WITH labels(n)[0] AS label, count(n) AS c RETURN label, c ORDER BY label
"""
