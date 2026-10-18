const { test } = require("node:test");
const assert = require("node:assert/strict");
const { move, add, columns } = require("../src/board");
test("three workflow stages", () => assert.equal(columns.length, 3));
test("new card starts in backlog", () =>
  assert.equal(add([], " Task ")[0].column, 0));
test("blank cards are ignored", () => assert.deepEqual(add([], "  "), []));
test("moving wraps from done to backlog", () =>
  assert.equal(move([{ id: 1, column: 2 }], 1)[0].column, 0));
test("moving preserves original state", () => {
  const state = [{ id: 1, column: 0 }];
  move(state, 1);
  assert.equal(state[0].column, 0);
});
test("new IDs follow maximum existing ID", () =>
  assert.equal(add([{ id: 9, column: 1 }], "Next")[1].id, 10));
