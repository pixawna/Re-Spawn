import assert from "node:assert/strict";
import test from "node:test";
import {
  WALLS,
  STATIONS,
  moveExplorer,
  buildLessons,
} from "../lib/learn-game.ts";

test("movement respects tombstones, boundaries and one-tile movement", () => {
  assert.deepEqual(moveExplorer([0, 0], -1, 0), [0, 0]);
  assert.deepEqual(moveExplorer([0, 1], 1, 0), [0, 1]);
  assert.deepEqual(moveExplorer([0, 0], 2, 0), [0, 0]);
  assert.deepEqual(moveExplorer([0, 0], 1, 0), [1, 0]);
});

test("all five memory runes are reachable from the starting tile", () => {
  const queue = [[0, 6]],
    seen = new Set(["0,6"]);
  while (queue.length) {
    const at = queue.shift();
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const next = moveExplorer(at, dx, dy),
        key = next.join(",");
      if (!seen.has(key)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  for (const target of STATIONS) assert.ok(seen.has(target.join(",")));
  for (const wall of WALLS) assert.ok(!seen.has(wall));
});

test("lessons distinguish missing graph evidence from a verified result", () => {
  const lessons = buildLessons({
    nodes: [],
    edges: [],
    plans: [],
    attempts: [],
    run: null,
  });
  assert.equal(lessons.length, 5);
  assert.match(lessons[0].fact, /No explicit incompatibility/);
  assert.match(lessons[4].fact, /No verification node/);
  assert.ok(
    lessons.every((l) => l.options.length === 2 && l.options[l.correct]),
  );
});

test("lesson facts use the selected graph rather than a hardcoded npm patient", () => {
  const lessons = buildLessons({
    nodes: [
      {
        id: "distutils",
        kind: "package",
        label: "distutils",
        blocked: true,
        reason: "Removed in Python 3.12",
      },
      {
        id: "edit",
        kind: "migration",
        label: "Replace import",
        cost: 2,
        risk: "medium",
      },
      { id: "install", kind: "migration", label: "Install packaging" },
      {
        id: "verification",
        kind: "verification",
        label: "Heartbeat",
        sub: "6 tests · smoke ok",
      },
    ],
    edges: [{ id: "pre", source: "edit", target: "install", kind: "REQUIRES" }],
    plans: [],
    attempts: [],
    run: null,
  });
  assert.match(lessons[0].fact, /Python 3.12/);
  assert.match(
    lessons[2].fact,
    /Replace import requires Install packaging first/,
  );
  assert.match(lessons[4].fact, /6 tests/);
});
