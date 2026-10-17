"""The resurrection knowledge base: runtimes, package versions, known incompatibilities,
and migration recipes. Seeded into FalkorDB on startup (idempotent MERGEs).

Each fact here is a real-world compatibility rule. Recipes are deterministic edits to
package.json / .npmrc — the LLM is never asked to invent migration commands.
"""
from __future__ import annotations

import json

NODE_MAJORS = [12, 14, 16, 18, 20, 22, 24]

# name -> majors we know about
PACKAGES = {
    "webpack": [4, 5],
    "webpack-cli": [3, 4, 5],
    "webpack-dev-server": [3, 4, 5],
    "node-sass": [4, 6],
    "sass": [1],
    "react-scripts": [3, 4, 5],
    "css-loader": [3, 6],
    "style-loader": [1, 3],
    "html-webpack-plugin": [3, 5],
    "sass-loader": [8, 13],
    "babel-loader": [8, 9],
}

OPENSSL_SIG = "ERR_OSSL_EVP_UNSUPPORTED|digital envelope routines::unsupported|error:0308010C"
NODE_SASS_SIG = "Node Sass does not yet support|node-sass@[0-9.]+ postinstall|gyp ERR!|binding.node"

# (package@major, first incompatible node major, reason, error signature regex)
INCOMPATIBLE = [
    ("webpack@4", 17,
     "Node 17+ ships OpenSSL 3, which removed MD4. webpack 4 hashes every module with MD4.",
     OPENSSL_SIG),
    ("react-scripts@3", 17, "react-scripts 3 bundles webpack 4 (MD4 hashing, removed in OpenSSL 3).", OPENSSL_SIG),
    ("react-scripts@4", 17, "react-scripts 4 bundles webpack 4 (MD4 hashing, removed in OpenSSL 3).", OPENSSL_SIG),
    ("webpack-dev-server@3", 17, "webpack-dev-server 3 runs on webpack 4 hashing.", OPENSSL_SIG),
    ("node-sass@4", 15, "node-sass 4 ships native bindings only up to Node 14 and cannot compile on newer ABIs.",
     NODE_SASS_SIG),
    ("node-sass@6", 17, "node-sass 6 has no binaries for Node 17+.", NODE_SASS_SIG),
]

# Peer conflicts the graph knows from day one: (a, b, reason)
CONFLICTS = [
    ("css-loader@3", "webpack@5", "css-loader 3 declares peer webpack ^4"),
    ("style-loader@1", "webpack@5", "style-loader 1 declares peer webpack ^4"),
    ("html-webpack-plugin@3", "webpack@5", "html-webpack-plugin 3 declares peer webpack ^1-4"),
    ("sass-loader@8", "webpack@5", "sass-loader 8 declares peer webpack ^4"),
    ("webpack-dev-server@3", "webpack@5", "webpack-dev-server 3 requires webpack 4"),
]

# A rule that is deliberately NOT seeded by default. The agent learns it from a real
# npm ERESOLVE failure. The "pre-teach" toggle seeds it up front so judges can watch
# the plan change when one FalkorDB relationship changes.
TEACHABLE_CONFLICT = ("webpack-cli@3", "webpack@5", "webpack-cli 3.3.12 declares peer webpack 4.x.x")

