# Reports and Learn mode verification — 2026-10-18

Implemented in the existing application. No game score gates the map, reports, compatibility facts or routes.

## Application tests

The backend suite covers report handling for failed runs, controller switches, query attribution, feasible alternatives vs exclusions, actual reuse references, HTML escaping and Markdown fences, download headers, report lookup after loss of live run state, and reuse across saved reports. Game tests cover collision/boundaries, reachability of all five runes, missing evidence, and Python-specific lesson facts. Run commands are in the README.

## Real recoveries

A fresh isolated FalkorDB graph (`respawn_report_validation`) and disposable Docker sandboxes were used.

- npm `run-089e598e`: actual OpenSSL failure; initial webpack-only route failed with a peer conflict; one learned conflict; replan upgraded CLI then webpack; 8 tests passed with HTTP smoke checks. Report captured 126 Cypher queries and all four planning snapshots (selection and execution revalidation for each attempt).
- Python `run-81393ae5`: actual missing distutils on Python 3.12; packaging prerequisite and supported import migration; 6 tests and HTTP smoke passed.
- A second npm patient checks cross-project reuse of the first run’s learned conflict. Reuse is linked to its source run, rather than inferred from similar version numbers.

## Browser checks

Played every challenge to 100 XP; checked wrong-answer feedback without points, boundaries and gravestone collisions, keyboard and button movement, restart, and all field notes available at zero points. Checked the report summary, original error and multi-hop chain, route navigation, download controls and direct graph access. Both interfaces use native modal dialogs for keyboard focus containment and Escape dismissal.

Completed report JSON is saved locally; Markdown and HTML are generated from the same structured evidence. HTML escapes repository/log content, includes no executable script, and is served as an attachment with a restrictive CSP. Missing verification cannot earn a successful report. Existing Claude and GitHub integrations were not exercised with live credentials during this task.

## Final results

- **58 backend tests passed**, including real FalkorDB integration tests.
- **4 game tests passed**; lint and final Next.js production build passed.
- `legacy-kanban-app` run `run-54192982` reused the first npm run’s conflict and recovered in one attempt, passing six tests and HTTP smoke.
- Restarted the API and opened the saved npm report through **Past reports**. Its later-reuse section still linked to the kanban run.
- Downloaded the actual Markdown export through the browser and checked all eight sections and the later-project reference. Both export formats and attachment headers also passed API tests.
- Replayed the browser against the final production UI. The app remains running locally on ports 3000 and 8000 for review.
