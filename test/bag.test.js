import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeBag, cloneBag, bagSize, isEmpty, totalCounts, drawOutcomes, drawMarble, drawnColour, isDrawMove, lastDrawn,
  addMarbles, removeMarbles, returnDrawn, discardDrawn, replaceDrawn, formatCounts,
} from "../common/bag.js";

test("draw outcomes are proportional to counts, in a stable order", () => {
  const bag = makeBag({ W: 3, B: 3, G: 1 });
  assert.deepEqual(drawOutcomes(bag), [
    { move: "draw:W", p: 3 / 7 }, { move: "draw:B", p: 3 / 7 }, { move: "draw:G", p: 1 / 7 },
  ]);
  drawMarble(bag, "draw:G");
  assert.deepEqual(drawOutcomes(bag).map((o) => o.move), ["draw:W", "draw:B"]);
  assert.deepEqual(Object.keys(bag.counts), ["W", "B", "G"], "zero counts keep their place");
  assert.throws(() => drawOutcomes(makeBag({ W: 0 })));
});

test("drawing without replacement, then refilling", () => {
  const bag = makeBag({ W: 1, B: 2 });
  assert.equal(drawMarble(bag, "B"), "B");
  assert.equal(drawMarble(bag, "draw:W"), "W");
  assert.deepEqual(bag.drawn, ["B", "W"]);
  assert.equal(lastDrawn(bag), "W");
  assert.equal(bagSize(bag), 1);
  assert.throws(() => drawMarble(bag, "W"), /no W marble/);
  drawMarble(bag, "B");
  assert.ok(isEmpty(bag));
  assert.deepEqual(totalCounts(bag), { W: 1, B: 2 });
  returnDrawn(bag);
  assert.deepEqual(bag, { counts: { W: 1, B: 2 }, drawn: [] });
  assert.equal(lastDrawn(bag), null);
});

test("returning only the last draws", () => {
  const bag = makeBag({ W: 2, B: 2 });
  for (const c of ["W", "B", "B"]) drawMarble(bag, c);
  returnDrawn(bag, 2);
  assert.deepEqual(bag, { counts: { W: 1, B: 2 }, drawn: ["W"] });
});

test("adding, removing, discarding and replacing marbles", () => {
  const bag = makeBag({ W: 2, B: 1 });
  addMarbles(bag, "R", 2);
  assert.equal(removeMarbles(bag, "B", 3), 1);
  assert.equal(removeMarbles(bag, "X"), 0);
  assert.deepEqual(bag.counts, { W: 2, B: 0, R: 2 });
  drawMarble(bag, "W");
  drawMarble(bag, "R");
  assert.ok(replaceDrawn(bag, "W", "B"));
  assert.deepEqual(bag.drawn, ["B", "R"]);
  assert.ok(!replaceDrawn(bag, "W", "B"));
  assert.ok(discardDrawn(bag, "R"));
  returnDrawn(bag);
  assert.deepEqual(bag.counts, { W: 1, B: 1, R: 1 });
});

test("clones are independent", () => {
  const bag = makeBag({ W: 2 });
  const copy = cloneBag(bag);
  drawMarble(copy, "W");
  assert.deepEqual(bag, { counts: { W: 2 }, drawn: [] });
});

test("draw move helpers and notation", () => {
  assert.ok(isDrawMove("draw:W") && !isDrawMove("pass") && !isDrawMove([3]));
  assert.equal(drawnColour("draw:LR"), "LR");
  assert.throws(() => drawnColour("pass"));
  assert.equal(formatCounts({ W: 3, B: 0, G: 1 }), "3W 1G");
});