# Migrations. kind: upgrade | replace | runtime | workaround
MIGRATIONS = [
    {
        "id": "mig:webpack-4-5", "title": "Upgrade webpack 4 → 5", "kind": "upgrade",
        "from": "webpack@4", "to": "webpack@5", "cost": 3, "risk": "low",
        "why": "webpack 5 hashes with xxhash64 and supports OpenSSL 3.",
        "recipe": [{"op": "set", "pkg": "webpack", "range": "^5.94.0"},
                   {"op": "engines", "node": ">=18"}],
    },
    {
        "id": "mig:webpack-cli-3-5", "title": "Upgrade webpack-cli 3 → 5", "kind": "upgrade",
        "from": "webpack-cli@3", "to": "webpack-cli@5", "cost": 1, "risk": "low",
        "why": "webpack-cli 5 is the CLI line built for webpack 5.",
        "recipe": [{"op": "set", "pkg": "webpack-cli", "range": "^5.1.4"}],
    },
    {
        "id": "mig:webpack-cli-4-5", "title": "Upgrade webpack-cli 4 → 5", "kind": "upgrade",
        "from": "webpack-cli@4", "to": "webpack-cli@5", "cost": 1, "risk": "low",
        "why": "Keeps the CLI aligned with webpack 5.",
        "recipe": [{"op": "set", "pkg": "webpack-cli", "range": "^5.1.4"}],
    },
    {
        "id": "mig:wds-3-5", "title": "Upgrade webpack-dev-server 3 → 5", "kind": "upgrade",
        "from": "webpack-dev-server@3", "to": "webpack-dev-server@5", "cost": 2, "risk": "medium",
        "why": "Dev server 5 targets webpack 5.",
        "recipe": [{"op": "set", "pkg": "webpack-dev-server", "range": "^5.0.4"}],
    },
    {
        "id": "mig:css-loader-3-6", "title": "Upgrade css-loader 3 → 6", "kind": "upgrade",
        "from": "css-loader@3", "to": "css-loader@6", "cost": 1, "risk": "low",
        "why": "css-loader 6 peers on webpack 5.",
        "recipe": [{"op": "set", "pkg": "css-loader", "range": "^6.11.0"}],
    },
    {
        "id": "mig:style-loader-1-3", "title": "Upgrade style-loader 1 → 3", "kind": "upgrade",
        "from": "style-loader@1", "to": "style-loader@3", "cost": 1, "risk": "low",
        "why": "style-loader 3 peers on webpack 5.",
        "recipe": [{"op": "set", "pkg": "style-loader", "range": "^3.3.4"}],
    },
    {
        "id": "mig:html-plugin-3-5", "title": "Upgrade html-webpack-plugin 3 → 5", "kind": "upgrade",
        "from": "html-webpack-plugin@3", "to": "html-webpack-plugin@5", "cost": 1, "risk": "low",
        "why": "html-webpack-plugin 5 supports webpack 5.",
        "recipe": [{"op": "set", "pkg": "html-webpack-plugin", "range": "^5.6.0"}],
    },
    {
        "id": "mig:sass-loader-8-13", "title": "Upgrade sass-loader 8 → 13", "kind": "upgrade",
        "from": "sass-loader@8", "to": "sass-loader@13", "cost": 1, "risk": "low",
        "why": "sass-loader 13 supports webpack 5 and Dart Sass.",
        "recipe": [{"op": "set", "pkg": "sass-loader", "range": "^13.3.3"}],
    },
    {
        "id": "mig:node-sass-to-sass", "title": "Replace node-sass with Dart Sass", "kind": "replace",
        "from": "node-sass@4", "to": "sass@1", "cost": 2, "risk": "low",
        "why": "Dart Sass is pure JavaScript, so it has no native ABI to break.",
        "recipe": [{"op": "replace", "pkg": "node-sass", "with": "sass", "range": "^1.77.0"}],
    },
    {
        "id": "mig:node-sass-6-to-sass", "title": "Replace node-sass 6 with Dart Sass", "kind": "replace",
        "from": "node-sass@6", "to": "sass@1", "cost": 2, "risk": "low",
        "why": "Dart Sass is pure JavaScript, so it has no native ABI to break.",
        "recipe": [{"op": "replace", "pkg": "node-sass", "with": "sass", "range": "^1.77.0"}],
    },
    {
        "id": "mig:react-scripts-4-5", "title": "Upgrade react-scripts 4 → 5", "kind": "upgrade",
        "from": "react-scripts@4", "to": "react-scripts@5", "cost": 5, "risk": "medium",
        "why": "react-scripts 5 moves CRA onto webpack 5.",
        "recipe": [{"op": "set", "pkg": "react-scripts", "range": "5.0.1"}],
    },
    {
        "id": "mig:react-scripts-3-5", "title": "Upgrade react-scripts 3 → 5", "kind": "upgrade",
        "from": "react-scripts@3", "to": "react-scripts@5", "cost": 6, "risk": "medium",
        "why": "react-scripts 5 moves CRA onto webpack 5.",
        "recipe": [{"op": "set", "pkg": "react-scripts", "range": "5.0.1"}],
    },
    {
        "id": "mig:openssl-legacy", "title": "Re-enable OpenSSL legacy provider", "kind": "workaround",
        "from": "webpack@4", "to": None, "cost": 1, "risk": "high",
        "why": "Sets node-options=--openssl-legacy-provider. Works, but keeps deprecated crypto and webpack 4.",
        "recipe": [{"op": "npmrc", "key": "node-options", "value": "--openssl-legacy-provider"}],
    },
    {
        "id": "mig:openssl-legacy-cra", "title": "Re-enable OpenSSL legacy provider", "kind": "workaround",
        "from": "react-scripts@4", "to": None, "cost": 1, "risk": "high",
        "why": "Sets node-options=--openssl-legacy-provider. Works, but keeps deprecated crypto.",
        "recipe": [{"op": "npmrc", "key": "node-options", "value": "--openssl-legacy-provider"}],
    },
]

# Runtime downgrades: one per legacy-friendly major, chosen when the target is installed.
RUNTIME_MIGRATIONS = [
    {"id": f"mig:runtime-node-{m}", "title": f"Run on Node.js {m}", "kind": "runtime",
     "to_runtime": f"node@{m}", "cost": 2, "risk": "medium",
     "why": f"Pin the runtime to Node {m} instead of changing code. Needs Node {m} installed.",
     "recipe": [{"op": "runtime", "node": m}, {"op": "engines", "node": f"{m}.x"}]}
    for m in (14, 16)
]


def recipe_json(recipe) -> str:
    return json.dumps(recipe)
