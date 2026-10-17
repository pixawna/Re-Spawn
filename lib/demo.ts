export type Project = {
  id: string;
  name: string;
  owner: string;
  stack: string;
  status: "Unverified" | "Diagnosed" | "Build passing" | "Verified working";
  age: string;
  issue: string;
};
export const projects: Project[] = [
  {
    id: "legacy-todo-app",
    name: "legacy-todo-app",
    owner: "respawn-labs",
    stack: "React · Node.js",
    status: "Diagnosed",
    age: "2 years ago",
    issue: "Node.js runtime conflicts with legacy dependencies.",
  },
  {
    id: "midnight-portfolio",
    name: "midnight-portfolio",
    owner: "julescodes",
    stack: "Next.js · TypeScript",
    status: "Unverified",
    age: "8 months ago",
    issue: "Waiting for its first diagnostic run.",
  },
  {
    id: "weather-widget",
    name: "weather-widget",
    owner: "tiny-experiments",
    stack: "React · JavaScript",
    status: "Verified working",
    age: "Just now",
    issue: "Demo migration and browser verification completed.",
  },
  {
    id: "pixel-notes",
    name: "pixel-notes",
    owner: "weekend-builds",
    stack: "Vue · Node.js",
    status: "Build passing",
    age: "3 days ago",
    issue: "Demo build passes. Browser verification is still pending.",
  },
];
export const demoLogs = [
  "$ npm run build",
  "Inspecting package.json and runtime requirements…",
  "ERR! node-sass@4 requires an unsupported Node ABI",
  "Graph fact: node-sass@4 → REQUIRES → Node.js < 15",
  "Attempt 01: upgrade runtime only → rejected",
  "Prerequisite unmet: replace deprecated Sass binding",
  "Alternative: node-sass → sass; then upgrade runtime",
  "Applying migration recipe in demo workspace…",
  "✓ Dependency installation complete",
  "✓ Production build passed",
  "✓ 8 demo tests passed",
  "✓ Browser smoke check passed — demo complete",
];
