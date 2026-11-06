import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/broadcast/game.js";
import { newGame, resolveOptions, moveKey } from "../common/engine.js";

const { connector, sowHeight, sowPaths, sideSegments } = internals;

const tri = (size = 7) => newGame(game, { shape: "triangle", size });
const hex = (size = 4) => newGame(game, { shape: "hexagon", size });
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

test("board sizes depend on the shape", () => {
  assert.equal(resolveOptions(game, {}).size, 10);
  assert.equal(resolveOptions(game, { shape: "hexagon", size: 10 }).size, 6);
  assert.equal(resolveOptions(game, { shape: "triangle", size: 4 }).size, 7);
});

test("hex-hex sides pair up into three sets; corners between sets hold two", () => {
  const s = hex(4);
  const { board } = s;
  const count = (bit) => board.cells.filter((c) => board.goal[c.id] & bit).length;
  // Two sides of 4 cells sharing a corner: 7 cells per set.
  assert.deepEqual([count(1), count(2), count(4)], [7, 7, 7]);
  const both = board.cells.filter((c) => [3, 5, 6].includes(board.goal[c.id]));
  assert.equal(both.length, 3);
  for (const segs of sideSegments(board)) assert.ok(segs.length > 0);
});

test("triangle sides are W, E, S; the corners hold two", () => {
  const { board } = tri(7);
  const two = board.cells.filter((c) => [3, 5, 6].includes(board.goal[c.id]));
  assert.equal(two.length, 3);
  // 7 cells along each side, each drawn by 2 edges (the apex has 4 off-board edges).
  assert.deepEqual(sideSegments(board).map((x) => x.length), [14, 14, 14]);
});

test("a double places on any vacant cell", () => {
  const s = tri();
  roll(s, 3, 3);
  assert.equal(game.toMove(s), 1);
  const legal = game.legalMoves(s);
  assert.equal(legal.length, s.board.size);
  game.applyMove(s, [5]);
  assert.deepEqual(s.stacks[5], [1]);
  assert.equal(game.toMove(s), 0);
  assert.equal(s.turn, 2);
});

test("with no stack to sow, a non-double places instead", () => {
  const s = tri();
  roll(s, 1, 6);
  assert.equal(sowHeight(s), 0);
  assert.ok(game.legalMoves(s).every((m) => m.length === 1));
  assert.match(game.turnHint(s), /place a checker/);
});

test("sow a stack of exactly the difference, else the tallest below it", () => {
  const s = tri(9);
  const a = at(s, "c5"), b = at(s, "d7"), c = at(s, "b3");
  stack(s, a, [2, 1]);        // height 2, Black caps
  stack(s, b, [1, 1, 1, 2]);  // White caps: not Black's
  stack(s, c, [1, 1, 1, 1]);  // height 4: too tall for a 3
  roll(s, 2, 5);
  assert.equal(sowHeight(s), 2);
  const legal = game.legalMoves(s);
  assert.ok(legal.every((m) => m[0] === a && m.length === 3));
  assert.match(game.turnHint(s), /caps no stack of 3: sow a stack of 2/);

  const t = tri(9);
  stack(t, c, [1, 1, 1, 1]);
  roll(t, 2, 6);
  assert.equal(sowHeight(t), 4);
  // A taller stack than the difference cannot be sown: place.
  const u = tri(9);
  stack(u, c, [1, 1, 1, 1]);
  roll(u, 2, 5);
  assert.equal(sowHeight(u), 0);
});

test("paths never step straight back but may revisit cells", () => {
  const s = tri(13);
  const o = at(s, "e9");   // four rows from every side
  const paths = sowPaths(s.board, o, 3);
  assert.equal(paths.length, 6 * 5 * 5);
  for (const p of paths) for (let i = 2; i < p.length; i++) assert.notEqual(p[i], p[i - 2]);
  // A triangle of three mutual neighbours brings the path back to its origin.
  assert.ok(paths.some((p) => p[3] === o));
  // At the apex (two neighbours) the first two steps are forced round.
  assert.ok(sowPaths(s.board, at(s, "a1"), 3).every((p) => p[2] !== at(s, "a1")));
});

test("sowing drops the bottom first and the cap last", () => {
  const s = tri(9);
  const [o, x, y, z] = [at(s, "c5"), at(s, "c6"), at(s, "d7"), at(s, "d6")];
  stack(s, o, [2, 2, 1]);
  stack(s, y, [2]);
  roll(s, 1, 4);
  const move = [o, x, y, z];
  assert.ok(game.legalMoves(s).some((m) => moveKey(m) === moveKey(move)));
  game.applyMove(s, move);
  assert.deepEqual(s.stacks[o], []);
  assert.deepEqual(s.stacks[x], [2]);
  assert.deepEqual(s.stacks[y], [2, 2]);
  assert.deepEqual(s.stacks[z], [1]);
  assert.equal(s.tops[o], 0);
});

test("a sow that comes back to its origin refills it", () => {
  const s = tri(9);
  const o = at(s, "c5");
  stack(s, o, [2, 1, 1]);
  roll(s, 5, 2);
  const loop = sowPaths(s.board, o, 3).find((p) => p[3] === o);
  game.applyMove(s, loop);
  assert.deepEqual(s.stacks[o], [1]);
});

test("whoever connects at the end of a turn wins, even by the mover's sow", () => {
  const s = tri(7);
  // White holds the bottom row, which joins W, E and S, but for one gap.
  const bottom = s.board.cells.filter((c) => c.coord.r === 6).map((c) => c.id);
  for (const id of bottom) stack(s, id, [2]);
  const gap = bottom[3];
  stack(s, gap, []);
  // Black's stack above the gap holds a White checker at the bottom.
  const above = s.board.neighbours[gap].find((n) => s.board.cells[n].coord.r === 5);
  stack(s, above, [2, 1]);
  assert.equal(connector(s.board, s.tops), 0);
  roll(s, 2, 4);
  const move = game.legalMoves(s).find((m) => m[0] === above && m[1] === gap);
  game.applyMove(s, move);
  assert.deepEqual(game.outcome(s), { winner: 2 });
  assert.deepEqual(game.legalMoves(s), []);
});

test("a placement can win", () => {
  const s = hex(4);
  const { board } = s;
  // A straight line through the centre from set 0's corner side to the opposite
  // touches sets... use a row that joins all three sets instead: fill all but one.
  const ring = board.cells.filter((c) => c.tags.edges.length).map((c) => c.id);
  for (const id of ring) stack(s, id, [1]);
  const gap = ring[0];
  stack(s, gap, []);
  roll(s, 6, 6);
  game.applyMove(s, [gap]);
  assert.deepEqual(game.outcome(s), { winner: 1 });
});

test("the log gives the difference with the second die", () => {
  const s = tri();
  const before = game.clone(s);
  game.applyMove(s, "roll:5");
  assert.equal(game.moveText(before, "roll:5"), null);
  assert.equal(game.moveText(s, "roll:2"), "rolled 2, difference 3");
});

test("stacks draw as nested discs with the height on top", () => {
  const s = tri();
  stack(s, 0, [1, 2, 1]);
  const ps = game.piecesOf(s);
  assert.deepEqual(ps.map((p) => p.player), [1, 2, 1]);
  assert.ok(ps[0].size > ps[1].size && ps[1].size > ps[2].size);
  assert.equal(ps[2].label, "3");
  assert.equal(ps[0].label, undefined);
});
