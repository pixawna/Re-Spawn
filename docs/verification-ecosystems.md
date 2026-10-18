# Ecosystem expansion verification — 2026-10-18

Validation used an isolated FalkorDB graph (`respawn_ecosystem_validation`) and disposable Docker sandboxes. The repository's original examples remain intentionally broken.

## Automated checks

- `RESPAWN_TEST_GRAPH=1 .venv/bin/python -m pytest tests -q`: **51 passed**. Covers namespace collisions, static metadata inspection, source edits and symlink boundaries, unsupported recipe filtering, source evidence retained per project after repair, Python-only environment options, real FalkorDB weighted planning, and an idempotent legacy-schema migration preserving learned edges.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript and production page generation.
- `git diff --check`: passed.

Run pytest against `tests/`: examples intentionally contain broken project tests and are verified through recovery sandboxes instead.

## Real executions

| Patient | Original failure | Graph-selected recovery | Result |
| --- | --- | --- | --- |
| legacy-python-report | ModuleNotFoundError: distutils, Python 3.12 Docker | Install packaging 24.2, then replace StrictVersion import | Build passed; 6 tests passed, 0 failed; HTTP smoke 200; alive in one attempt |
| legacy-todo-app | webpack 4 / OpenSSL MD4 failure on Node 26 Docker | First webpack-only route failed with npm peer conflict; graph learned conflict and replanned webpack-cli + webpack upgrades | Build passed; 8 tests passed, 0 failed; HTTP smoke succeeded; alive in two attempts |

Final Python run: `run-d20716b4`, duration 6.4 seconds. npm regression run: `run-25132519`. These identifiers describe this local validation session, not persistent public demo URLs. Events/certificates are in-memory API state and do not survive an API restart.

## Browser check

At localhost:3000 the Python grave opens the shared map and journal. The certificate shows Python 3.12, six passing tests, one route and HTTP 200, with the repaired report in the preview. After success, Why chain still traces `report.py:3 → distutils → python@3.12`, using the historical USED edge. Source changes and dependency pins appear in the downloadable patch.

No live Anthropic or GitHub request was made during these checks. Their existing credential-gated integrations are not claimed as validated by these results. Java, Dockerfile, CI, Kubernetes, changelog ingestion and generalized NumPy repairs remain roadmap work.
