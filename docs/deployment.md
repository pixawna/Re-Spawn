# Deployment

The frontend is a Next.js Vercel project. Set `NEXT_PUBLIC_RESPAWN_API` to the public HTTPS backend origin and redeploy; Next.js includes it at build time. Set backend `RESPAWN_ALLOWED_ORIGINS` to the exact frontend origin (comma-separated if needed).

## Free Render demo

`render.yaml` provisions a **free** Docker web service using `deploy/Dockerfile.demo`: Python 3.12, Node 22, and embedded FalkorDB Lite. Set `RESPAWN_ALLOWED_ORIGINS=https://re-spawn.vercel.app`. Set Vercel `NEXT_PUBLIC_RESPAWN_EXAMPLES_ONLY=1` and `NEXT_PUBLIC_RESPAWN_API` to the assigned Render URL.

This configuration executes real repairs of the three bundled examples with the deterministic graph agent. It rejects repository imports and runs at most one repair at a time. No Anthropic or GitHub key is needed. The local executor here is restricted to bundled source; do not disable `RESPAWN_EXAMPLES_ONLY` on this host.

Render free services sleep after 15 idle minutes, take time to wake, and lose local graph/report data on restart. Download reports before leaving. This is a shared demo: judges see the same projects and learned graph facts. Free-tier memory limits must be checked with a complete live resurrection before treating the deployment as ready.

## Persistent Docker host

On a dedicated Linux host with Docker Compose, point a domain at its IP and allow ports 80/443. From the repository:

```sh
sudo mkdir -p /srv/respawn/data
export FRONTEND_ORIGIN=https://re-spawn.vercel.app
export API_DOMAIN=api.example.com
docker pull node:22
docker pull python:3.12-slim
docker compose -f deploy/compose.yml up -d --build
```

Caddy provisions HTTPS and streams agent events. FalkorDB and the API are internal to the Compose network. Data survives container restarts. The API uses the host Docker socket to start repair containers; use a dedicated host. `/srv/respawn/data` deliberately has the same path on the host and API container so sibling repair containers can mount workspaces correctly. Keep one API worker because active-run state is in memory.

## Verification

Check `/api/health`, `/api/projects`, a complete npm and Python repair, event streaming, report downloads, and CORS from the Vercel origin. A frontend HTTP 200 alone does not verify the repair service.

## Local image validation (2026-10-18)

The Render Docker image was built for Linux AMD64 and tested with a 512 MB memory limit and one CPU. The npm example completed with 8 passing tests, the Python example with 6, and both passed build and HTTP smoke checks. The Vercel origin passed CORS checks; repository import returned HTTP 403. This validates the image locally; a public Render deployment still requires live verification.
