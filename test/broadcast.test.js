import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/broadcast/game.js";
import { newGame, resolveOptions, moveKey } from "../common/engine.js";
import { seededRng } from "../common/rng.js";

const { turnOptions, sowPaths, cornersOf } = internals;

const tri = (size = 7, swap = "off") => newGame(game, { size, swap });
const at = (s, name) => s.board.cells.find((c) => c.tags.name === name).id;

// Roll the two dice of a turn.
function roll(s, a, b) {
  game.applyMove(s, `roll:${a}`);
  game.applyMove(s, `roll:${b}`);
}

// Put a stack (bottom to top) on a cell.
function stack(s, id, players) {
  s.stacks[id] = players.slice();
  s.tops[id] = players.length ? players[players.length - 1] : 0;
}

// Fill every cell with one checker, alternating owners.
function fill(s) {
  for (let id = 0; id < s.board.size; id++) stack(s, id, [1 + (id % 2)]);
}

test("the board is a triangle with three darker corners", () => {
  assert.equal(resolveOptions(game, {}).size, 7);
  for (const size of [3, 7, 10]) {
    const { board } = tri(size);
    assert.equal(board.corners.length, 3);
    for (const scheme of Object.values(game.colorSchemes)) {
      const fills = board.cells.map((c) => scheme.cellFill(c));
      const corner = fills[board.corners[0]];
      assert.ok(board.corners.every((id) => fills[id] === corner));
      assert.equal(fills.filter((f) => f === corner).length, 3, "only the corners");
    }
  }
});

test("White may swap before their first roll", () => {
  const s = tri(7, "on");
  roll(s, 4, 4);
  game.applyMove(s, [10]);
  assert.equal(game.toMove(s), 2);
  assert.deepEqual(game.legalMoves(s), ["keep", "swap"]);
  assert.deepEqual(game.chanceView(s), []);
  game.applyMove(s, "swap");
  assert.deepEqual(s.stacks[10], [2]);
  assert.equal(s.tops[10], 2);
  assert.equal(s.turn, 1);
  assert.equal(game.toMove(s), 0);
  // Black rolls and moves on; the swap is not offered again.
  roll(s, 2, 2);
  game.applyMove(s, [11]);
  assert.equal(game.toMove(s), 0);
});

test("keeping goes on to White's roll", () => {
  const s = tri(7, "on");
  roll(s, 3, 3);
  game.applyMove(s, [10]);
  game.applyMove(s, "keep");
  assert.equal(game.toMove(s), 0);
  roll(s, 5, 5);
  assert.ok(!game.legalMoves(s).includes("swap"));
});

test("the dice panel shows the difference once both dice are rolled", () => {
  const s = tri();
  game.applyMove(s, "roll:2");
  assert.equal(game.chanceView(s)[0].result, undefined);
  game.applyMove(s, "roll:6");
  assert.equal(game.chanceView(s)[0].result, "difference 4");
});

test("a double places on a vacant cell, even with stacks to sow or cap", () => {
  const s = tri(9);
  const a = at(s, "c5");
  stack(s, a, [1]);
  roll(s, 4, 4);
  assert.equal(game.toMove(s), 1);
  const legal = game.legalMoves(s);
  assert.ok(legal.every((m) => m.length === 1 && m[0] !== a));
  assert.equal(legal.length, s.board.size - 1);
  game.applyMove(s, [5]);
  assert.deepEqual(s.stacks[5], [1]);
  assert.equal(game.toMove(s), 0);
  assert.equal(s.turns, 1);
});

test("otherwise sow a stack of exactly the difference that you cap", () => {
  const s = tri(9);
  const a = at(s, "c5"), b = at(s, "d7"), c = at(s, "b3"), d = at(s, "e6");
  stack(s, a, [2, 1, 1]);     // height 3, Black caps
  stack(s, b, [1, 1, 2]);     // height 3, White caps: not Black's
  stack(s, c, [1, 1, 1, 1]);  // height 4: not the difference
  stack(s, d, [1, 1]);        // height 2: not the difference
  roll(s, 2, 5);
  assert.deepEqual(turnOptions(s), { kind: "sow", ids: [a] });
  const legal = game.legalMoves(s);
  assert.ok(legal.length > 0 && legal.every((m) => m[0] === a && m.length === 4));
  assert.match(game.turnHint(s), /sow a stack of 3/);
  assert.deepEqual(game.markers(s).filter((m) => m.kind === "target").map((m) => m.id), [a]);
});

test("with no stack of the difference, cap one of your own stacks", () => {
  const s = tri(9);
  const a = at(s, "c5"), b = at(s, "d7"), c = at(s, "b3");
  stack(s, a, [2, 1]);
  stack(s, b, [1, 2]);   // White's
  stack(s, c, [1]);
  roll(s, 1, 6);
  const mine = [a, c].sort((x, y) => x - y);
  assert.deepEqual(turnOptions(s), { kind: "cap", ids: mine });
  assert.deepEqual(game.legalMoves(s).map(([id]) => id), mine);
  assert.match(game.turnHint(s), /caps no stack of 5: cap one of your stacks/);
  game.applyMove(s, [a]);
  assert.deepEqual(s.stacks[a], [2, 1, 1]);
});

test("capping no stack at all, a non-double places", () => {
  const s = tri();
  roll(s, 1, 6);
  assert.equal(turnOptions(s).kind, "place");
  assert.equal(game.legalMoves(s).length, s.board.size);
  assert.match(game.turnHint(s), /caps no stack: place/);
});

