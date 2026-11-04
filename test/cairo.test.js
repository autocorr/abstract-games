import { test } from "node:test";
import assert from "node:assert/strict";
import { cairoBoard } from "../common/board/cairo.js";
import { validateBoard } from "../common/board/graph.js";
import { BOARDS, ROTATION } from "../games/filament/boards.js";

const tally = (xs) => {
  const out = {};
  for (const x of xs) out[x] = (out[x] || 0) + 1;
  return out;
};

const cases = [
  { size: 48, degrees: { 3: 20, 5: 28 }, colours: { A: 16, B: 16, C: 16 } },
  { size: 160, degrees: { 3: 40, 5: 120 }, colours: { A: 54, B: 52, C: 54 } },
];

for (const { size, degrees, colours } of cases) {
  test(`Cairo-${size} geometry invariants`, () => {
    const b = cairoBoard(BOARDS[size], { rotate: ROTATION[size] });
    assert.deepEqual(validateBoard(b), []);
    assert.equal(b.size, size);
    assert.ok(b.cells.every((c) => c.poly.length === 5), "not every cell is a pentagon");
    assert.deepEqual(tally(b.neighbours.map((ns) => ns.length)), degrees);
    assert.deepEqual(tally(b.cells.map((c) => c.tags.colour)), colours);
    assert.ok(Math.abs(b.unit - 1) < 1e-9, `unit ${b.unit}`);
    // Names number the cells 1..n in reading order.
    const byName = [...b.cells].sort((p, q) => Number(p.tags.name) - Number(q.tags.name));
    assert.deepEqual(byName.map((c) => c.tags.name), b.cells.map((c, i) => String(i + 1)));
    for (let i = 1; i < byName.length; i++) assert.ok(byName[i].y >= byName[i - 1].y - 1e-3);
  });

  test(`Cairo-${size}: shared-edge adjacency equals unit centre distance`, () => {
    // The original Filament defined neighbours as centres exactly one unit
    // apart; the generic shared-edge rule must agree with it.
    const b = cairoBoard(BOARDS[size], { rotate: ROTATION[size] });
    for (const c of b.cells) {
      const byDistance = b.cells
        .filter((o) => o.id !== c.id && Math.abs(Math.hypot(c.x - o.x, c.y - o.y) - 1) < 1e-3)
        .map((o) => o.id);
      assert.deepEqual(b.neighbours[c.id], byDistance, `cell ${c.id}`);
    }
  });

  test(`Cairo-${size}: tones split the board in half`, () => {
    const b = cairoBoard(BOARDS[size], { rotate: ROTATION[size] });
    assert.deepEqual(tally(b.cells.map((c) => c.tags.tone)), { 0: size / 2, 1: size / 2 });
  });
}

test("rotation does not change adjacency", () => {
  const a = cairoBoard(BOARDS[48]);
  const b = cairoBoard(BOARDS[48], { rotate: -30 });
  assert.deepEqual(a.neighbours, b.neighbours);
});

test("a centre off the lattice is rejected", () => {
  assert.throws(() => cairoBoard([[0.25, 0.25]]), /not a snub-square vertex/);
});
