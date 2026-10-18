"""Publish only executor-verified changes via GitHub's Git data API."""

from __future__ import annotations
import base64
import json
import os
import re
import subprocess
import httpx


def create(run, project, source):
    if run.status != "alive" or not run.certificate or not run.workspace:
        raise ValueError("Only a fully verified run can open a pull request")
    match = re.fullmatch(
        r"git:https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?", project["source"]
    )
    if not match:
        raise ValueError(
            "Pull requests require a connected GitHub repository, not a bundled example"
        )
    token = os.getenv("GITHUB_TOKEN")
    if not token:
        raise ValueError("Set GITHUB_TOKEN locally with access to this repository")
    owner, repo = match.groups()
    prefix = f"/repos/{owner}/{repo}"
    base_sha = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=source,
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    branch = "respawn/" + run.id
    with run.pr_lock:
        if run.pull_request:
            return run.pull_request
        with httpx.Client(
            base_url="https://api.github.com",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=30,
        ) as gh:

            def call(method, path, body=None):
                res = gh.request(method, path, json=body)
                if res.status_code >= 400:
                    raise ValueError(
                        f"GitHub {res.status_code}: {res.json().get('message', 'request failed')}"
                    )
                return res.json()

            repository = call("GET", prefix)
            default = repository["default_branch"]
            latest = call("GET", prefix + "/git/ref/heads/" + default)
            if latest["object"]["sha"] != base_sha:
                raise ValueError(
                    "The source branch changed since cloning. Re-import and verify its latest commit before publishing."
                )
            existing = gh.get(
                prefix + "/pulls",
                params={"head": owner + ":" + branch, "state": "open"},
            )
            existing.raise_for_status()
            if existing.json():
                run.pull_request = {
                    "url": existing.json()[0]["html_url"],
                    "branch": branch,
                }
                return run.pull_request
            base_commit = call("GET", prefix + "/git/commits/" + base_sha)
            files = {}
            for name in ("package.json", ".npmrc", "package-lock.json"):
                target = run.workspace / name
                original = source / name
                if target.exists() and (
                    not original.exists()
                    or target.read_bytes() != original.read_bytes()
                ):
                    if target.is_symlink() or target.stat().st_size > 10_000_000:
                        raise ValueError("Patch file is unsafe or too large")
                    files[name] = target.read_bytes()
            evidence = json.dumps(run.certificate, indent=2, default=str).encode()
            files[f".respawn/{run.id}-certificate.json"] = evidence
            tree = []
            for name, content in files.items():
                blob = call(
                    "POST",
                    prefix + "/git/blobs",
                    {
                        "content": base64.b64encode(content).decode(),
                        "encoding": "base64",
                    },
                )
                tree.append(
                    {"path": name, "mode": "100644", "type": "blob", "sha": blob["sha"]}
                )
            new_tree = call(
                "POST",
                prefix + "/git/trees",
                {"base_tree": base_commit["tree"]["sha"], "tree": tree},
            )
            commit = call(
                "POST",
                prefix + "/git/commits",
                {
                    "message": f"Respawn {project['name']}: verified recovery",
                    "tree": new_tree["sha"],
                    "parents": [base_sha],
                },
            )
            ref = gh.get(prefix + "/git/ref/heads/" + branch)
            if ref.status_code == 404:
                call(
                    "POST",
                    prefix + "/git/refs",
                    {"ref": "refs/heads/" + branch, "sha": commit["sha"]},
                )
            elif ref.is_success:
                # Retrying our own prior publication is safe; never overwrite an unrelated branch.
                existing_commit = call(
                    "GET", prefix + "/git/commits/" + ref.json()["object"]["sha"]
                )
                if existing_commit["tree"]["sha"] != new_tree["sha"]:
                    raise ValueError(
                        "Recovery branch already exists with different content"
                    )
            else:
                ref.raise_for_status()
            cert = run.certificate
            body = (
                f"Repairs {project['name']} using a graph-selected migration path.\n\n"
                + "\n".join("- " + s for s in cert["steps"])
                + f"\n\nValidation: {cert['tests']['passed']} tests passed; build and HTTP asset smoke checks passed.\n\nThe certificate and full decision trace are in `.respawn/{run.id}-certificate.json`.\n\nGenerated by Re:Spawn; review before merging."
            )
            pr = call(
                "POST",
                prefix + "/pulls",
                {
                    "title": f"Respawn {project['name']}: verified recovery",
                    "head": branch,
                    "base": default,
                    "body": body,
                    "draft": True,
                },
            )
            run.pull_request = {"url": pr["html_url"], "branch": branch}
            run.emit("pull_request", **run.pull_request)
            return run.pull_request
