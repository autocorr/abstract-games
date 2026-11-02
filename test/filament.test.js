import { test } from "node:test";
import assert from "node:assert/strict";
import filament, { fillColour, placeAndFill, groupStats, decideWinner } from "../games/filament/game.js";
import { newGame, replay, randomPlayout } from "../common/engine.js";
import { seededRng } from "../common/rng.js";

const fresh = (size = 48) => newGame(filament, { size });
const withCells = (state, assign) => {
  const s = filament.clone(state);
  for (const [id, v] of Object.entries(assign)) s.cells[id] = v;
  return s;
};

const s48 = fresh();
const { neighbours } = s48.board;
const deg5 = neighbours.findIndex((ns) => ns.length === 5);
const deg3 = neighbours.findIndex((ns) => ns.length === 3);

test("fill thresholds: 3-of-5 and 2-of-3 fill the opposite colour", () => {
  const cells = new Int8Array(48);
  const n5 = neighbours[deg5];
  assert.equal(fillColour(cells, neighbours, deg5), 0, "empty neighbourhood has no majority");
  cells[n5[0]] = 1; cells[n5[1]] = 1; cells[n5[2]] = 1; cells[n5[3]] = 2; cells[n5[4]] = 2;
  assert.equal(fillColour(cells, neighbours, deg5), 2);
  cells[n5[2]] = 0;
  assert.equal(fillColour(cells, neighbours, deg5), 0, "2-of-5 is below threshold");

  const c3 = new Int8Array(48);
  const n3 = neighbours[deg3];
  c3[n3[0]] = 2; c3[n3[1]] = 2;
  assert.equal(fillColour(c3, neighbours, deg3), 1);
  c3[n3[1]] = 0;
  assert.equal(fillColour(c3, neighbours, deg3), 0, "1-of-3 is below threshold");
});

// Reference cascade: the original whole-board, simultaneous-pass algorithm.
function naiveCascade(cells, id, player) {
  cells[id] = player;
  for (;;) {
    const fills = [];
    for (let c = 0; c < cells.length; c++) {
      if (cells[c]) continue;
      const colour = fillColour(cells, neighbours, c);
      if (colour) fills.push([c, colour]);
    }
    if (!fills.length) return;
    for (const [c, colour] of fills) cells[c] = colour;
  }
}

test("worklist cascade matches the whole-board rescan", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const rng = seededRng(seed);
    const a = new Int8Array(48), b = new Int8Array(48);
    let player = 1;
    for (;;) {
      const empties = [...a.keys()].filter((i) => !a[i]);
      if (!empties.length) break;
      const id = empties[Math.floor(rng() * empties.length)];
      const fills = placeAndFill(a, neighbours, id, player);
      naiveCascade(b, id, player);
      assert.deepEqual([...a], [...b], `seed ${seed}`);
      assert.ok(fills.every((f) => a[f] !== 0));
      player = 3 - player;
    }
  }
});

test("applyMove places, fills, counts empties and passes the turn", () => {
  const s = fresh();
  const info = filament.applyMove(s, [0]);
  assert.equal(s.cells[0], 1);
  assert.equal(s.toMove, 2);
  assert.equal(s.empty, 48 - 1 - info.fills.length);
  assert.equal(s.empty, [...s.cells].filter((v) => !v).length);
});

test("a placement that creates a majority triggers a fill", () => {
  // Black on two neighbours of a degree-3 cell fills it White.
  const [a, b] = neighbours[deg3];
  const s = fresh();
  filament.applyMove(s, [a]);
  s.toMove = 1;   // let Black place again
  const { fills } = filament.applyMove(s, [b]);
  assert.ok(fills.includes(deg3));
  assert.equal(s.cells[deg3], 2);
});

test("groupStats counts isolated, adjacent and separated stones", () => {
  const far = neighbours.findIndex((ns, id) => id !== 0 && !neighbours[0].includes(id));
  assert.deepEqual(groupStats(withCells(s48, { 0: 1 }), 1).sizes, [1]);
  assert.deepEqual(groupStats(withCells(s48, { 0: 1, [neighbours[0][0]]: 1 }), 1).sizes, [2]);
  assert.deepEqual(groupStats(withCells(s48, { 0: 1, [far]: 1 }), 1), { count: 2, sizes: [1, 1] });
});

test("decideWinner: draw, fewer groups, and the size tie-break", () => {
  assert.equal(decideWinner(s48), 0, "empty board draws");

  // Black: one group of 2. White: two isolated stones.
  const c = 0, c2 = neighbours[0][0];
  const near = new Set([c, c2, ...neighbours[c], ...neighbours[c2]]);
  const x = [...Array(48).keys()].find((i) => !near.has(i));
  const y = [...Array(48).keys()].find((i) => !near.has(i) && i !== x && !neighbours[x].includes(i));
  assert.equal(decideWinner(withCells(s48, { [c]: 1, [c2]: 1, [x]: 2, [y]: 2 })), 1);

  // Equal counts: Black [1, 1] vs White [2, 1] -> Black's smaller largest group wins.
  const tie = withCells(s48, { [x]: 1, [y]: 1, [c]: 2, [c2]: 2 });
  const z = [...Array(48).keys()].find((i) =>
    !tie.cells[i] && ![x, y, c, c2].some((j) => neighbours[j].includes(i)));
  tie.cells[z] = 2;
  assert.deepEqual(groupStats(tie, 2).sizes, [2, 1]);
  assert.equal(decideWinner(tie), 1);
});

test("outcome is null until the board is full", () => {
  const s = fresh();
  assert.equal(filament.outcome(s), null);
  randomPlayout(filament, s, seededRng(5));
  assert.equal(s.empty, 0);
  assert.ok([0, 1, 2].includes(filament.outcome(s).winner));
  assert.deepEqual(filament.legalMoves(s), []);
});

test("custom playout agrees with the generic random playout's invariants", () => {
  for (const size of [48, 160]) {
    const s = fresh(size);
    const winner = filament.playout(s, seededRng(size));
    assert.equal(s.empty, 0);
    assert.ok(s.cells.every((v) => v === 1 || v === 2));
    assert.equal(winner, decideWinner(s));
  }
});

test("seeded playouts are reproducible", () => {
  const run = () => filament.playout(fresh(), seededRng(11));
  assert.equal(run(), run());
});

test("replay reproduces a game and its last-move info", () => {
  const s = fresh();
  const moves = [];
  const rng = seededRng(3);
  let info = null;
  while (!filament.outcome(s)) {
    const legal = filament.legalMoves(s);
    const m = legal[Math.floor(rng() * legal.length)];
    info = filament.applyMove(s, m);
    moves.push(m);
  }
  const r = replay(filament, { size: 48 }, moves);
  assert.deepEqual([...r.state.cells], [...s.cells]);
  assert.deepEqual(r.lastInfo, info);
});

test("markers ring the placed stone and dot the fills", () => {
  assert.deepEqual(filament.markers(s48, [7], { fills: [3, 9] }), [
    { id: 7, kind: "ring" }, { id: 3, kind: "dot" }, { id: 9, kind: "dot" },
  ]);
});
