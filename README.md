# Re:Spawn

Every dead project deserves another life. A Next.js UI prototype for a graph-powered software resurrection experience.

## Run locally

Requires Node.js 20.9+ and npm.

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Explore the UI

- **Graveyard:** interactive illustrated project scene, search, status filters, and a GitHub repository form.
- **Resurrection lab:** animated ghost mechanic, simulated repair sequence, logs, and package snapshots.
- **Recovery tree:** React Flow map with selectable migration evidence, rejected routes, pan, and zoom.
- **Respawn:** interactive example to-do app and downloadable demo certificate.

Click “Try a demo resurrection” to explore the complete flow. Seeded project detail routes are available under `/project/legacy-todo-app` and the other demo project IDs.

## Scope

This version is frontend only. Repository entries are held in memory for the current session. Builds, repairs, graph facts, tests, and certificates are explicitly simulated. There is no GitHub access, FalkorDB connection, backend, Docker execution, or real application verification yet.

The app stays at the repository root. UI components live in `components/`, sample fixtures in `lib/demo.ts`, and routes in `app/`.

## Checks

```bash
npm run lint
npm run build
```

Built with Next.js, TypeScript, Tailwind CSS, React Flow, and Lucide icons. The graveyard and ghost are code-native SVG/CSS artwork. Includes responsive layouts, keyboard-accessible dialogs, and reduced-motion support.
