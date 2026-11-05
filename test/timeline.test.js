import { test } from "node:test";
import assert from "node:assert/strict";
import { timeline, isLive, jump, play, undoTarget } from "../common/timeline.js";

const line = [[1], [2], "draw:R", [3], [4]];

test("timeline starts live at the end, cursor is clamped", () => {
  assert.equal(timeline(line).cursor, 5);
  assert.ok(isLive(timeline(line)));
  assert.equal(timeline(line, 2).cursor, 2);
  assert.ok(!isLive(timeline(line, 2)));
  assert.equal(timeline(line, 99).cursor, 5);
  assert.equal(timeline(line, -3).cursor, 0);
  assert.equal(timeline(line, "x").cursor, 0);
  assert.equal(jump(timeline(line), 1).cursor, 1);
  assert.equal(jump(timeline(line), 9).cursor, 5);
  assert.deepEqual(timeline().moves, []);
});

test("play: appends when live", () => {
  const t = play(timeline(line), [5]);
  assert.equal(t.moves.length, 6);
  assert.equal(t.cursor, 6);
  assert.equal(t.branched, false);
  assert.equal(line.length, 5, "the original line is not mutated");
});

test("play: following the tail keeps it, a different move branches", () => {
  const t = timeline(line, 1);
  const same = play(t, [2]);
  assert.equal(same.moves, line);
  assert.equal(same.cursor, 2);
  assert.equal(same.branched, false);

  const other = play(t, [9]);
  assert.deepEqual(other.moves, [[1], [9]]);
  assert.equal(other.cursor, 2);
  assert.equal(other.branched, true);
  assert.ok(isLive(other));
});

test("undoTarget: back to the previous human decision, keeping draws before it", () => {
  // Positions after n plies: human decides at 0, 3 and 4 (after the draw).
  const human = new Set([0, 3, 4]);
  const at = (n) => human.has(n);
  assert.equal(undoTarget(timeline(line), at), 4);
  assert.equal(undoTarget(timeline(line, 4), at), 3);
  assert.equal(undoTarget(timeline(line, 3), at), 0);
  assert.equal(undoTarget(timeline(line, 1), at), 0);
  assert.equal(undoTarget(timeline(line, 0), at), null);
  // No human decision before the cursor (e.g. the human moves second and
  // this is their first decision): nowhere to go.
  assert.equal(undoTarget(timeline(line), () => false), null);
  const second = new Set([1, 3]);
  assert.equal(undoTarget(timeline(line, 1), (n) => second.has(n)), null);
});
