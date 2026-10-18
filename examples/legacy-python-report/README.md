# Legacy Python report — intentionally broken

This small static report uses distutils.version.StrictVersion. Python 3.12 removed distutils, so the original build fails during import. There is no fake failure flag.

Run Re:Spawn with Docker enabled, open **legacy-python-report**, and choose Resurrect. The shared graph requires installing packaging==24.2 before changing the obsolete import. The repaired build produces dist/index.html, passes six unittest tests and serves over HTTP.

To reproduce the original failure in isolation, from this directory:

```sh
docker run --rm -v "$PWD:/app:ro" -w /app python:3.12-slim python build.py
```

Expected: ModuleNotFoundError for distutils. Re:Spawn repairs a sandbox copy; this checked-in original stays broken. Version parser semantics differ outside the tested version strings, so this recipe is deliberately scoped. See [adapter documentation](../../docs/ecosystems.md).
