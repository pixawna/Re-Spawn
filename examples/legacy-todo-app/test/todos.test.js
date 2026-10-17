const assert = require("assert");
const { createStore } = require("../src/todos");

const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

test("starts from seed items", function () {
  const s = createStore([{ text: "a" }, { text: "b", done: true }]);
  assert.strictEqual(s.all().length, 2);
  assert.strictEqual(s.remaining(), 1);
});
test("adds trimmed items", function () {
  const s = createStore();
  const item = s.add("  write tests  ");
  assert.strictEqual(item.text, "write tests");
  assert.strictEqual(s.all().length, 1);
});
test("ignores empty items", function () {
  const s = createStore();
  assert.strictEqual(s.add("   "), null);
  assert.strictEqual(s.all().length, 0);
});
test("toggles completion", function () {
  const s = createStore([{ text: "a" }]);
  s.toggle(1);
  assert.strictEqual(s.all()[0].done, true);
  s.toggle(1);
  assert.strictEqual(s.all()[0].done, false);
});
test("removes items", function () {
  const s = createStore([{ text: "a" }, { text: "b" }]);
  s.remove(1);
  assert.deepStrictEqual(s.all().map(function (t) { return t.text; }), ["b"]);
});
test("notifies subscribers", function () {
  const s = createStore();
  let calls = 0;
  s.subscribe(function () { calls++; });
  s.add("x");
  s.toggle(1);
  assert.strictEqual(calls, 2);
});
test("ids stay unique after removal", function () {
  const s = createStore([{ text: "a" }, { text: "b" }]);
  s.remove(2);
  const c = s.add("c");
  assert.strictEqual(c.id, 3);
});
test("does not mutate previous snapshots", function () {
  const s = createStore([{ text: "a" }]);
  const before = s.all();
  s.toggle(1);
  assert.strictEqual(before[0].done, false);
});

let failed = 0;
tests.forEach(function (t) {
  try { t.fn(); console.log("  ✓ " + t.name); }
  catch (e) { failed++; console.log("  ✗ " + t.name + "\n    " + e.message); }
});
console.log("\n" + (tests.length - failed) + " passing, " + failed + " failing");
process.exit(failed ? 1 : 0);
