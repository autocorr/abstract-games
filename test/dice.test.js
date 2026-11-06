import { test } from "node:test";
import assert from "node:assert/strict";
import { rollOutcomes, isRollMove, rolledValue, dicePanel } from "../common/dice.js";
import { parseMoveKey, moveKey } from "../common/engine.js";

test("a die has one equally likely outcome per face", () => {
  const out = rollOutcomes();
  assert.deepEqual(out.map((o) => o.move), ["roll:1", "roll:2", "roll:3", "roll:4", "roll:5", "roll:6"]);
  for (const { p } of out) assert.equal(p, 1 / 6);
  assert.equal(rollOutcomes(4).length, 4);
});

test("roll moves round-trip and read back their value", () => {
  for (const { move } of rollOutcomes()) {
    assert.ok(isRollMove(move));
    assert.equal(parseMoveKey(moveKey(move)), move);
  }
  assert.equal(rolledValue("roll:5"), 5);
  assert.equal(isRollMove("draw:R"), false);
  assert.equal(isRollMove([3]), false);
  assert.throws(() => rolledValue("pass"));
});

test("dicePanel describes dice for chanceView", () => {
  assert.deepEqual(dicePanel([null], { owner: 2, active: true }), { title: "Die", owner: 2, dice: [null], active: true });
  assert.equal(dicePanel([2, 6], { result: "difference 4" }).result, "difference 4");
});
