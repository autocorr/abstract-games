import { test } from "node:test";
import assert from "node:assert/strict";
import { moveKey, parseMoveKey, sameMove, resolveOptions } from "../common/engine.js";
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
