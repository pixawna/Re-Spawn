# Feature verification — 18 October 2026

The feature additions were checked against a real local FalkorDB server using isolated graphs and disposable project workspaces. Existing graph history was not reset.

## Checks completed

- `RESPAWN_TEST_GRAPH=1 .venv/bin/python -m pytest -q tests`: **33 passed**, including actual MCP SDK client/server communication, model-selected tool calls with a test provider, fallback behavior, weighted FalkorDB paths, shared learning, counterfactual isolation, approvals, read-only query enforcement, and draft PR payloads with a mocked GitHub server.
- `npm run lint`: passed.
- `npm run build`: passed, including TypeScript checks.
- Real `legacy-todo-app` recovery: the original webpack build failed; the first migration failed with an npm peer conflict; the graph learned that conflict and chose a successful two-migration alternative. Eight behavioral tests and HTTP asset checks passed.
- Real `legacy-kanban-app` recovery: reused the conflict learned from the to-do project, skipped the failing route, and passed six behavioral tests plus HTTP asset checks in one attempt.
- Dependency import: **422 packages and 742 dependency edges**, with no unresolved references for the to-do example.
- Multi-hop evidence displayed in the UI: project → lockfile → webpack-cli → webpack → `crypto.createHash(md4)` → Node runtime. The API edge is supported by inspected webpack source.
- Approval flow: enabling the workaround policy in the isolated graph made the risky route cheapest. Execution paused before any recipe was applied. Rejection caused the graph to select the safe alternative, which passed verification. The original policy was restored afterward.
- Docker execution: the to-do example was rebuilt, tested, and recovered using throwaway official Node containers. The final certificate reported build success, eight passing tests, zero failures, and passing HTTP checks.
- Browser interaction: added a task in the actual repaired app's preview, then marked it complete. Fixed the preview policy so JavaScript form handlers work while native form navigation remains blocked.

## Credential-dependent checks

No live Anthropic request or GitHub publication was made. The local keys were absent. Model protocol handling and draft PR contents were verified with test doubles; those are not evidence of live provider behavior.

Set `ANTHROPIC_API_KEY` in the ignored root `.env` to enable Claude + MCP and Ask Mori, then restart the API. `GITHUB_TOKEN` is needed only for the explicit draft PR action on an imported repository that passes verification.

## Verification scope

Automatic certificates cover the production build, declared tests, and HTTP asset smoke checks. The successful browser interaction above was a manual development check, not an automatic browser test suite for every project. A build with incomplete verification is reported as `build-passing`.

The frontend and API remain local services. All changes are uncommitted for review.