test("paths never step straight back but may revisit cells", () => {
  const s = tri(10);
  const o = at(s, "d7");   // three rows from every side
  const paths = sowPaths(s.board, o, 3);
  assert.equal(paths.length, 6 * 5 * 5);
  for (const p of paths) for (let i = 2; i < p.length; i++) assert.notEqual(p[i], p[i - 2]);
  // A triangle of three mutual neighbours brings the path back to its origin.
  assert.ok(paths.some((p) => p[3] === o));
  // At the apex (two neighbours) the first two steps are forced round.
  assert.ok(sowPaths(s.board, at(s, "a1"), 3).every((p) => p[2] !== at(s, "a1")));
});

test("sowing leaves a new checker, drops the bottom first and the cap last", () => {
  const s = tri(9);
  const [o, x, y, z] = [at(s, "c5"), at(s, "c6"), at(s, "d7"), at(s, "d6")];
  stack(s, o, [2, 2, 1]);
  stack(s, y, [2]);
  roll(s, 4, 1);
  const move = [o, x, y, z];
  assert.ok(game.legalMoves(s).some((m) => moveKey(m) === moveKey(move)));
  game.applyMove(s, move);
  assert.deepEqual(s.stacks[o], [1]);
  assert.deepEqual(s.stacks[x], [2]);
  assert.deepEqual(s.stacks[y], [2, 2]);
  assert.deepEqual(s.stacks[z], [1]);
  assert.equal(s.tops[o], 1);
});

test("a sow that comes back to its origin lands on the checker left there", () => {
  const s = tri(9);
  const o = at(s, "c5");
  stack(s, o, [2, 1, 1]);
  roll(s, 5, 2);
  const loop = sowPaths(s.board, o, 3).find((p) => p[3] === o);
  game.applyMove(s, loop);
  assert.deepEqual(s.stacks[o], [1, 1]);
});

test("a double on a full board ends the game; the corner majority wins", () => {
  const corners = (s, owners) => s.board.corners.forEach((id, i) => stack(s, id, owners[i]));
  const s = tri(7);
  fill(s);
  corners(s, [[1], [1, 2], [2, 2, 1]]);
  assert.deepEqual([cornersOf(s, 1), cornersOf(s, 2)], [2, 1]);
  // A non-double still has moves: sow or cap.
  roll(s, 2, 3);
  assert.equal(game.outcome(s), null);
  assert.ok(game.legalMoves(s).length > 0);

  const t = tri(7);
  fill(t);
  corners(t, [[2], [1, 2], [2, 2, 1]]);
  roll(t, 3, 3);
  assert.deepEqual(game.outcome(t), { winner: 2 });
  assert.deepEqual(game.legalMoves(t), []);
  assert.match(game.outcomeLines(t, game.outcome(t))[0], /full and Black rolled a double/);
  // The final dice stay on show.
  assert.equal(game.chanceView(t)[0].result, "difference 0");
});

test("random playouts fill the board and end with a winner", () => {
  const rng = seededRng(5);
  for (const size of [3, 5, 7]) {
    for (let i = 0; i < 20; i++) {
      const s = tri(size, "on");
      const w = game.playout(s, rng);
      assert.ok(w === 1 || w === 2, `size ${size}: winner ${w}`);
      assert.ok(s.stacks.every((st) => st.length), "the board is full");
    }
  }
});

test("the log gives the difference with the second die", () => {
  const s = tri();
  const before = game.clone(s);
  game.applyMove(s, "roll:5");
  assert.equal(game.moveText(before, "roll:5"), null);
  assert.equal(game.moveText(s, "roll:2"), "rolled 2, difference 3");
});

test("stacks draw as piles of bars; the capped top is larger", () => {
  const s = tri();
  stack(s, 0, [1, 2, 1]);
  const ps = game.piecesOf(s, "capped");
  assert.deepEqual(ps.map((p) => p.player), [1, 2, 1]);
  assert.ok(ps[0].bar.y > ps[1].bar.y && ps[1].bar.y > ps[2].bar.y, "bottom checker lowest");
  assert.ok(ps[2].bar.width > ps[1].bar.width && ps[2].bar.height > ps[1].bar.height);

  const plain = game.piecesOf(s, "plain");
  assert.ok(plain.every((p) => p.bar.width === plain[0].bar.width && !p.label));
  assert.ok(plain[0].bar.y > plain[2].bar.y);
});

test("heights show only on stacks too tall to sow", () => {
  const s = tri();
  stack(s, 0, [1, 2, 1]);
  stack(s, 1, [1, 1, 1, 2, 2]);
  stack(s, 2, [1, 1, 1, 2, 2, 2]);
  for (const style of ["shaded", "capped"]) {
    const labelled = game.piecesOf(s, style).filter((p) => p.label);
    assert.deepEqual(labelled.map((p) => [p.id, p.label]), [[2, "6"]], style);
  }
  const ps = game.piecesOf(s);
  const tiles = ps.filter((p) => p.tile);
  assert.deepEqual(tiles.map((p) => p.id), [0, 1, 2]);
  assert.notEqual(tiles[0].fill, tiles[1].fill, "shaded by owner");
  const six = ps.find((p) => p.label);
  assert.ok(six.bar.labelX > six.bar.x + six.bar.width / 2, "the height sits to the right");
  for (const style of ["shaded", "capped", "plain"]) {
    assert.ok(game.piecesOf(s, style).every((p) => p.shadow === false), `${style}: no shadows`);
  }
});

test("tall stacks stay within the cell", () => {
  const s = tri();
  stack(s, 0, Array.from({ length: 20 }, (_, i) => 1 + (i % 2)));
  for (const style of ["shaded", "capped", "plain"]) {
    for (const { bar } of game.piecesOf(s, style).filter((p) => p.bar)) {
      assert.ok(bar.height > 0 && Math.abs(bar.y) + bar.height / 2 <= 0.4, `${style} y ${bar.y}`);
    }
  }
});
