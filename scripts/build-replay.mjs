// Builds the hosted demo: one self-contained HTML page that runs the real Re:Spawn UI
// against recordings of real runs (see scripts/record-runs.py).
//
//   npm i --no-save esbuild
//   node scripts/build-replay.mjs recordings.json out/respawn-demo.html
import { build } from "esbuild";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const [recPath = "recordings.json", outPath = "out/respawn-demo.html"] = process.argv.slice(2);
const tmp = fs.mkdtempSync(path.join(root, ".replay-"));

const font = (pkg, file) => path.join(root, "node_modules/@fontsource", pkg, "files", file);
const faces = [
  ...[400, 500, 600, 700].map((w) => ["Pixelify Sans", w, font("pixelify-sans", `pixelify-sans-latin-${w}-normal.woff2`)]),
  ...[400, 500].map((w) => ["JetBrains Mono", w, font("jetbrains-mono", `jetbrains-mono-latin-${w}-normal.woff2`)]),
]
  .map(([f, w, p]) => `@font-face{font-family:"${f}";font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${fs.readFileSync(p).toString("base64")}) format("woff2")}`)
  .join("\n");
const globals = fs.readFileSync(path.join(root, "app/globals.css"), "utf8").replace('@import "tailwindcss";', "");
fs.writeFileSync(
  path.join(tmp, "replay.css"),
  `${faces}\n:root{--font-pixel:"Pixelify Sans";--font-code:"JetBrains Mono"}\nh1,h2,h3,p,ul,ol,dl,dd{margin:0}\n${globals}`,
);
fs.writeFileSync(path.join(tmp, "entry.tsx"), `import "./replay.css";\nimport "${path.join(root, "replay/main.tsx")}";\n`);

const res = await build({
  entryPoints: [path.join(tmp, "entry.tsx")],
  bundle: true,
  minify: true,
  write: false,
  outdir: tmp,
  format: "iife",
  jsx: "automatic",
  target: "es2020",
  alias: { "@": root, "next/link": path.join(root, "replay/router.tsx"), "next/navigation": path.join(root, "replay/router.tsx") },
  define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_RESPAWN_API": '""' },
  logLevel: "warning",
});
const js = res.outputFiles.find((f) => f.path.endsWith(".js")).text;
const css = res.outputFiles.find((f) => f.path.endsWith(".css")).text;
const rec = fs.readFileSync(recPath, "utf8").replace(/</g, "\\u003c");

// Written as page content (no html/head/body): hosts like claude.ai artifacts wrap it in a skeleton.
const html = `<title>Re:Spawn</title>
<meta name="description" content="Replay of real Re:Spawn runs: a FalkorDB-guided agent resurrecting three broken projects.">
<style>:root{color-scheme:dark}${css}</style>
<div id="root"></div>
<script type="application/json" id="recordings">${rec}</script>
<script>${js.replace(/<\/script/g, "<\\/script")}</script>
`;
fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, html);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`wrote ${outPath} (${(html.length / 1024).toFixed(0)} KB)`);
