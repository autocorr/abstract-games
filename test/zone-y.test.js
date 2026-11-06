import { test } from "node:test";
import assert from "node:assert/strict";
import game, { internals } from "../games/zone-y/game.js";
import { newGame, replay, resolveOptions } from "../common/engine.js";
import { seededRng } from "../common/rng.js";

const { fullBoardWinner } = internals;

const opts = (o = {}) => ({ size: 13, inner: 4, ...o });
const legalSet = (s) => new Set(game.legalMoves(s).map(([id]) => id));
const innerCells = (s) => s.board.cells.filter((c) => c.tags.inner).map((c) => c.id);
const outerCells = (s) => s.board.cells.filter((c) => !c.tags.inner).map((c) => c.id);

test("the inner zone is a centred triangle of the chosen side", () => {
  for (const [size, inner] of [[13, 4], [13, 1], [13, 10], [8, 5], [19, 7]]) {
    const s = newGame(game, opts({ size, inner }));
    const ids = innerCells(s);
    assert.equal(ids.length, (inner * (inner + 1)) / 2, `${size}/${inner}`);
    const rows = new Map();
    for (const id of ids) {
      const { r } = s.board.cells[id].coord;
      rows.set(r, (rows.get(r) || 0) + 1);
    }
    assert.deepEqual([...rows.values()], Array.from({ length: inner }, (_, i) => i + 1));
    // Equal margins: the outer zone is equally wide on every side.
    const w = (size - inner) / 3;
    for (const id of ids) assert.ok(s.board.cells[id].coord.d.every((d) => d >= w));
  }
});

test("the default 13 / 4 board matches the picture: rows 7-10 hold 1-4 inner cells", () => {
  const s = newGame(game, opts());
  const rows = innerCells(s).map((id) => s.board.cells[id].coord.r + 1);
  assert.deepEqual([...new Set(rows)], [7, 8, 9, 10]);
  assert.equal(s.board.size, 91);
});

test("the inner side must leave an outer zone of whole rows", () => {
  assert.equal(resolveOptions(game, { size: 13, inner: 4 }).inner, 4);
  assert.equal(resolveOptions(game, { size: 14, inner: 4 }).inner, 2);
  assert.equal(resolveOptions(game, { size: 13, inner: 13 }).inner, 10);
  assert.equal(resolveOptions(game, { size: 8, inner: 16 }).inner, 5);
});

test("an inner stone is a whole turn", () => {
  const s = newGame(game, opts());
  game.applyMove(s, [innerCells(s)[0]]);
  assert.equal(game.toMove(s), 2);
});

test("an outer stone is followed by a second outer stone of the same player", () => {
  const s = newGame(game, opts());
  const [a, b] = outerCells(s);
  game.applyMove(s, [a]);
  assert.equal(game.toMove(s), 1);
  assert.equal(game.currentPlayer(s), 1);
  const legal = legalSet(s);
  for (const id of innerCells(s)) assert.ok(!legal.has(id), "no inner stone as the second");
  assert.ok(legal.has(b) && !legal.has(a));
  assert.match(game.turnHint(s), /second stone in the outer zone/);
  game.applyMove(s, [b]);
  assert.equal(game.toMove(s), 2);
  assert.deepEqual(s.placed, [a, b]);
  assert.deepEqual(game.markers(s).map((m) => m.id), [a, b]);
});

test("the last empty outer cell may be played alone", () => {
  const s = newGame(game, opts());
  s.outerFree = 1;   // as if the rest of the outer zone were full
  assert.match(game.turnHint(s), /inner zone, or the last one in the outer zone/);
  game.applyMove(s, [outerCells(s)[0]]);
  assert.equal(game.toMove(s), 2);
  assert.match(game.turnHint(s), /^White: place a stone in the inner zone\./);
});

test("joining all three sides wins, even with the first of two stones", () => {
  const s = newGame(game, opts({ size: 8, inner: 2 }));
  const b = s.board;
  // Black: the right edge from apex to bottom-right corner touches W (apex), E and S.
  const line = Array.from({ length: 8 }, (_, r) => b.at(0, r));
  for (const id of line.slice(0, 7)) s.cells[id] = 1;
  s.cells[b.at(-1, 2)] = 2;
  const last = line[7];
  assert.ok(!b.inner[last]);
  game.applyMove(s, [last]);
  assert.deepEqual(game.outcome(s), { winner: 1 });
  assert.deepEqual(game.legalMoves(s), []);
});

test("two sides are not enough", () => {
  const s = newGame(game, opts({ size: 8, inner: 2 }));
  const b = s.board;
  // Along the bottom row from the left corner, stopping short of the right one.
  for (let j = 0; j < 7; j++) game.applyMove(Object.assign(s, { turn: 1, second: false }), [b.at(j - 7, 7)]);
  assert.equal(game.outcome(s), null);
});

test("swap: White takes over Black's opening stones", () => {
  const s = newGame(game, opts());
  const [a, b] = outerCells(s);
  game.applyMove(s, [a]);
  assert.ok(!game.legalMoves(s).includes("swap"), "not mid-turn of Black");
  game.applyMove(s, [b]);
  assert.ok(game.legalMoves(s).includes("swap"));
  game.applyMove(s, "swap");
  assert.equal(s.cells[a], 2);
  assert.equal(s.cells[b], 2);
  assert.equal(game.toMove(s), 1);
  assert.ok(!game.legalMoves(s).includes("swap"));
});

test("playouts fill the board and agree with the full-board winner", () => {
  const rng = seededRng(7);
  for (let i = 0; i < 50; i++) {
    const s = newGame(game, opts({ size: 9 + (i % 4) * 3, inner: 3 }));
    const w = game.playout(s, rng);
    assert.ok(s.cells.every((c) => c), "full board");
    assert.equal(w, fullBoardWinner(s.board, s.cells));
  }
});

test("random play always ends in a win before the board overfills", () => {
  const rng = seededRng(3);
  for (let i = 0; i < 30; i++) {
    const s = newGame(game, opts({ size: 8, inner: 2 }));
    let plies = 0;
    while (!game.outcome(s)) {
      const moves = game.legalMoves(s).filter((m) => m !== "swap");
      game.applyMove(s, moves[Math.floor(rng() * moves.length)]);
      plies++;
    }
    assert.ok(plies <= s.board.size);
    // Whoever connected first also owns the full-board Y.
    const filled = game.clone(s);
    filled.winner = null;
    assert.equal(game.playout(filled, rng), s.winner);
  }
});

test("replay rebuilds a position from its moves", () => {
  const s = newGame(game, opts());
  const [a, b] = outerCells(s);
  const c = innerCells(s)[0];
  const { state } = replay(game, opts(), [[a], [b], [c]]);
  assert.equal(state.cells[a], 1);
  assert.equal(state.cells[c], 2);
  assert.equal(game.toMove(state), 1);
});
