import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/broadcast/game.js";
import { newGame, resolveOptions, moveKey } from "../common/engine.js";
import { seededRng } from "../common/rng.js";

const { turnOptions, sowPaths, cornersOf, cornerMarks } = internals;

const tri = (size = 7, swap = "off") => newGame(game, { shape: "triangle", size, swap });
const hex = (size = 4, swap = "off") => newGame(game, { shape: "hexagon", size, swap });
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

test("board sizes depend on the shape", () => {
  assert.deepEqual(resolveOptions(game, {}), { shape: "triangle", size: 7, swap: "on" });
  assert.equal(resolveOptions(game, { shape: "hexagon", size: 9 }).size, 6);
  assert.equal(resolveOptions(game, { shape: "hexagon", size: 3 }).size, 3);
});

test("three corners score, shaded darker: a triangle's all, a hexagon's every other", () => {
  for (const s of [tri(3), tri(7), tri(10), hex(3), hex(6)]) {
    const { board } = s;
    assert.equal(board.corners.length, 3);
    for (const scheme of Object.values(game.colorSchemes)) {
      const fills = board.cells.map((c) => scheme.cellFill(c));
      const corner = fills[board.corners[0]];
      assert.ok(board.corners.every((id) => fills[id] === corner));
      assert.equal(fills.filter((f) => f === corner).length, 3, "only the scoring corners");
    }
  }
  // Hexagon: NE, W and SE; no two of them adjacent corners.
  const { board } = hex(4);
  assert.deepEqual(board.corners.map((id) => board.cells[id].tags.name).sort(), ["a4", "d7", "g1"]);
  for (const id of board.corners) assert.equal(board.cells[id].tags.edges.length, 2);
});

test("corner marks wrap the scoring corners, off the board, and are optional", () => {
  const len = ([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  // Triangle: a chevron of two half edges; hexagon: three edges, the ends halved.
  for (const [s, per] of [[tri(7), 2], [hex(4), 3]]) {
    const segs = cornerMarks(s.board);
    assert.equal(segs.length, 3 * per);
    for (let i = 0; i < 3; i++) {
      const run = segs.slice(i * per, (i + 1) * per);
      const c = s.board.cells[s.board.corners[i]];
      for (let j = 1; j < per; j++) assert.deepEqual(run[j][0], run[j - 1][1], "one unbroken line");
      // A unit hexagon's edge is 1; the marks stand a little further out.
      assert.ok(Math.abs(len(run[0]) - len(run[per - 1])) < 1e-9, "ends alike");
      assert.ok(len(run[0]) > 0.5 && len(run[0]) < 0.7, "ends halved");
      for (const seg of run.slice(1, -1)) assert.ok(len(seg) > 1 && len(seg) < 1.4, "middle edges whole");
      // Every point lies outside the cell (its circumradius is 1).
      for (const [p, q] of run) for (const [x, y] of [p, q]) assert.ok(Math.hypot(x - c.x, y - c.y) > 0.99);
    }
  }
  const [decor] = game.boardDecor(hex().board);
  assert.equal(decor.optional, true);
  assert.equal(game.optionalDecor, "Corner marks");
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
  for (const make of [() => tri(3, "on"), () => tri(7, "on"), () => hex(3, "on"), () => hex(5, "on")]) {
    for (let i = 0; i < 20; i++) {
      const s = make();
      const size = `${s.board.shape} ${s.board.size}`;
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
