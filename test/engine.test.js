import { test } from "node:test";
import assert from "node:assert/strict";
import { moveKey, parseMoveKey, sameMove, resolveOptions, optionAllowed, cachedBoards, choiceValues, parseChoice } from "../common/engine.js";
import { seededRng, shuffle } from "../common/rng.js";

test("moveKey / parseMoveKey round-trip", () => {
  for (const m of [[17], [17, 23], [0, 5, 9], "pass", "swap"]) {
    assert.deepEqual(parseMoveKey(moveKey(m)), m);
  }
  assert.equal(moveKey([3, 4]), "3-4");
  assert.ok(sameMove([3, 4], [3, 4]));
  assert.ok(!sameMove([3, 4], [4, 3]));
});

test("resolveOptions falls back to defaults and coerces types", () => {
  const game = {
    options: {
      size: { label: "Size", choices: [48, 160], default: 48 },
      mode: { label: "Mode", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }], default: "a" },
    },
  };
  assert.deepEqual(resolveOptions(game, {}), { size: 48, mode: "a" });
  assert.deepEqual(resolveOptions(game, { size: "160", mode: "b", junk: 1 }), { size: 160, mode: "b" });
  assert.deepEqual(resolveOptions(game, { size: 7 }), { size: 48, mode: "a" });
  assert.deepEqual(resolveOptions({}, { size: 7 }), {});
});

test("resolveOptions replaces disallowed combinations", () => {
  const game = {
    options: {
      size: { label: "Size", choices: [3, 4, 5], default: 5 },
      min: { label: "Min", choices: [3, 5, 7, 9], default: 5, allowed: (m, { size }) => m <= size + 2 },
    },
  };
  assert.deepEqual(resolveOptions(game, { size: 3, min: 9 }), { size: 3, min: 5 }, "nearest allowed below");
  assert.deepEqual(resolveOptions(game, { size: 5, min: 7 }), { size: 5, min: 7 });
  assert.equal(optionAllowed(game, "min", 7, { size: 4 }), false);
});

test("seededRng is reproducible and in [0, 1)", () => {
  const a = seededRng(42), b = seededRng(42);
  for (let i = 0; i < 1000; i++) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
  assert.notEqual(seededRng(1)(), seededRng(2)());
});

test("shuffle is a permutation", () => {
  const xs = shuffle([...Array(50).keys()], seededRng(3));
  assert.deepEqual([...xs].sort((p, q) => p - q), [...Array(50).keys()]);
});

test("pickWeighted follows probabilities", async () => {
  const { pickWeighted } = await import("../common/engine.js");
  const outcomes = [{ move: "a", p: 0.25 }, { move: "b", p: 0.75 }];
  assert.equal(pickWeighted(outcomes, () => 0.1), "a");
  assert.equal(pickWeighted(outcomes, () => 0.3), "b");
  assert.equal(pickWeighted(outcomes, () => 0.999999999999), "b");
  const rng = seededRng(5);
  let a = 0;
  for (let i = 0; i < 20000; i++) if (pickWeighted(outcomes, rng) === "a") a++;
  assert.ok(Math.abs(a / 20000 - 0.25) < 0.02, `a drawn ${a / 20000}`);
});

test("chance plies replay, sample and report the current player", async () => {
  const { replay, sampleChance, currentPlayer, isChance, randomPlayout, CHANCE } = await import("../common/engine.js");
  const game = (await import("./fixtures/bag-tictactoe.js")).default;
  const { state } = replay(game, {}, ["draw:D", [4], "draw:L"]);
  assert.equal(game.toMove(state), 2);
  assert.equal(currentPlayer(game, state), 2);
  assert.deepEqual(state.bag.drawn, ["D", "L"]);
  game.applyMove(state, [1]);
  assert.ok(isChance(game, state));
  assert.equal(game.toMove(state), CHANCE);
  assert.equal(currentPlayer(game, state), 1);
  assert.match(sampleChance(game, state, seededRng(1)), /^draw:[DL]$/);
  assert.throws(() => replay(game, {}, ["draw:D", "draw:D"]), /illegal move/);
  const winner = randomPlayout(game, state, seededRng(2));
  assert.ok([0, 1, 2].includes(winner));
});

test("bag refills after the last marble is drawn", async () => {
  const { replay } = await import("../common/engine.js");
  const game = (await import("./fixtures/bag-tictactoe.js")).default;
  const { state } = replay(game, {}, ["draw:D", [0], "draw:D", [4], "draw:L", [1], "draw:L", [3]]);
  assert.deepEqual(state.bag, { counts: { D: 2, L: 2 }, drawn: [] });
});

test("cachedBoards builds each keyed board once", () => {
  let built = 0;
  const create = cachedBoards((o) => o.size, ({ size }) => ({ size, n: ++built }));
  const a = create({ size: 5, other: 1 });
  assert.equal(create({ size: 5, other: 2 }), a);
  assert.notEqual(create({ size: 7 }), a);
  assert.equal(built, 2);
});

test("parseChoice matches values written as strings", () => {
  const spec = { choices: [6, { value: 8, label: "8×8" }, "pinwheel"] };
  assert.deepEqual(choiceValues(spec), [6, 8, "pinwheel"]);
  assert.equal(parseChoice(spec, "8"), 8);
  assert.equal(parseChoice(spec, "pinwheel"), "pinwheel");
  assert.equal(parseChoice(spec, "9"), undefined);
});
